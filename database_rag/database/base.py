import re
from abc import ABC, abstractmethod
from typing import Any

ALLOWED_STATEMENTS = {"SELECT", "WITH", "EXPLAIN"}
BLOCKED_STATEMENTS = {
    "UPDATE",
    "DELETE",
    "INSERT",
    "DROP",
    "ALTER",
    "CREATE",
    "EXEC",
    "EXECUTE",
    "MERGE",
    "TRUNCATE",
    "BULK",
    "OPENROWSET",
    "OPENDATASOURCE",
}

_COMMENT_RE = re.compile(r"--.*?$|/\*.*?\*/", re.DOTALL | re.MULTILINE)
_FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*|\s*```\s*$")


def _strip_comments(sql: str) -> str:
    """Remove SQL comments (both -- and /* */ styles)."""
    return _COMMENT_RE.sub("", sql)


def strip_sql_fences(sql: str) -> str:
    """Strip markdown code fences some LLMs add despite being told not to."""
    return _FENCE_RE.sub("", sql.strip()).strip()


def validate_query(query: str) -> str:
    """Validate a SQL query and return the top-level statement keyword.

    Raises ``ValueError`` if the query contains a blocked statement or
    cannot be parsed.
    """
    if not query or not query.strip():
        raise ValueError("Query cannot be empty")

    cleaned = strip_sql_fences(query)
    cleaned = _strip_comments(cleaned).strip()

    # Collapse whitespace
    cleaned = " ".join(cleaned.split())

    if not cleaned:
        raise ValueError("Empty query after stripping comments")

    # Extract the first keyword
    match = re.match(r"([A-Za-z_]+)", cleaned)
    if not match:
        raise ValueError("Unable to parse query")

    keyword = match.group(1).upper()

    if keyword in BLOCKED_STATEMENTS:
        raise ValueError(f"Blocked statement: {keyword}")

    if keyword not in ALLOWED_STATEMENTS:
        raise ValueError(f"Unrecognised/forbidden statement: {keyword}")

    return keyword


class DatabaseProvider(ABC):
    """Abstract base class for database providers."""

    @abstractmethod
    def connect(self) -> None:
        """Establish a connection to the database."""
        raise NotImplementedError

    @abstractmethod
    def disconnect(self) -> None:
        """Close the database connection."""
        raise NotImplementedError

    @abstractmethod
    def execute_query(self, query: str) -> Any:
        """Execute a validated read-only query and return the results."""
        raise NotImplementedError

    @abstractmethod
    def test_connection(self) -> bool:
        """Return True if the database connection is healthy."""
        raise NotImplementedError

    @abstractmethod
    def get_schema(self) -> str:
        """Return a string representation of the database schema."""
        raise NotImplementedError

    @abstractmethod
    def refresh_schema(self) -> str:
        """Force a fresh schema introspection and return it."""
        raise NotImplementedError

    @property
    @abstractmethod
    def dialect(self) -> str:
        """Return the active SQL dialect name."""
        raise NotImplementedError

    @property
    @abstractmethod
    def dialect_rules(self) -> str:
        """Return SQL-generation rules for the active dialect."""
        raise NotImplementedError
