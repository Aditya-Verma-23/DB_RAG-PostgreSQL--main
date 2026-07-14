from config import Settings
from database.sqlalchemy_provider import SQLAlchemyProvider


def get_database_provider(settings: Settings) -> SQLAlchemyProvider:
    """Create the adapter selected by DATABASE_URL or legacy MSSQL settings."""
    return SQLAlchemyProvider(settings.database_connection_url)
