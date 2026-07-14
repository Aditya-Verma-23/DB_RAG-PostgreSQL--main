"""
app/safety.py

SQL Safety validation module for the DB RAG application.
Applies hard rules (regex patterns) to verify that generated SQL queries are strictly
read-only (SELECT or CTEs starting with WITH) and do not contain database-mutating keywords.
"""

import re
from .exceptions import UnsafeSQLError

ALLOWED_SQL_PREFIX = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)
FORBIDDEN_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE|REPLACE|MERGE|EXEC|EXECUTE|CALL)\b",
    re.IGNORECASE,
)


def validate_sql(sql: str) -> None:
    if not ALLOWED_SQL_PREFIX.match(sql):
        raise UnsafeSQLError(f"Rejected: query does not start with SELECT/WITH.\nSQL: {sql}")
    if FORBIDDEN_KEYWORDS.search(sql):
        raise UnsafeSQLError(f"Rejected: query contains a forbidden keyword.\nSQL: {sql}")
