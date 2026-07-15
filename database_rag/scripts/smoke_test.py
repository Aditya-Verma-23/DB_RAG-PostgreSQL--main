"""Manual connectivity + text-to-SQL sanity check.

Run with: python -m scripts.smoke_test
Not part of the app; useful for verifying DB/LLM config after setup changes.
"""

from config import settings
from database.factory import get_database_provider


def main() -> None:
    print(f"Groq API key loaded: {'yes' if settings.groq_api_key else 'no'}")
    print(
        f"Ollama Cloud API key loaded: {'yes' if settings.ollama_cloud_api_key else 'no'}"
    )
    print(f"Default LLM provider: {settings.default_llm_provider}")
    print(f"Default LLM model: {settings.default_model}")

    provider = get_database_provider(settings)
    provider.connect()
    connected = provider.test_connection()
    print("Connected:", connected)
    print("Dialect:", provider.dialect)
    if not connected:
        provider.disconnect()
        return

    print("\n--- Detected Schema ---")
    print(provider.get_schema())

    provider.disconnect()


if __name__ == "__main__":
    main()
