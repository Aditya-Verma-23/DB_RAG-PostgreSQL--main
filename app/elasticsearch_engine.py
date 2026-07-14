"""
app/elasticsearch_engine.py

Elasticsearch RAG Engine for the DB RAG application.
Introspects Elasticsearch indices, translates natural language questions to 
Elasticsearch Query DSL (JSON), executes searches safely, and synthesizes 
results into plain-English answers.
"""

import os
import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any

from elasticsearch import Elasticsearch
from openai import OpenAI

from .config import DEFAULT_GROQ_MODEL, GROQ_BASE_URL, MAX_ROWS_RETURNED, GROQ_API_KEY
from .memory import Turn, SESSION_STORE
from .engine import AskResult

logger = logging.getLogger("db_rag")


class ESRagEngine:
    def __init__(
        self,
        es_url: str,
        es_user: str | None = None,
        es_password: str | None = None,
        es_api_key: str | None = None,
        groq_api_key: str | None = None,
        model: str = DEFAULT_GROQ_MODEL,
        index_filter: list[str] | None = None,
        max_tokens: int = 1500,
        schema_ttl_seconds: int = 60,
    ):
        """
        es_url             : Elasticsearch connection URL (e.g. http://localhost:9200)
        es_user / password : basic auth credentials
        es_api_key         : Elasticsearch API Key (alternative to basic auth)
        groq_api_key       : defaults to GROQ_API_KEY env var if not passed
        model              : which Groq-hosted model to use
        index_filter       : optional list of index names to restrict introspection to
        schema_ttl_seconds : how often the schema is auto-refreshed in the background (default 60s)
        """
        kwargs = {}
        if es_api_key:
            kwargs["api_key"] = es_api_key
        elif es_user and es_password:
            kwargs["basic_auth"] = (es_user, es_password)

        self.client = Elasticsearch(es_url, **kwargs)
        self.groq_client = OpenAI(
            api_key=groq_api_key or GROQ_API_KEY,
            base_url=GROQ_BASE_URL,
        )
        self.model = model
        self.index_filter = index_filter
        self.max_tokens = max_tokens
        self.schema_ttl_seconds = schema_ttl_seconds

        # Schema cache
        self._schema_lock = threading.Lock()
        self._schema_doc: str | None = None
        self._schema_refreshed_at: datetime | None = None
        self._schema_last_hash: str | None = None

        self._refresh_schema()
        self._start_schema_watcher()

    # ---------- 1. Schema Introspection ----------

    def _build_schema_doc(self) -> str:
        """Reads mappings from the live ES instance."""
        try:
            mappings = self.client.indices.get_mapping()
        except Exception as e:
            logger.error("Failed to fetch Elasticsearch mappings: %s", e)
            return "(unable to fetch mappings)"

        lines = []
        for index_name, details in mappings.items():
            if index_name.startswith("."):
                continue  # skip system indices
            if self.index_filter and index_name not in self.index_filter:
                continue

            properties = details.get("mappings", {}).get("properties", {})
            fields = []
            for field_name, field_info in properties.items():
                field_type = field_info.get("type", "object")
                fields.append(f"{field_name} ({field_type})")

            block = f"INDEX {index_name}:\n  fields: " + ", ".join(fields)
            lines.append(block)

        return "\n\n".join(lines) if lines else "(no indices found)"

    def _refresh_schema(self) -> bool:
        try:
            new_doc = self._build_schema_doc()
            new_hash = str(hash(new_doc))
            with self._schema_lock:
                changed = new_hash != self._schema_last_hash
                self._schema_doc = new_doc
                self._schema_refreshed_at = datetime.now(timezone.utc)
                self._schema_last_hash = new_hash
            if changed:
                logger.info("ES Index Mappings refreshed — change detected.")
            else:
                logger.debug("ES Index Mappings refreshed — no change.")
            return changed
        except Exception as e:
            logger.error("ES Index Mappings refresh failed: %s", e)
            return False

    def _start_schema_watcher(self) -> None:
        def watcher():
            while True:
                time.sleep(self.schema_ttl_seconds)
                self._refresh_schema()

        t = threading.Thread(target=watcher, daemon=True)
        t.start()

    def get_schema_doc(self) -> str:
        with self._schema_lock:
            return self._schema_doc or "(schema not yet loaded)"

    @property
    def schema_refreshed_at(self) -> datetime | None:
        with self._schema_lock:
            return self._schema_refreshed_at

    def force_schema_refresh(self) -> dict:
        changed = self._refresh_schema()
        return {
            "refreshed_at": self._schema_refreshed_at.isoformat(),
            "changed": changed,
            "schema": self.get_schema_doc(),
        }

    # ---------- 2. NL question -> ES DSL JSON ----------

    def generate_query(self, question: str, history: list[Turn]) -> str:
        schema_doc = self.get_schema_doc()

        system_prompt = (
            "You are an Elasticsearch Query DSL generation engine. You convert a user's natural-language "
            "question into a single JSON object containing target index and valid search DSL body.\n\n"
            "Rules:\n"
            "- Output ONLY the JSON. No markdown formatting, no explanations, no preamble.\n"
            "- The JSON must be structured exactly like this: \n"
            "  {\n"
            '    "index": "<index_name_or_wildcard>",\n'
            '    "body": { <valid_elasticsearch_query_dsl_search_body> }\n'
            "  }\n"
            f"- Always restrict the search body 'size' parameter to max {MAX_ROWS_RETURNED}.\n"
            "- Only construct read-only search operations. Never include update, delete, or reindex keys.\n"
            "- Use fields that exist in the schema mappings below.\n\n"
            f"SCHEMA MAPPINGS:\n{schema_doc}"
        )

        messages = [{"role": "system", "content": system_prompt}]
        for turn in history:
            messages.append({"role": "user", "content": turn.question})
            prev_reply = turn.sql if not turn.error else f"[Error: {turn.error}]"
            messages.append({"role": "assistant", "content": prev_reply})
        messages.append({"role": "user", "content": question})

        resp = self.groq_client.chat.completions.create(
            model=self.model,
            max_tokens=self.max_tokens,
            temperature=0,
            messages=messages,
        )
        query_str = resp.choices[0].message.content.strip()
        # Clean markdown wrappers if present
        if query_str.startswith("```"):
            query_str = query_str.strip("`").replace("json\n", "", 1).strip()
        return query_str

    # ---------- 3. Execute Search ----------

    def execute_query(self, query_str: str) -> tuple[str, list[dict]]:
        """Parses the generated JSON, extracts index & body, and executes the search."""
        try:
            payload = json.loads(query_str)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse generated query as JSON: {e}\nQuery output was: {query_str}")

        index_name = payload.get("index", "*")
        body = payload.get("body", {})

        # Safety: restrict sizing hard limit
        if "size" in body:
            body["size"] = min(int(body["size"]), MAX_ROWS_RETURNED)
        else:
            body["size"] = 50

        # Execute search query
        res = self.client.search(index=index_name, **body)
        hits = res.get("hits", {}).get("hits", [])
        
        # Flatten source hits for response structure compatibility
        flat_results = []
        for hit in hits:
            doc = dict(hit.get("_source", {}))
            doc["_id"] = hit.get("_id")
            doc["_index"] = hit.get("_index")
            flat_results.append(doc)

        return index_name, flat_results

    # ---------- 4. Synthesize Answer ----------

    def synthesize_answer(self, question: str, query_str: str, rows: list[dict], history: list[Turn]) -> str:
        preview = rows[:50]
        payload = json.dumps(preview, default=str, indent=2)

        system_prompt = (
            "You answer the user's question in plain English using ONLY the Elasticsearch query "
            "search results provided. Be concise and direct. If the result set is empty, say so. "
            "If results were truncated, you may mention that. Use conversation history for context."
        )

        messages = [{"role": "system", "content": system_prompt}]
        for turn in history:
            ctx = turn.to_context_str()
            messages.append({"role": "user", "content": turn.question})
            messages.append({"role": "assistant", "content": ctx})

        current = (
            f"Question: {question}\n\nDSL query used:\n{query_str}\n\n"
            f"Result hits (showing up to 50 of {len(rows)}):\n{payload}"
        )
        messages.append({"role": "user", "content": current})

        resp = self.groq_client.chat.completions.create(
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
            query_str = self.generate_query(question, history)
        except Exception as e:
            return AskResult(question=question, sql="", rows=[], answer=None,
                             error=f"LLM error while generating ES query: {e}",
                             history=history_obj.to_list())
        logger.info("[%s] Generated ES Query: %s", session_id[:8], query_str)

        try:
            target_index, rows = self.execute_query(query_str)
        except Exception as e:
            return AskResult(question=question, sql=query_str, rows=[], answer=None,
                             error=f"Elasticsearch execution error: {e}", history=history_obj.to_list())

        try:
            answer = self.synthesize_answer(question, query_str, rows, history)
        except Exception as e:
            return AskResult(question=question, sql=query_str, rows=rows, answer=None,
                             error=f"LLM error while summarizing ES results: {e}",
                             history=history_obj.to_list())

        # Save turn
        history_obj.add(Turn(question=question, sql=query_str, answer=answer))
        return AskResult(question=question, sql=query_str, rows=rows, answer=answer,
                         error=None, history=history_obj.to_list())
