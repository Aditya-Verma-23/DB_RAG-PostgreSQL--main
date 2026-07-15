from __future__ import annotations

from database.sqlalchemy_provider import SQLAlchemyProvider


class MSSQLProvider(SQLAlchemyProvider):
    """Compatibility adapter for callers that explicitly choose SQL Server."""

    @classmethod
    def from_settings(cls, settings) -> "MSSQLProvider":
        """Build a provider from app Settings (avoids hardcoding connection details)."""
        return cls(settings.mssql_url)
