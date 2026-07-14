from langchain_groq import ChatGroq

from config import settings
from llm.base import LLMProvider


class GroqProvider(LLMProvider):

    def __init__(
        self,
        model: str,
        temperature: float = settings.temperature,
    ):
        self.model = model
        self.temperature = temperature

    def get_llm(self) -> ChatGroq:
        return ChatGroq(
            model=self.model,
            api_key=settings.groq_api_key,
            temperature=self.temperature,
        )