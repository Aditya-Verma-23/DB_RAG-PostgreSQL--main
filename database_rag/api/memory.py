import time
import logging
import threading
from dataclasses import dataclass

from config import settings

logger = logging.getLogger("db_rag_api_memory")


@dataclass
class Turn:
    question: str
    sql: str
    answer: str
    error: str | None = None

    def to_context_str(self) -> str:
        """Compact text representation injected into the LLM prompt."""
        if self.error:
            return f"Q: {self.question}\n→ Error: {self.error}"
        return f"Q: {self.question}\n→ SQL: {self.sql}\n→ Answer: {self.answer}"

    def to_dict(self) -> dict:
        return {"question": self.question, "sql": self.sql,
                "answer": self.answer, "error": self.error}


class ConversationHistory:
    """
    Thread-safe conversation history for one chat session.
    Stores the last max_history_turns turns so follow-up questions resolve correctly.
    """
    def __init__(self):
        self._lock = threading.Lock()
        self._turns: list[Turn] = []
        self.last_active = time.time()

    def add(self, turn: Turn) -> None:
        with self._lock:
            self._turns.append(turn)
            if len(self._turns) > settings.max_history_turns:
                self._turns = self._turns[-settings.max_history_turns:]
            self.last_active = time.time()

    def get_turns(self) -> list[Turn]:
        with self._lock:
            return list(self._turns)

    def clear(self) -> None:
        with self._lock:
            self._turns = []
            self.last_active = time.time()

    def edit(self, index: int, question: str, sql: str | None = None, answer: str | None = None, error: str | None = None) -> None:
        with self._lock:
            if 0 <= index < len(self._turns):
                turn = self._turns[index]
                turn.question = question
                if sql is not None:
                    turn.sql = sql
                if answer is not None:
                    turn.answer = answer
                if error is not None:
                    turn.error = error
                
                # Truncate subsequent turns to keep history consistent with the edited turn
                self._turns = self._turns[:index + 1]
                self.last_active = time.time()
            else:
                raise ValueError("Index out of bounds")

    def truncate(self, index: int) -> None:
        with self._lock:
            if 0 <= index <= len(self._turns):
                self._turns = self._turns[:index]
                self.last_active = time.time()

    def to_list(self) -> list[dict]:
        return [t.to_dict() for t in self.get_turns()]

    def __len__(self) -> int:
        with self._lock:
            return len(self._turns)


class SessionStore:
    """
    In-memory store of session_id → ConversationHistory.
    A background thread cleans up sessions idle for session_idle_minutes.
    """
    def __init__(self):
        self._lock = threading.Lock()
        self._sessions: dict[str, ConversationHistory] = {}
        t = threading.Thread(target=self._cleanup_loop, daemon=True)
        t.start()

    def get_or_create(self, session_id: str) -> ConversationHistory:
        with self._lock:
            if session_id not in self._sessions:
                self._sessions[session_id] = ConversationHistory()
                logger.info("New session: %s", session_id)
            return self._sessions[session_id]

    def clear(self, session_id: str) -> None:
        with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id].clear()

    def _cleanup_loop(self):
        while True:
            time.sleep(300)  # check every 5 minutes
            cutoff = time.time() - settings.session_idle_minutes * 60
            with self._lock:
                stale = [sid for sid, h in self._sessions.items()
                         if h.last_active < cutoff]
                for sid in stale:
                    del self._sessions[sid]
                if stale:
                    logger.info("Cleaned up %d idle session(s).", len(stale))


SESSION_STORE = SessionStore()
