from langchain_ollama import ChatOllama

from config import settings
from llm.base import LLMProvider


class OllamaLocalProvider(LLMProvider):

    def __init__(
        self,
        model: str,
        temperature: float = settings.temperature,
    ):
        self.model = model
        self.temperature = temperature

    def get_llm(self) -> ChatOllama:
        return ChatOllama(
            model=self.model,
            base_url=settings.ollama_base_url,
            temperature=self.temperature,
        )
