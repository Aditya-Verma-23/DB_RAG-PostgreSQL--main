from __future__ import annotations

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import SQLAlchemyError

from database.base import DatabaseProvider, validate_query


def dialect_rules(dialect: str) -> str:
    """Return the few syntax rules the LLM needs for a SQLAlchemy dialect."""
    rules = {
        "mssql": (
            "Use SQL Server T-SQL. Use TOP n for row limits, square brackets "
            "for quoted identifiers, and DATEADD for relative dates."
        ),
        "postgresql": (
            "Use PostgreSQL SQL. Use LIMIT n for row limits, double quotes only "
            "when needed for case-sensitive identifiers, and INTERVAL for "
            "relative dates (for example CURRENT_DATE - INTERVAL '30 days')."
        ),
        "sqlite": (
            "Use SQLite SQL. Use LIMIT n for row limits and datetime('now', "
            "'-30 days') for relative date filtering."
        ),
        "mysql": (
            "Use MySQL SQL. Use LIMIT n for row limits, backticks only when "
            "needed for identifiers, and DATE_SUB for relative dates."
        ),
    }
    return rules.get(
        dialect,
        f"Use valid {dialect} SELECT syntax, including its native row-limit "
        "and date functions.",
    )


class SQLAlchemyProvider(DatabaseProvider):
    """Read-only database adapter for any SQLAlchemy-supported dialect."""

    def __init__(self, connection_string: str | URL) -> None:
        self.connection_string = connection_string
        self._engine = None
        self._schema_cache: str | None = None

    def connect(self) -> None:
        self._engine = create_engine(self.connection_string, pool_pre_ping=True)

    def disconnect(self) -> None:
        if self._engine is not None:
            self._engine.dispose()
            self._engine = None
            self._schema_cache = None

    @property
    def dialect(self) -> str:
        if self._engine is None:
            raise RuntimeError("Database not connected. Call connect() first.")
        return self._engine.dialect.name

    @property
    def dialect_rules(self) -> str:
        return dialect_rules(self.dialect)

    def execute_query(self, query: str) -> list[dict]:
        # DATA FLOW: Step 6 (Database SQL Query Execution)
        # Connects to database server, executes raw SQL query via SQLAlchemy, and returns matching dataset.
        if self._engine is None:
            raise RuntimeError("Database not connected. Call connect() first.")
        validate_query(query)
        with self._engine.connect() as conn:
            result = conn.execute(text(query))
            return [dict(row._mapping) for row in result]

    def test_connection(self) -> bool:
        if self._engine is None:
            return False
        try:
            with self._engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except SQLAlchemyError:
            return False

    def get_schema(self) -> str:
        # DATA FLOW: Step 4 (Schema Retrieval)
        # Yields introspected and cached structural layout (tables/keys/views) to build context-aware prompts.
        if self._schema_cache is None:
            self._schema_cache = self._introspect_schema()
        return self._schema_cache

    def refresh_schema(self) -> str:
        self._schema_cache = None
        return self.get_schema()

    def _introspect_schema(self) -> str:
        if self._engine is None:
            raise RuntimeError("Database not connected. Call connect() first.")

        inspector = inspect(self._engine)
        schema = inspector.default_schema_name
        tables = inspector.get_table_names(schema=schema)
        views = inspector.get_view_names(schema=schema)
        lines = []

        for table_name in [*tables, *views]:
            qualified_name = f"{schema}.{table_name}" if schema else table_name
            columns = inspector.get_columns(table_name, schema=schema)
            col_defs = ", ".join(
                f"{column['name']} {column['type']}" for column in columns
            )
            object_type = "VIEW" if table_name in views else "TABLE"
            lines.append(f"{object_type}: {qualified_name}({col_defs})")

            if table_name in views:
                continue

            primary_key = inspector.get_pk_constraint(table_name, schema=schema)
            for column in primary_key.get("constrained_columns") or []:
                lines.append(f"  PRIMARY KEY: {qualified_name}.{column}")

            for foreign_key in inspector.get_foreign_keys(table_name, schema=schema):
                local_columns = ", ".join(foreign_key["constrained_columns"])
                referred_schema = foreign_key.get("referred_schema") or schema
                referred_table = foreign_key["referred_table"]
                referred_columns = ", ".join(foreign_key["referred_columns"])
                target = (
                    f"{referred_schema}.{referred_table}"
                    if referred_schema
                    else referred_table
                )
                lines.append(
                    f"  FOREIGN KEY: {qualified_name}({local_columns}) -> "
                    f"{target}({referred_columns})"
                )

        return "\n".join(lines)
