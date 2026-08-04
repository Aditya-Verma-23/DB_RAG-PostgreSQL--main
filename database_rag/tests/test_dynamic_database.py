import unittest
from fastapi.testclient import TestClient

from config import Settings
from database.factory import get_database_provider
from database.sqlalchemy_provider import dialect_rules
from llm.text_to_sql import SQL_GENERATION_PROMPT
from api.main import app


class DynamicDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_database_url_selects_sqlite_without_mssql_settings(self) -> None:
        provider = get_database_provider("sqlite://")
        provider.connect()
        try:
            self.assertEqual(provider.dialect, "sqlite")
            self.assertEqual(
                provider.execute_query("SELECT 1 AS value"), [{"value": 1}]
            )
        finally:
            provider.disconnect()

    def test_postgresql_url_selects_postgresql_dialect(self) -> None:
        provider = get_database_provider(
            "postgresql+psycopg://user:pass@localhost/app"
        )
        provider.connect()
        try:
            self.assertEqual(provider.dialect, "postgresql")
        finally:
            provider.disconnect()

    def test_dialect_rules_and_prompt_are_not_sql_server_specific(self) -> None:
        self.assertIn("TOP", dialect_rules("mssql"))
        self.assertIn("LIMIT", dialect_rules("postgresql"))
        prompt = SQL_GENERATION_PROMPT.format(
            dialect="postgresql",
            dialect_rules=dialect_rules("postgresql"),
            history="",
            schema="TABLE: public.inventory(id integer)",
            question="List five rows",
        )
        self.assertIn("PostgreSQL SQL", prompt)
        self.assertNotIn("expert SQL Server", prompt)

    def test_get_database_config(self) -> None:
        response = self.client.get("/config/database")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("database_connected", data)
        self.assertIn("dialect", data)
        self.assertIn("connection_url", data)

    def test_post_database_config_sqlite(self) -> None:
        # SQLite in-memory database test via POST endpoint
        response = self.client.post(
            "/config/database", json={"connection_url": "sqlite://"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")

        # Verify that GET endpoint returns SQLite and connected is True
        get_response = self.client.get("/config/database")
        self.assertEqual(get_response.status_code, 200)
        get_data = get_response.json()
        self.assertEqual(get_data["dialect"], "sqlite")
        self.assertTrue(get_data["database_connected"])

    def test_post_database_config_invalid_fails(self) -> None:
        # Test with invalid connection URL, should fail immediately
        response = self.client.post(
            "/config/database",
            json={"connection_url": "garbage_dialect://invalid_path"},
        )
        self.assertEqual(response.status_code, 400)

    def test_get_llm_config(self) -> None:
        response = self.client.get("/config/llm")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("provider", data)
        self.assertIn("model", data)
        self.assertIn("temperature", data)

    def test_post_llm_config(self) -> None:
        response = self.client.post(
            "/config/llm",
            json={"provider": "ollama", "model": "llama3:8b", "temperature": 0.5},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")

        # Verify get reflects updates
        get_response = self.client.get("/config/llm")
        get_data = get_response.json()
        self.assertEqual(get_data["provider"], "ollama")
        self.assertEqual(get_data["model"], "llama3:8b")
        self.assertEqual(get_data["temperature"], 0.5)


if __name__ == "__main__":
    unittest.main()
