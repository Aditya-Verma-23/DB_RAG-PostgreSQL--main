"""FastAPI backend for Text-to-SQL chat."""

from contextlib import asynccontextmanager
from pathlib import Path
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
    import os
    lines = []
    if ENV_PATH.exists():
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()
            
    updated = False
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(f"{key}=") or stripped.startswith(f"# {key}=") or stripped.startswith(f"#{key}="):
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
            return {"success": False, "error": "Database connection test failed. Please verify credentials."}
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
    try:
        db_provider = get_database_provider(settings)
        db_provider.connect()
        text_to_sql = TextToSQL(db_provider)
    except Exception as e:
        print(f"Warning: Failed to connect to default database on startup: {e}")
        # Leave db_provider and text_to_sql as None or uninitialized
    yield
    if db_provider:
        try:
            db_provider.disconnect()
        except Exception:
            pass


app = FastAPI(
    title="Database Text-to-SQL API", version="1.0.0", lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    question: str


class QueryResponse(BaseModel):
    question: str
    sql: str
    results: list[dict]
    row_count: int


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
        raise HTTPException(status_code=503, detail="Database not initialized. Please configure settings.")
    try:
        return SchemaResponse(db_schema=db_provider.get_schema())
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to retrieve schema: {str(e)}")


@app.post("/schema/refresh", response_model=SchemaResponse)
async def refresh_schema():
    if not db_provider:
        raise HTTPException(status_code=503, detail="Database not initialized. Please configure settings.")
    try:
        return SchemaResponse(db_schema=db_provider.refresh_schema())
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to refresh schema: {str(e)}")


@app.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest):
    if not text_to_sql:
        raise HTTPException(status_code=503, detail="Text-to-SQL not initialized. Please connect to a database first.")

    try:
        sql, results = text_to_sql.execute_question_with_sql(request.question)
        return QueryResponse(
            question=request.question,
            sql=sql,
            results=results,
            row_count=len(results),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
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
            masked_odbc = re.sub(r"(Password|Pwd)=([^;]+)", r"\1=*****", odbc_str, flags=re.IGNORECASE)
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
        
        # Detect raw ODBC connection strings and wrap them in a SQLAlchemy URL
        if "://" not in connection_url and ("Server=" in connection_url or "server=" in connection_url or "Driver=" in connection_url or "driver=" in connection_url):
            from urllib.parse import quote_plus
            connection_url = f"mssql+pyodbc:///?odbc_connect={quote_plus(connection_url)}"
    else:
        if not config.dialect:
            raise HTTPException(status_code=400, detail="Either connection_url or dialect must be provided.")
        
        dialect = config.dialect.lower()
        if dialect == "sqlite":
            if not config.database:
                raise HTTPException(status_code=400, detail="Database file path must be provided for SQLite.")
            connection_url = f"sqlite:///{config.database}"
        elif dialect == "postgresql":
            if not config.database:
                raise HTTPException(status_code=400, detail="Database name is required.")
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
                raise HTTPException(status_code=400, detail="Database name is required.")
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
                    "TrustServerCertificate": "yes" if config.trust_server_certificate else "no",
                },
            )
        elif dialect == "mysql":
            if not config.database:
                raise HTTPException(status_code=400, detail="Database name is required.")
            connection_url = URL.create(
                "mysql+pymysql",
                username=config.username,
                password=config.password,
                host=config.host or "localhost",
                port=config.port or 3306,
                database=config.database,
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported dialect: {dialect}")

    # Configure the database
    res = configure_database(connection_url)
    if not res["success"]:
        raise HTTPException(status_code=400, detail=res["error"])
        
    # Update in-memory settings
    conn_str = str(connection_url) if isinstance(connection_url, URL) else connection_url
    settings.database_url = conn_str
    
    # Save to .env
    try:
        update_env_file("DATABASE_URL", conn_str)
    except Exception as e:
        return {
            "status": "warning",
            "message": f"Database connected, but failed to save to .env: {str(e)}"
        }
        
    return {
        "status": "ok",
        "message": "Database connected successfully and configuration saved."
    }


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
            raise HTTPException(status_code=400, detail=f"Invalid provider: {config.provider}")
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
        
    # 2. Persist to .env
    try:
        if config.provider is not None:
            update_env_file("DEFAULT_LLM_PROVIDER", config.provider)
        if config.model is not None:
            update_env_file("DEFAULT_MODEL", config.model)
            if config.provider == "ollama_cloud":
                update_env_file("OLLAMA_CLOUD_MODEL", config.model)
        if config.temperature is not None:
            update_env_file("TEMPERATURE", str(config.temperature))
        if config.groq_api_key is not None:
            update_env_file("GROQ_API_KEY", config.groq_api_key)
        if config.ollama_cloud_api_key is not None:
            update_env_file("OLLAMA_CLOUD_API_KEY", config.ollama_cloud_api_key)
        if config.ollama_base_url is not None:
            update_env_file("OLLAMA_BASE_URL", config.ollama_base_url)
    except Exception as e:
        return {
            "status": "warning",
            "message": f"LLM settings updated in memory, but failed to save to .env: {str(e)}"
        }
        
    # Reinitialize TextToSQL chain
    if db_provider:
        try:
            text_to_sql = TextToSQL(db_provider)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to initialize LLM with new settings: {str(e)}")
            
    return {
        "status": "ok",
        "message": "LLM settings updated successfully and saved."
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

