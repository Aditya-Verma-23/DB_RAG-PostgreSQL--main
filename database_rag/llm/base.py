from abc import ABC, abstractmethod
from langchain_core.language_models.chat_models import BaseChatModel


class LLMProvider(ABC):
    """
    Base class for all LLM providers.
    """

    @abstractmethod
    def get_llm(self) -> BaseChatModel:
        """
        Return a configured LangChain chat model.
        """
        pass