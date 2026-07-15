import os
from langchain_ollama import ChatOllama

from config import settings
from llm.base import LLMProvider


class OllamaCloudProvider(LLMProvider):
    def __init__(
        self,
        model: str,
        temperature: float = settings.temperature,
    ):
        self.model = model
        self.temperature = temperature

    def get_llm(self) -> ChatOllama:
        # Set the key in environment variable, which is used by internal ollama tools
        if settings.ollama_cloud_api_key:
            os.environ["OLLAMA_API_KEY"] = settings.ollama_cloud_api_key

        return ChatOllama(
            model=self.model,
            base_url=settings.ollama_cloud_base_url,
            temperature=self.temperature,
            client_kwargs={
                "headers": {"Authorization": f"Bearer {settings.ollama_cloud_api_key}"}
            },
        )
