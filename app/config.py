"""
app/config.py

Configuration module for the DB RAG application.
Loads environment variables from `.env` using dotenv and defines system-wide
constants, model configurations, session limits, database credentials, and origins.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# Groq free-tier models worth knowing (as of mid-2026):
#   llama-3.3-70b-versatile  -> best quality/free-tier balance, good default for SQL generation
#   llama-3.1-8b-instant     -> fastest, most generous free-tier daily request limit
#   openai/gpt-oss-120b      -> strong reasoning, smaller daily free-tier cap
# Check https://console.groq.com/docs/models for the current list and limits.
DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

MAX_ROWS_RETURNED = 200  # hard cap so huge tables don't blow up context / the UI
MAX_HISTORY_TURNS = 10   # keep last N question+answer pairs in context
SESSION_IDLE_MINUTES = 60  # sessions inactive longer than this are cleaned up

DB_TYPE = os.getenv("DB_TYPE", "sql")  # "sql" or "elasticsearch"

# SQL Configuration
DB_URL = os.getenv("DB_URL", "mysql://root:Sit!321#@192.168.3.51:3306/mydb")

# Elasticsearch Configuration
ES_URL = os.getenv("ES_URL", "http://localhost:9200")
ES_USER = os.getenv("ES_USER", None)
ES_PASSWORD = os.getenv("ES_PASSWORD", None)
ES_API_KEY = os.getenv("ES_API_KEY", None)
ES_INDEX_FILTER = os.getenv("ES_INDEX_FILTER", "")  # Comma-separated list of index names to restrict introspection

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "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")
MODEL = os.getenv("GROQ_MODEL", DEFAULT_GROQ_MODEL)
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*")  # comma-separated, or "*" for dev
