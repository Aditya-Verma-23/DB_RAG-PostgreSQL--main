from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    groq_api_key: str = Field(default="")
    ollama_base_url: str = Field(default="http://localhost:11434")
    ollama_cloud_base_url: str = Field(default="https://ollama.com")
    ollama_cloud_api_key: str = Field(default="")
    ollama_cloud_model: str = Field(default="gemma3:27b")
    default_llm_provider: str = Field(default="ollama_cloud")
    default_model: str = Field(default="gemma3:27b")
    temperature: float = Field(default=0.0)
    max_tokens: int = Field(default=2048)

    database_url: str = Field(default="")

    # Legacy MSSQL settings. They remain supported when DATABASE_URL is unset.
    mssql_server: str = Field(default="")
    mssql_port: int = Field(default=1433)
    mssql_database: str = Field(default="")
    mssql_username: str = Field(default="")
    mssql_password: str = Field(default="")
    mssql_driver: str = Field(default="ODBC Driver 18 for SQL Server")
    mssql_trust_server_certificate: bool = Field(default=True)

    @property
    def mssql_url(self) -> URL:
        """Build a SQLAlchemy URL for the MSSQL database.

        Using a URL object (rather than a hand-built string) means the
        password never needs manual percent-encoding and is never
        accidentally exposed via str()/repr() (SQLAlchemy masks it).
        """
        return URL.create(
            "mssql+pyodbc",
            username=self.mssql_username,
            password=self.mssql_password,
            host=self.mssql_server,
            port=self.mssql_port,
            database=self.mssql_database,
            query={
                "driver": self.mssql_driver,
                "TrustServerCertificate": "yes"
                if self.mssql_trust_server_certificate
                else "no",
            },
        )

    @property
    def database_connection_url(self) -> str | URL:
        """Return DATABASE_URL, or preserve the existing MSSQL configuration."""
        return self.database_url or self.mssql_url


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
