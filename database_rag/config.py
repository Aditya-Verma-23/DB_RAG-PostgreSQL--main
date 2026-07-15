from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # LLM Configuration only - Database is fully dynamic via UI
    groq_api_key: str = Field(default="")
    ollama_base_url: str = Field(default="http://localhost:11434")
    ollama_cloud_base_url: str = Field(default="https://ollama.com")
    ollama_cloud_api_key: str = Field(default="")
    ollama_cloud_model: str = Field(default="gemma3:27b")
    default_llm_provider: str = Field(default="ollama_cloud")
    default_model: str = Field(default="gemma3:27b")
    temperature: float = Field(default=0.0)
    max_tokens: int = Field(default=2048)

    # No static database configuration - all database config is dynamic via UI


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
