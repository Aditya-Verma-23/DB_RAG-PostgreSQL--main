"""
app/memory.py

Conversation memory module for the DB RAG application.
Implements data classes and memory stores to track active chat turns, handle session-based 
history for multiple users in a thread-safe manner, and purge idle sessions.
"""

import time
import logging
import threading
from dataclasses import dataclass

from .config import MAX_HISTORY_TURNS, SESSION_IDLE_MINUTES

logger = logging.getLogger("db_rag")


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
    Stores the last MAX_HISTORY_TURNS turns so follow-up questions like
    'filter those by city' or 'now show the top 5' resolve correctly.
    """
    def __init__(self):
        self._lock = threading.Lock()
        self._turns: list[Turn] = []
        self.last_active = time.time()

    def add(self, turn: Turn) -> None:
        with self._lock:
            self._turns.append(turn)
            if len(self._turns) > MAX_HISTORY_TURNS:
                self._turns = self._turns[-MAX_HISTORY_TURNS:]
            self.last_active = time.time()

    def get_turns(self) -> list[Turn]:
        with self._lock:
            return list(self._turns)

    def clear(self) -> None:
        with self._lock:
            self._turns = []
            self.last_active = time.time()

    def to_list(self) -> list[dict]:
        return [t.to_dict() for t in self.get_turns()]

    def __len__(self) -> int:
        with self._lock:
            return len(self._turns)


class SessionStore:
    """
    In-memory store of session_id → ConversationHistory.
    A background thread cleans up sessions idle for SESSION_IDLE_MINUTES.
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
            cutoff = time.time() - SESSION_IDLE_MINUTES * 60
            with self._lock:
                stale = [sid for sid, h in self._sessions.items()
                         if h.last_active < cutoff]
                for sid in stale:
                    del self._sessions[sid]
                if stale:
                    logger.info("Cleaned up %d idle session(s).", len(stale))


SESSION_STORE = SessionStore()
