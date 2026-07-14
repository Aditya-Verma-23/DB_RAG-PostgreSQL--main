"""
app/main.py

Web API module for the DB RAG application.
Initializes the FastAPI application, maps middleware rules (e.g. CORS), declares request/response
Pydantic schemas, serves the chat UI from `web/index.html`, and exposes routes for asking database questions,
forcing schema refreshes, clearing memory sessions, and monitoring health checks.
"""

from typing import Any
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import DB_URL, GROQ_API_KEY, MODEL, ALLOWED_ORIGINS, DB_TYPE
from .engine import get_engine
from .memory import SESSION_STORE

if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY must be set (env vars or .env file).")

if DB_TYPE == "sql" and not DB_URL:
    raise RuntimeError("DB_URL must be set when DB_TYPE is 'sql'.")

engine = get_engine()

app = FastAPI(title="DB RAG (Groq)", description="Ask your database questions in plain English.")

origins = ["*"] if ALLOWED_ORIGINS == "*" else [o.strip() for o in ALLOWED_ORIGINS.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


import hashlib
import json

from urllib.parse import quote_plus

class ConnectionConfig(BaseModel):
    db_type: str = "sql"  # "postgres", "mysql", "mariadb", "mssql", "sqlite", "elasticsearch"
    db_url: str | None = None
    host: str | None = None
    port: int | None = None
    database: str | None = None
    username: str | None = None
    password: str | None = None
    sqlite_path: str | None = None
    es_url: str | None = None
    es_user: str | None = None
    es_password: str | None = None
    es_api_key: str | None = None
    es_index_filter: str | None = None
    groq_api_key: str | None = None


class SchemaRequest(BaseModel):
    connection: ConnectionConfig | None = None


class AskRequest(BaseModel):
    question: str
    session_id: str = ""   # frontend sends a UUID; empty string = anonymous (no memory)
    connection: ConnectionConfig | None = None


class AskResponse(BaseModel):
    question: str
    sql: str
    row_count: int
    rows: list[dict]
    answer: str | None
    error: str | None
    turn_count: int = 0
    history: list[dict] = []


DYNAMIC_ENGINE_CACHE = {}


def get_dynamic_engine(config: ConnectionConfig | None) -> Any:
    if not config:
        return engine

    config_dict = config.model_dump()
    config_str = json.dumps(config_dict, sort_keys=True)
    cache_key = hashlib.sha256(config_str.encode("utf-8")).hexdigest()

    if cache_key in DYNAMIC_ENGINE_CACHE:
        return DYNAMIC_ENGINE_CACHE[cache_key]

    active_groq_key = config.groq_api_key or GROQ_API_KEY

    if config.db_type == "elasticsearch":
        from .elasticsearch_engine import ESRagEngine
        es_url = config.es_url or "http://localhost:9200"
        index_filter = [i.strip() for i in config.es_index_filter.split(",") if i.strip()] if config.es_index_filter else None
        engine_inst = ESRagEngine(
            es_url=es_url,
            es_user=config.es_user,
            es_password=config.es_password,
            es_api_key=config.es_api_key,
            groq_api_key=active_groq_key,
            model=MODEL,
            index_filter=index_filter
        )
    else:
        from .engine import DBRagEngine
        
        # Build standard SQL URL if explicit details are passed
        if config.db_url:
            db_url = config.db_url
            
            # Normalize schema formats automatically to include recommended SQLAlchemy drivers
            if db_url.startswith("mysql://"):
                db_url = db_url.replace("mysql://", "mysql+pymysql://", 1)
            elif db_url.startswith("postgresql://"):
                db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
            elif db_url.startswith("postgres://"):
                db_url = db_url.replace("postgres://", "postgresql+psycopg2://", 1)
            elif db_url.startswith("mssql://"):
                db_url = db_url.replace("mssql://", "mssql+pymssql://", 1)

            # Validate dialect prefix to prevent database mismatch errors
            if config.db_type == "postgres" and not db_url.startswith("postgresql"):
                raise HTTPException(status_code=400, detail="Provided URL is not a PostgreSQL connection string (must start with 'postgresql' or 'postgres').")
            elif config.db_type == "mysql" and not db_url.startswith("mysql"):
                raise HTTPException(status_code=400, detail="Provided URL is not a MySQL connection string (must start with 'mysql').")
            elif config.db_type == "mariadb" and not (db_url.startswith("mysql") or db_url.startswith("mariadb")):
                raise HTTPException(status_code=400, detail="Provided URL is not a MariaDB connection string (must start with 'mysql' or 'mariadb').")
            elif config.db_type == "mssql" and not db_url.startswith("mssql"):
                raise HTTPException(status_code=400, detail="Provided URL is not a Microsoft SQL Server connection string (must start with 'mssql').")
            elif config.db_type == "sqlite" and not db_url.startswith("sqlite"):
                raise HTTPException(status_code=400, detail="Provided URL is not a SQLite connection string (must start with 'sqlite').")
        elif config.db_type in ["postgres", "mysql", "mariadb", "mssql", "sqlite"]:
            if config.db_type == "sqlite":
                path = config.sqlite_path or "local.db"
                db_url = f"sqlite:///{path}"
            else:
                host = config.host or "localhost"
                database = config.database or ""
                username = config.username or ""
                password = config.password or ""
                
                user_part = quote_plus(username) if username else ""
                pass_part = f":{quote_plus(password)}" if password else ""
                auth = f"{user_part}{pass_part}@" if user_part else ""
                
                if config.db_type == "postgres":
                    port = config.port or 5432
                    db_url = f"postgresql+psycopg2://{auth}{host}:{port}/{database}"
                elif config.db_type == "mysql":
                    port = config.port or 3306
                    db_url = f"mysql+pymysql://{auth}{host}:{port}/{database}"
                elif config.db_type == "mariadb":
                    port = config.port or 3306
                    db_url = f"mysql+pymysql://{auth}{host}:{port}/{database}"
                elif config.db_type == "mssql":
                    port = config.port or 1433
                    db_url = f"mssql+pymssql://{auth}{host}:{port}/{database}"
        else:
            db_url = config.db_url or DB_URL

        if not db_url:
            raise HTTPException(status_code=400, detail="Database URL or connection credentials are required.")

        engine_inst = DBRagEngine(
            db_url=db_url,
            groq_api_key=active_groq_key,
            model=MODEL
        )

    DYNAMIC_ENGINE_CACHE[cache_key] = engine_inst
    return engine_inst


@app.post("/ask", response_model=AskResponse)
def ask(req: AskRequest):
    if not req.question or not req.question.strip():
        raise HTTPException(status_code=400, detail="question must not be empty")
    session_id = req.session_id or "anonymous"
    try:
        active_engine = get_dynamic_engine(req.connection)
        result = active_engine.ask(req.question, session_id)
    except Exception as e:
        return AskResponse(
            question=req.question, sql="", row_count=0, rows=[],
            answer=None, error=f"Unexpected server error: {e}",
        )
    return result.to_dict()


@app.post("/session/clear")
def session_clear(req: AskRequest):
    """Clear conversation history for a session — called by the 'New Chat' button."""
    session_id = req.session_id or "anonymous"
    SESSION_STORE.clear(session_id)
    return {"cleared": True, "session_id": session_id}


@app.post("/schema")
def schema(req: SchemaRequest):
    try:
        active_engine = get_dynamic_engine(req.connection)
        refreshed_at = active_engine.schema_refreshed_at
        return {
            "schema": active_engine.get_schema_doc(),
            "refreshed_at": refreshed_at.isoformat() if refreshed_at else None,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/schema/refresh")
def schema_refresh(req: SchemaRequest):
    """Force an immediate schema re-read from the DB. Use this if you just
    CREATE or ALTER a table and want the LLM to know about it right away
    without waiting for the next auto-refresh (default: every 60 seconds)."""
    try:
        active_engine = get_dynamic_engine(req.connection)
        return active_engine.force_schema_refresh()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    refreshed_at = engine.schema_refreshed_at
    return {
        "status": "ok",
        "model": engine.model,
        "schema_refreshed_at": refreshed_at.isoformat() if refreshed_at else None,
        "schema_ttl_seconds": engine.schema_ttl_seconds,
    }


# Serve the chat frontend at the root URL (http://localhost:8000/)
_WEB_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "web"))
_FRONTEND_PATH = os.path.join(_WEB_DIR, "index.html")

if os.path.exists(_WEB_DIR):
    app.mount("/static", StaticFiles(directory=_WEB_DIR), name="static")


@app.get("/", response_class=FileResponse)
def root():
    if os.path.exists(_FRONTEND_PATH):
        return FileResponse(_FRONTEND_PATH, media_type="text/html")
    return {"detail": f"index.html not found at {_FRONTEND_PATH}"}
