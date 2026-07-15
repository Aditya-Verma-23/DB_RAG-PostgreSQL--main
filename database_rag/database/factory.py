from database.sqlalchemy_provider import SQLAlchemyProvider


def get_database_provider(connection_url: str) -> SQLAlchemyProvider:
    """Create a database provider for the given connection URL.
    
    This is a factory function for dynamic database configuration.
    The connection URL should be provided via the UI, not from static config.
    """
    return SQLAlchemyProvider(connection_url)
