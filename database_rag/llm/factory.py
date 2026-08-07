from langchain_core.language_models.chat_models import BaseChatModel

from config import settings


def get_llm(
    provider: str | None = None,
    model: str | None = None,
    temperature: float | None = None,
) -> BaseChatModel:
    """Factory function to resolve and instantiate the requested LLM provider.

    Args:
        provider: Name of the LLM provider ('groq', 'ollama', or 'ollama_cloud')
        model: Specific model name to use
        temperature: Temperature setting for generation

    Returns:
        An instantiated Chat model from LangChain
    """
    provider_name = provider or settings.default_llm_provider
    model_name = model or settings.default_model
    temp = settings.temperature if temperature is None else temperature

    if provider_name == "groq":
        from llm.groq_provider import GroqProvider

        if not settings.groq_api_key or not settings.groq_api_key.strip():
            raise RuntimeError("LLM API key is missing. Kindly insert your LLM API key in the settings panel.")

        return GroqProvider(model=model_name, temperature=temp).get_llm()
    elif provider_name == "ollama_cloud":
        from llm.ollama_cloud_provider import OllamaCloudProvider

        if not settings.ollama_cloud_api_key or not settings.ollama_cloud_api_key.strip():
            raise RuntimeError("LLM API key is missing. Kindly insert your LLM API key in the settings panel.")

        return OllamaCloudProvider(model=model_name, temperature=temp).get_llm()
    elif provider_name == "ollama":
        from llm.ollama_local_provider import OllamaLocalProvider

        return OllamaLocalProvider(model=model_name, temperature=temp).get_llm()
    else:
        raise ValueError(f"Unknown LLM provider: {provider_name}")
