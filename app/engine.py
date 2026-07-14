"""
app/engine.py

Core engine module for the DB RAG application.
Encapsulates DBRagEngine and AskResult. Handles database schema introspection (metadata loading 
and watcher threads), interacts with the Groq client to translate natural language questions 
to SQL, executes safe queries, and synthesizes SQL result sets back into human-friendly answers.
"""

import os
import re
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from openai import OpenAI

from .config import DEFAULT_GROQ_MODEL, GROQ_BASE_URL, MAX_ROWS_RETURNED, GROQ_API_KEY
from .exceptions import UnsafeSQLError
from .memory import Turn, SESSION_STORE
from .safety import validate_sql

logger = logging.getLogger("db_rag")


@dataclass
class AskResult:
    question: str
    sql: str
    rows: list[dict[str, Any]] = field(default_factory=list)
    answer: str | None = None
    error: str | None = None
    history: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "question": self.question,
            "sql": self.sql,
            "row_count": len(self.rows),
            "rows": self.rows,
            "answer": self.answer,
            "error": self.error,
            "turn_count": len(self.history),
            "history": self.history,
        }


class DBRagEngine:
    def __init__(
        self,
        db_url: str,
        groq_api_key: str | None = None,
        model: str = DEFAULT_GROQ_MODEL,
        schema_filter: list[str] | None = None,
        max_tokens: int = 1500,
        schema_ttl_seconds: int = 60,
    ):
        """
        db_url             : SQLAlchemy connection string (Postgres, MySQL, SQLite, etc.)
        groq_api_key       : defaults to GROQ_API_KEY env var if not passed
        model              : which Groq-hosted model to use
        schema_filter      : optional list of table names to restrict introspection to
        schema_ttl_seconds : how often the schema is auto-refreshed in the background (default 60s).
                             Live data (INSERT/UPDATE) is always fresh — this only matters if you
                             CREATE or ALTER tables while the server is running.
        """
        # Normalize schema formats automatically to include recommended SQLAlchemy drivers
        if db_url.startswith("mysql://"):
            db_url = db_url.replace("mysql://", "mysql+pymysql://", 1)
        elif db_url.startswith("postgresql://"):
            db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
        elif db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql+psycopg2://", 1)
        elif db_url.startswith("mssql://"):
            db_url = db_url.replace("mssql://", "mssql+pymssql://", 1)

        self.engine: Engine = create_engine(db_url, pool_pre_ping=True)
        self.client = OpenAI(
            api_key=groq_api_key or GROQ_API_KEY,
            base_url=GROQ_BASE_URL,
        )
        self.model = model
        self.schema_filter = schema_filter
        self.max_tokens = max_tokens
        self.schema_ttl_seconds = schema_ttl_seconds

        # Schema cache — protected by a lock so background refresh and
        # request threads never read a half-written value.
        self._schema_lock = threading.Lock()
        self._schema_doc: str | None = None
        self._schema_refreshed_at: datetime | None = None
        self._schema_last_hash: str | None = None  # detect actual changes

        # Do an initial blocking read so the first request doesn't wait.
        self._refresh_schema()

        # Start a background thread that keeps the schema fresh.
        self._start_schema_watcher()

    # ---------- 1. Schema introspection ----------

    def _build_schema_doc(self) -> str:
        """Read schema from the live DB. Called from both init and background thread."""
        inspector = inspect(self.engine)
        lines = []
        table_names = inspector.get_table_names()
        if self.schema_filter:
            table_names = [t for t in table_names if t in self.schema_filter]

        for table_name in table_names:
            cols = inspector.get_columns(table_name)
            pk = inspector.get_pk_constraint(table_name).get("constrained_columns", [])
            fks = inspector.get_foreign_keys(table_name)

            col_descs = []
            for c in cols:
                marker = " PK" if c["name"] in pk else ""
                col_descs.append(f"{c['name']} ({c['type']}){marker}")

            fk_descs = [
                f"{fk['constrained_columns']} -> {fk['referred_table']}.{fk['referred_columns']}"
                for fk in fks
            ]

            block = f"TABLE {table_name}:\n  columns: " + ", ".join(col_descs)
            if fk_descs:
                block += "\n  foreign_keys: " + "; ".join(fk_descs)
            lines.append(block)

        return "\n\n".join(lines) if lines else "(no tables found)"

    def _refresh_schema(self) -> bool:
        """
        Re-read the schema from the DB and update the cache.
        Returns True if the schema actually changed, False if it was the same.
        Thread-safe.
        """
        try:
            new_doc = self._build_schema_doc()
            new_hash = str(hash(new_doc))
            with self._schema_lock:
                changed = new_hash != self._schema_last_hash
                self._schema_doc = new_doc
                self._schema_refreshed_at = datetime.now(timezone.utc)
                self._schema_last_hash = new_hash
            if changed:
                logger.info("Schema refreshed — change detected.")
            else:
                logger.debug("Schema refreshed — no change.")
            return changed
        except Exception as e:
            logger.error("Schema refresh failed: %s", e)
            return False

    def _start_schema_watcher(self) -> None:
        """Background thread: re-reads schema every `schema_ttl_seconds`."""
        def watcher():
            while True:
                time.sleep(self.schema_ttl_seconds)
                self._refresh_schema()

        t = threading.Thread(target=watcher, daemon=True)
        t.start()
        logger.info(
            "Schema watcher started — auto-refresh every %ds. "
            "Live data (INSERT/UPDATE) is always fresh without any refresh.",
            self.schema_ttl_seconds,
        )

    def get_schema_doc(self) -> str:
        """Return the cached schema. Always up-to-date within schema_ttl_seconds."""
        with self._schema_lock:
            return self._schema_doc or "(schema not yet loaded)"

    @property
    def schema_refreshed_at(self) -> datetime | None:
        with self._schema_lock:
            return self._schema_refreshed_at

    def force_schema_refresh(self) -> dict:
        """Manually trigger a schema re-read. Called from the /schema/refresh endpoint."""
        changed = self._refresh_schema()
        return {
            "refreshed_at": self._schema_refreshed_at.isoformat(),
            "changed": changed,
            "schema": self.get_schema_doc(),
        }

    # ---------- 2. NL question -> SQL ----------

    def generate_sql(self, question: str, history: list[Turn]) -> str:
        schema_doc = self.get_schema_doc()

        system_prompt = (
            "You are a SQL generation engine. You convert a user's natural-language "
            "question into a single, safe, read-only SQL query for the schema provided.\n\n"
            "Rules:\n"
            "- Output ONLY the SQL query. No markdown fences, no explanation, no preamble.\n"
            "- Only SELECT or WITH (CTE) statements are allowed. Never write INSERT, UPDATE, "
            "DELETE, DROP, ALTER, CREATE, or any other mutating/DDL statement.\n"
            f"- Always include a LIMIT clause (max {MAX_ROWS_RETURNED} rows) unless the "
            "question clearly asks for a single aggregate value.\n"
            "- Use only tables/columns that exist in the schema below. If the question "
            "cannot be answered from this schema, output exactly: "
            "SELECT 'UNANSWERABLE: <short reason>' AS error;\n"
            "- The conversation history below shows previous questions, the SQL that ran, "
            "and the answers given. Use it to resolve follow-up questions, pronouns "
            "('those', 'them', 'that table'), and references like 'now filter by city' "
            "or 'show me more of those'.\n\n"
            f"SCHEMA:\n{schema_doc}"
        )

        # Build the message list:
        # system → [past user-turn, past assistant-turn, ...] → current user question
        messages: list[dict] = [{"role": "system", "content": system_prompt}]
        for turn in history:
            messages.append({"role": "user", "content": turn.question})
            # Show the assistant what it "said" before: the SQL it generated
            prev_reply = turn.sql if not turn.error else f"[Error: {turn.error}]"
            messages.append({"role": "assistant", "content": prev_reply})
        messages.append({"role": "user", "content": question})

        resp = self.client.chat.completions.create(
            model=self.model,
            max_tokens=self.max_tokens,
            temperature=0,  # deterministic SQL generation
            messages=messages,
        )
        sql = resp.choices[0].message.content.strip()
        sql = re.sub(r"^```sql\s*|^```\s*|```$", "", sql, flags=re.MULTILINE).strip()
        return sql

    # ---------- 3. Safety validation ----------

    def validate_sql(self, sql: str) -> None:
        validate_sql(sql)

    # ---------- 4. Execute ----------

    def execute_sql(self, sql: str) -> list[dict[str, Any]]:
        with self.engine.connect() as conn:
            result = conn.execute(text(sql))
            rows = result.mappings().all()
            return [dict(r) for r in rows[:MAX_ROWS_RETURNED]]

    # ---------- 5. Result -> plain-English answer ----------

    def synthesize_answer(self, question: str, sql: str, rows: list[dict[str, Any]], history: list[Turn]) -> str:
        preview = rows[:50]
        payload = json.dumps(preview, default=str, indent=2)

        system_prompt = (
            "You answer the user's question in plain English using ONLY the query "
            "results provided. Be concise and direct. If the result set is empty, say so. "
            "If rows were truncated, you may mention the result was large. "
            "Use the conversation history to understand context and refer back to previous "
            "answers where relevant (e.g. 'compared to the 142 orders we saw earlier...')."
        )

        # Build multi-turn messages so the answer LLM also has full context
        messages: list[dict] = [{"role": "system", "content": system_prompt}]
        for turn in history:
            ctx = turn.to_context_str()
            messages.append({"role": "user", "content": turn.question})
            messages.append({"role": "assistant", "content": ctx})

        current = (
            f"Question: {question}\n\nSQL used:\n{sql}\n\n"
            f"Result rows (showing up to 50 of {len(rows)}):\n{payload}"
        )
        messages.append({"role": "user", "content": current})

        resp = self.client.chat.completions.create(
            model=self.model,
            max_tokens=self.max_tokens,
            temperature=0.3,
            messages=messages,
        )
        return resp.choices[0].message.content.strip()

    # ---------- End-to-end ----------

    def ask(self, question: str, session_id: str) -> AskResult:
        history_obj = SESSION_STORE.get_or_create(session_id)
        history = history_obj.get_turns()

        try:
            sql = self.generate_sql(question, history)
        except Exception as e:
            return AskResult(question=question, sql="", rows=[], answer=None,
                             error=f"LLM error while generating SQL: {e}",
                             history=history_obj.to_list())
        logger.info("[%s] Generated SQL: %s", session_id[:8], sql)

        try:
            self.validate_sql(sql)
        except UnsafeSQLError as e:
            return AskResult(question=question, sql=sql, rows=[], answer=None,
                             error=str(e), history=history_obj.to_list())

        try:
            rows = self.execute_sql(sql)
        except Exception as e:
            return AskResult(question=question, sql=sql, rows=[], answer=None,
                             error=f"DB error: {e}", history=history_obj.to_list())

        try:
            answer = self.synthesize_answer(question, sql, rows, history)
        except Exception as e:
            return AskResult(question=question, sql=sql, rows=rows, answer=None,
                             error=f"LLM error while summarizing: {e}",
                             history=history_obj.to_list())

        # Save this turn to the session's history
        history_obj.add(Turn(question=question, sql=sql, answer=answer))
        return AskResult(question=question, sql=sql, rows=rows, answer=answer,
                         error=None, history=history_obj.to_list())


def get_engine():
    """Factory helper to initialize either DBRagEngine or ESRagEngine depending on configuration."""
    from .config import DB_TYPE, DB_URL, GROQ_API_KEY, MODEL
    if DB_TYPE == "elasticsearch":
        from .config import ES_URL, ES_USER, ES_PASSWORD, ES_API_KEY, ES_INDEX_FILTER
        from .elasticsearch_engine import ESRagEngine
        index_filter = [i.strip() for i in ES_INDEX_FILTER.split(",") if i.strip()] if ES_INDEX_FILTER else None
        return ESRagEngine(
            es_url=ES_URL,
            es_user=ES_USER,
            es_password=ES_PASSWORD,
            es_api_key=ES_API_KEY,
            groq_api_key=GROQ_API_KEY,
            model=MODEL,
            index_filter=index_filter
        )
    else:
        return DBRagEngine(db_url=DB_URL, groq_api_key=GROQ_API_KEY, model=MODEL)
