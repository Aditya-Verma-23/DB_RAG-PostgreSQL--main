"""FastAPI backend for Text-to-SQL chat."""

from contextlib import asynccontextmanager
from pathlib import Path
import re
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.engine import URL, make_url

from config import settings
from database.base import DatabaseProvider
from database.factory import get_database_provider
from database.sqlalchemy_provider import SQLAlchemyProvider
from llm.text_to_sql import TextToSQL

db_provider: DatabaseProvider | None = None
text_to_sql: TextToSQL | None = None

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env"


def update_env_file(key: str, value: str):
    lines = []
    if ENV_PATH.exists():
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()

    updated = False
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if (
            stripped.startswith(f"{key}=")
            or stripped.startswith(f"# {key}=")
            or stripped.startswith(f"#{key}=")
        ):
            new_lines.append(f"{key}={value}\n")
            updated = True
        else:
            new_lines.append(line)

    if not updated:
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines.append("\n")
        new_lines.append(f"{key}={value}\n")

    with open(ENV_PATH, "w", encoding="utf-8") as f:
        f.writelines(new_lines)


def configure_database(connection_url_or_obj: str | URL) -> dict:
    global db_provider, text_to_sql

    new_provider = SQLAlchemyProvider(connection_url_or_obj)
    try:
        new_provider.connect()
        if not new_provider.test_connection():
            new_provider.disconnect()
            return {
                "success": False,
                "error": "Database connection test failed. Please verify credentials.",
            }
    except Exception as e:
        try:
            new_provider.disconnect()
        except Exception:
            pass
        return {"success": False, "error": f"Database connection failed: {str(e)}"}

    if db_provider:
        try:
            db_provider.disconnect()
        except Exception:
            pass

    db_provider = new_provider
    text_to_sql = TextToSQL(db_provider)
    return {"success": True}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_provider, text_to_sql
    # No static database configuration - everything is configured dynamically via UI
    print("Starting application with dynamic database configuration (no static config)")
    db_provider = None
    text_to_sql = None
    yield
    if db_provider:
        try:
            db_provider.disconnect()
        except Exception:
            pass


app = FastAPI(title="Database Text-to-SQL API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class MessageItem(BaseModel):
    role: str
    content: Optional[str] = None
    sql: Optional[str] = None


class QueryRequest(BaseModel):
    question: str
    history: Optional[list[MessageItem]] = []
    role: Optional[str] = "Admin"


class QueryResponse(BaseModel):
    question: str
    sql: str
    results: list[dict]
    row_count: int
    content: Optional[str] = None
    suggestions: Optional[list[str]] = None


class HealthResponse(BaseModel):
    status: str
    database_connected: bool


class SchemaResponse(BaseModel):
    db_schema: str


class DatabaseConfigRequest(BaseModel):
    connection_url: Optional[str] = None
    dialect: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    driver: Optional[str] = None
    trust_server_certificate: bool = True


@app.get("/health", response_model=HealthResponse)
async def health_check():
    connected = db_provider.test_connection() if db_provider else False
    return HealthResponse(status="ok", database_connected=connected)


@app.get("/schema", response_model=SchemaResponse)
async def get_schema():
    if not db_provider:
        raise HTTPException(
            status_code=503,
            detail="Database not initialized. Please configure settings.",
        )
    try:
        return SchemaResponse(db_schema=db_provider.get_schema())
    except Exception as e:
        raise HTTPException(
            status_code=503, detail=f"Failed to retrieve schema: {str(e)}"
        )


@app.post("/schema/refresh", response_model=SchemaResponse)
async def refresh_schema():
    if not db_provider:
        raise HTTPException(
            status_code=503,
            detail="Database not initialized. Please configure settings.",
        )
    try:
        return SchemaResponse(db_schema=db_provider.refresh_schema())
    except Exception as e:
        raise HTTPException(
            status_code=503, detail=f"Failed to refresh schema: {str(e)}"
        )


def get_tables_from_provider() -> list[str]:
    if not db_provider:
        return []
    try:
        schema_text = db_provider.get_schema()
        # Find all TABLE: schema.table or VIEW: schema.table
        tables = re.findall(r'(?:TABLE|VIEW):\s+([A-Za-z0-9_\.]+)', schema_text)
        return tables
    except Exception:
        return []


@app.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest):
    if not text_to_sql:
        raise HTTPException(
            status_code=503,
            detail="Text-to-SQL not initialized. Please connect to a database first.",
        )

    try:
        formatted_history = ""
        if request.history:
            for msg in request.history:
                if msg.role == "user":
                    formatted_history += f"User: {msg.content}\n"
                elif msg.role == "bot" or msg.role == "assistant":
                    if msg.sql:
                        formatted_history += f"SQL: {msg.sql}\n"
                    elif msg.content:
                        formatted_history += f"Assistant: {msg.content}\n"

        # DATA FLOW: Step 2 (Backend Routing & Request Mapping) -> Hops to execute_question_with_sql in llm/text_to_sql.py
        # Passes formatted conversation history and current user question to the LLM processor.
        sql, results, content = text_to_sql.execute_question_with_sql(
            request.question, history=formatted_history, role=request.role
        )
        return QueryResponse(
            question=request.question,
            sql=sql,
            results=results,
            row_count=len(results),
            content=content,
        )
    except ValueError as e:
        # DATA FLOW: Step 8 (Recommendation Generation & Response Packaging)
        # Triggered when query is out-of-domain. Introspects DB schema for table mentions to suggest limit/describe queries.
        suggestions = []
        tables = get_tables_from_provider()
        if "list all table" not in request.question.lower():
            suggestions.append("List all table names in my database")
        
        if tables:
            # Check if any table name is mentioned in the user's question
            mentioned_table = None
            for t in tables:
                short_name = t.split('.')[-1] if '.' in t else t
                # Match word bounds or simple substring to detect table name
                if short_name.lower() in request.question.lower():
                    mentioned_table = t
                    break

            target_table = mentioned_table if mentioned_table else tables[0]
            if not mentioned_table:
                for t in tables:
                    if t.lower() not in request.question.lower():
                        target_table = t
                        break
            
            s1 = f"Fetch first 10 rows from table {target_table}"
            s2 = f"Describe columns and structure of table {target_table}"
            if s1.lower() != request.question.lower():
                suggestions.append(s1)
            if s2.lower() != request.question.lower():
                suggestions.append(s2)

        return QueryResponse(
            question=request.question,
            sql="",
            results=[],
            row_count=0,
            content="This information is not inside the database.",
            suggestions=suggestions
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query execution failed: {str(e)}")


@app.get("/config/database")
async def get_database_config():
    if not db_provider:
        return {
            "database_connected": False,
            "dialect": None,
            "connection_url": None,
            "host": None,
            "port": None,
            "database": None,
            "username": None,
        }

    url = db_provider.connection_string
    masked_url = ""
    dialect = None
    host = None
    port = None
    database = None
    username = None

    try:
        dialect = db_provider.dialect
    except Exception:
        pass

    try:
        url_obj = make_url(url)

        if "odbc_connect" in url_obj.query:
            import re

            odbc_str = url_obj.query["odbc_connect"]
            if isinstance(odbc_str, tuple):
                odbc_str = odbc_str[0]
            masked_odbc = re.sub(
                r"(Password|Pwd)=([^;]+)", r"\1=*****", odbc_str, flags=re.IGNORECASE
            )
            new_query = dict(url_obj.query)
            new_query["odbc_connect"] = masked_odbc
            url_obj = url_obj.set(query=new_query)

        masked_url = url_obj.render_as_string(hide_password=True)
        host = url_obj.host
        port = url_obj.port
        database = url_obj.database
        username = url_obj.username
    except Exception:
        masked_url = str(url)

    connected = db_provider.test_connection()

    return {
        "database_connected": connected,
        "dialect": dialect,
        "connection_url": masked_url,
        "host": host,
        "port": port,
        "database": database,
        "username": username,
    }


@app.post("/config/database")
async def update_database_config(config: DatabaseConfigRequest):
    if config.connection_url:
        connection_url = config.connection_url

        # Detect raw ODBC connection strings and parse them properly
        if "://" not in connection_url and (
            "Server=" in connection_url
            or "server=" in connection_url
            or "Driver=" in connection_url
            or "driver=" in connection_url
        ):
            # Parse the raw ODBC string components
            import re
            
            # Extract components from ODBC string
            server_match = re.search(r'(?:Server|server)=([^;]+)', connection_url)
            database_match = re.search(r'(?:Database|database)=([^;]+)', connection_url)
            user_id_match = re.search(r'(?:User Id|User ID|uid|Uid)=([^;]+)', connection_url, re.IGNORECASE)
            password_match = re.search(r'(?:Password|pwd|Pwd)=([^;]+)', connection_url, re.IGNORECASE)
            driver_match = re.search(r'(?:Driver|driver)=([^;]+)', connection_url)
            trust_cert_match = re.search(r'(?:TrustServerCertificate|Trust_Server_Certificate)=([^;]+)', connection_url, re.IGNORECASE)
            
            if server_match:
                server_value = server_match.group(1).strip()
                # Handle server,port format (e.g., 192.168.1.95,9905)
                if ',' in server_value:
                    server_parts = server_value.split(',')
                    server = server_parts[0].strip()
                    port = server_parts[1].strip()
                else:
                    server = server_value
                    port = "1433"
                
                database = database_match.group(1).strip() if database_match else ""
                username = user_id_match.group(1).strip() if user_id_match else ""
                password = password_match.group(1) if password_match else ""
                driver = driver_match.group(1).strip() if driver_match else "ODBC Driver 18 for SQL Server"
                trust_cert = trust_cert_match.group(1).strip().lower() in ('true', 'yes', '1') if trust_cert_match else True
                
                # Build proper SQLAlchemy URL
                from sqlalchemy.engine import URL
                connection_url = URL.create(
                    "mssql+pyodbc",
                    username=username,
                    password=password,
                    host=server,
                    port=int(port) if port.isdigit() else 1433,
                    database=database,
                    query={
                        "driver": driver,
                        "TrustServerCertificate": "yes" if trust_cert else "no"
                    }
                )
            else:
                # Fallback to odbc_connect method if server not found
                from urllib.parse import quote_plus
                connection_url = (
                    f"mssql+pyodbc:///?odbc_connect={quote_plus(connection_url)}"
                )
    else:
        if not config.dialect:
            raise HTTPException(
                status_code=400,
                detail="Either connection_url or dialect must be provided.",
            )

        dialect = config.dialect.lower()
        if dialect == "sqlite":
            if not config.database:
                raise HTTPException(
                    status_code=400,
                    detail="Database file path must be provided for SQLite.",
                )
            connection_url = f"sqlite:///{config.database}"
        elif dialect == "postgresql":
            if not config.database:
                raise HTTPException(
                    status_code=400, detail="Database name is required."
                )
            connection_url = URL.create(
                "postgresql+psycopg",
                username=config.username,
                password=config.password,
                host=config.host or "localhost",
                port=config.port or 5432,
                database=config.database,
            )
        elif dialect == "mssql":
            if not config.database:
                raise HTTPException(
                    status_code=400, detail="Database name is required."
                )
            driver = config.driver or "ODBC Driver 18 for SQL Server"
            connection_url = URL.create(
                "mssql+pyodbc",
                username=config.username,
                password=config.password,
                host=config.host or "localhost",
                port=config.port or 1433,
                database=config.database,
                query={
                    "driver": driver,
                    "TrustServerCertificate": "yes"
                    if config.trust_server_certificate
                    else "no",
                },
            )
        elif dialect == "mysql":
            if not config.database:
                raise HTTPException(
                    status_code=400, detail="Database name is required."
                )
            connection_url = URL.create(
                "mysql+pymysql",
                username=config.username,
                password=config.password,
                host=config.host or "localhost",
                port=config.port or 3306,
                database=config.database,
            )
        else:
            raise HTTPException(
                status_code=400, detail=f"Unsupported dialect: {dialect}"
            )

    # Configure the database
    res = configure_database(connection_url)
    if not res["success"]:
        raise HTTPException(status_code=400, detail=res["error"])

    # Note: Configuration is NOT saved to .env - fully dynamic via UI
    # Configuration persists only for the current session

    return {
        "status": "ok",
        "message": "Database connected successfully. Configuration is session-only (dynamic mode).",
    }


@app.post("/config/database/disconnect")
async def disconnect_database():
    global db_provider, text_to_sql
    if db_provider:
        try:
            db_provider.disconnect()
        except Exception:
            pass
    db_provider = None
    text_to_sql = None
    return {"status": "ok", "message": "Database disconnected successfully."}


class LLMConfigRequest(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    groq_api_key: Optional[str] = None
    ollama_cloud_api_key: Optional[str] = None
    ollama_base_url: Optional[str] = None


@app.get("/config/llm")
async def get_llm_config():
    return {
        "provider": settings.default_llm_provider,
        "model": settings.default_model,
        "temperature": settings.temperature,
        "groq_api_key_configured": bool(settings.groq_api_key),
        "ollama_cloud_api_key_configured": bool(settings.ollama_cloud_api_key),
        "ollama_base_url": settings.ollama_base_url,
    }


@app.post("/config/llm")
async def update_llm_config(config: LLMConfigRequest):
    global text_to_sql

    # 1. Update in-memory settings
    if config.provider is not None:
        if config.provider not in ["groq", "ollama", "ollama_cloud"]:
            raise HTTPException(
                status_code=400, detail=f"Invalid provider: {config.provider}"
            )
        settings.default_llm_provider = config.provider

    if config.model is not None:
        settings.default_model = config.model

    if config.temperature is not None:
        settings.temperature = config.temperature

    if config.groq_api_key is not None:
        settings.groq_api_key = config.groq_api_key

    if config.ollama_cloud_api_key is not None:
        settings.ollama_cloud_api_key = config.ollama_cloud_api_key

    if config.ollama_base_url is not None:
        settings.ollama_base_url = config.ollama_base_url

    # Note: Configuration is NOT saved to .env - fully dynamic via UI
    # Configuration persists only for the current session

    # Reinitialize TextToSQL chain with new LLM settings
    if db_provider:
        try:
            text_to_sql = TextToSQL(db_provider)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to initialize LLM with new settings: {str(e)}",
            )

    return {"status": "ok", "message": "LLM settings updated successfully. Configuration is session-only (dynamic mode)."}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
