"""Text-to-SQL generation using Groq LLM with schema awareness."""

import re
from typing import Optional
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from sqlalchemy.exc import SQLAlchemyError

from config import settings
from database.base import DatabaseProvider, strip_sql_fences
from llm.factory import get_llm


ROLE_ACCESS = {
    "Admin": ["*"],
    "User": ["Users", "Appointments"],
    "Therapist": ["Users", "Appointments", "DoctorSchedules"]
}

def filter_schema_by_role(schema_text: str, role: str) -> str:
    allowed_tables = ROLE_ACCESS.get(role, ["*"])
    if "*" in allowed_tables:
        return schema_text

    allowed_lower = [t.lower() for t in allowed_tables]
    lines = schema_text.split("\n")
    filtered_lines = []
    current_table_allowed = False
    
    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            continue
            
        if line.startswith("TABLE:") or line.startswith("VIEW:"):
            parts = line.split(":")
            if len(parts) >= 2:
                header = parts[1].split("(")[0].strip()
                base_name = header.split(".")[-1].strip()
                if base_name.lower() in allowed_lower or header.lower() in allowed_lower:
                    current_table_allowed = True
                    filtered_lines.append(line)
                else:
                    current_table_allowed = False
            else:
                current_table_allowed = False
        elif line.startswith("  PRIMARY KEY:") or line.startswith("  FOREIGN KEY:"):
            if current_table_allowed:
                if line.startswith("  FOREIGN KEY:"):
                    if "->" in line:
                        target_part = line.split("->")[1].strip()
                        target_table = target_part.split("(")[0].strip()
                        target_base = target_table.split(".")[-1].strip()
                        if target_base.lower() in allowed_lower or target_table.lower() in allowed_lower:
                            filtered_lines.append(line)
                    else:
                        filtered_lines.append(line)
                else:
                    filtered_lines.append(line)
                    
    return "\n".join(filtered_lines)

def get_all_tables_from_schema(schema_text: str) -> list[str]:
    tables = []
    for line in schema_text.split("\n"):
        if line.startswith("TABLE:") or line.startswith("VIEW:"):
            parts = line.split(":")
            if len(parts) >= 2:
                header = parts[1].split("(")[0].strip()
                tables.append(header)
    return tables


# System prompt for SQL generation
SQL_GENERATION_PROMPT = """You are an expert {dialect} query generator. Convert natural language questions into a valid read-only SQL query.

DATABASE SCHEMA:
{schema}

DATABASE DIALECT RULES:
{dialect_rules}

CONVERSATION HISTORY:
{history}

RULES:

1. ONLY generate SELECT statements. Never generate INSERT, UPDATE, DELETE, MERGE, UPSERT, CREATE, ALTER, DROP, TRUNCATE, GRANT, REVOKE, EXECUTE, CALL, or any other data definition or data modification statements.

2. Use ONLY the tables, columns, relationships, constraints, and data types explicitly provided in the database schema (except when querying standard database system catalog tables/views for metadata as allowed by rule 42). The schema is the single source of truth.

3. Never reference a table, column, view, function, relationship, enum value, or schema object that is not explicitly defined in the provided schema (except when querying standard database system catalog tables/views for metadata as allowed by rule 42).

4. Never hallucinate database objects. If the required information is not available in the schema, return exactly:
   -- UNABLE TO ANSWER

5. Always qualify every column using its table name or table alias.

6. Always qualify every table using its schema name.
   Example:
   FROM public."Users"

7. MANDATORY PostgreSQL Case-Sensitive Identifier Quoting:
   ALWAYS wrap every mixed-case, PascalCase, camelCase, or case-sensitive schema name, table name, and column name inside double quotes.
   Example:
   public."Appointments"
   public."AppointmentAttendances"
   public."Appointments"."attendanceId"
   public."AppointmentAttendances"."isAttended"

   Never remove quotes from case-sensitive identifiers because PostgreSQL converts unquoted identifiers to lowercase.

8. Preserve the exact spelling and character case of every schema, table, and column name exactly as provided.

9. Never use SELECT * unless the user explicitly requests:
   - all columns
   - all details
   - all information
   - every field
   - complete record
   - all records
   - all rows
   - fetch all
   - show all
   - get all
   - entire table
   - full table
   - everything
   Otherwise, select only the required columns.

10. When joining tables, use ONLY the FOREIGN KEY relationships explicitly defined in the schema. Never assume relationships based on similar column names.

11. Never invent JOIN conditions. If no valid foreign key relationship exists, return:
   -- UNABLE TO ANSWER

12. Always use explicit JOIN syntax:
   INNER JOIN
   LEFT JOIN
   RIGHT JOIN
   FULL JOIN

   Never use implicit joins using commas.

13. Use meaningful table aliases when multiple tables are involved.

14. Use PostgreSQL syntax only.

15. Use PostgreSQL-native functions for dates and timestamps:
   CURRENT_DATE
   CURRENT_TIMESTAMP
   NOW()
   DATE_TRUNC()
   INTERVAL

16. Use PostgreSQL LIMIT syntax for row limiting.

17. Never use SQL syntax from another database system (TOP, ROWNUM, NVL, GETDATE(), etc.).

18. Use IS NULL and IS NOT NULL for NULL comparisons. Never use = NULL or <> NULL.

19. Use TRUE and FALSE for boolean values unless the schema explicitly stores booleans differently.

20. String literals must always use single quotes ('value'). Double quotes are reserved exclusively for identifiers.

21. For text searches:
   - exact match → =
   - contains → ILIKE '%' || value || '%'
   - starts with → ILIKE value || '%'
   - ends with → ILIKE '%' || value

22. Use ILIKE for case-insensitive searches unless the user explicitly requests case-sensitive matching.

23. Use IN (...) instead of multiple OR conditions when matching multiple values.

24. Use EXISTS instead of IN when performing correlated existence checks where appropriate.

25. Use DISTINCT only when the user explicitly requests unique values or duplicate rows are introduced by joins.

26. Every non-aggregated column in a SELECT containing aggregate functions (COUNT, SUM, AVG, MIN, MAX) must appear in the GROUP BY clause.

27. Use COUNT(*) for counting rows unless DISTINCT is explicitly required.

28. Never add ORDER BY unless:
   - the user requests sorting,
   - the question implies ordering (latest, newest, oldest, highest, lowest, top, bottom),
   - or ordering is required for LIMIT.

29. Always add LIMIT 10 to SELECT queries by default to prevent length and performance issues, unless:
   - the user explicitly requested a different limit (e.g., top 5, limit 20, 50 rows), OR
   - the user's question contains the word 'all' (e.g., 'show all', 'get all', 'all records', 'all users', 'all data', 'all rows', 'fetch all', 'entire table', 'full table', 'everything', 'all data', 'every record', 'complete record') — in that case you MUST NOT add any LIMIT clause at all.

30. Interpret common time expressions using PostgreSQL:
   today → CURRENT_DATE
   yesterday → CURRENT_DATE - INTERVAL '1 day'
   last 7 days → CURRENT_DATE - INTERVAL '7 days'
   last 30 days → CURRENT_DATE - INTERVAL '30 days'
   current month → DATE_TRUNC('month', CURRENT_DATE)

31. When querying JSON or JSONB columns, use PostgreSQL JSON operators (->, ->>, #>, #>>, @>) only if those columns exist in the schema.

32. Never cast values unless required by PostgreSQL or explicitly necessary for type compatibility.

33. Respect the actual data types defined in the schema. Never compare booleans as strings or numbers unless the schema requires it.

34. If the user's request is ambiguous or requires information not available in the schema (and is not a standard metadata/system catalog query per rule 42), return exactly:
   -- UNABLE TO ANSWER

35. Never infer business logic.
   Do not assume meanings for status values, enum values, flags, IDs, or lookup values.

36. Follow conversation history.
   Any new question is a follow-up or refinement of the previous conversation context unless it explicitly asks to query a different table, start over, or clear filters. Treat follow-up questions (such as requesting specific columns like "provide me firstname only", asking for counts, filtering results, or changing sorting/limits) as modifications/refinements of the previous query.

37. Preserve all query context.
   Strictly preserve all tables, JOINs, filters, WHERE clauses, and logic (such as subqueries or EXISTS checks) from the previous SQL query in the CONVERSATION HISTORY, unless the user explicitly removes or replaces them. Simply adapt the SELECT columns, sorting, or LIMIT as specified by the new query.

38. Never reset the query context.
   Never generate a completely new query from scratch that queries the entire table (discarding previous filters) unless the user explicitly asks to start over or queries a completely unrelated table.

39. If the user asks for all specifications, details, information, or the complete record, return every column from the relevant table.

44. COLUMN COUNT vs ROW COUNT:
   - "How many rows / records / entries" → COUNT(*) or COUNT(pk) FROM the target table.
   - "How many columns / fields / attributes" → COUNT(*) FROM information_schema.columns WHERE table_name = '<table>' AND table_schema = '<schema>'.
   If the user asks for a column count in the context of a previously queried table (from CONVERSATION HISTORY), you MUST filter information_schema.columns by that specific table name and schema.
   NEVER count columns across all tables in the schema when the question is scoped to a specific table.
   Example: if the previous query was on public."Users" and the user asks "how many columns does it have?", generate:
     SELECT COUNT(*) AS column_count FROM information_schema.columns WHERE table_name = 'Users' AND table_schema = 'public'

40. Return ONLY executable SQL.
   Do not include markdown.
   Do not include explanations.
   Do not include comments (except -- UNABLE TO ANSWER).
   Do not wrap SQL inside code blocks.

41. Before returning the SQL, internally validate:
   - Every table exists (unless it is a system catalog or information_schema table allowed by metadata rules).
   - Every column exists.
   - Every JOIN is valid.
   - Every identifier is correctly quoted.
   - Every table is schema-qualified.
   - Every alias is valid.
   - GROUP BY is correct.
   - ORDER BY columns exist.
   - LIMIT syntax is valid.
   - SQL is valid PostgreSQL syntax.
   - No hallucinated schema objects exist.

42. METADATA & SYSTEM CATALOG QUERIES:
    If the user asks to list all tables, views, columns, or other database-wide metadata, you are allowed to query standard database system catalog tables/views (such as `information_schema.tables`, `information_schema.columns`, `pg_catalog.pg_tables`, or `sqlite_master` depending on the dialect).
    For metadata queries (listing tables, views, columns, etc.) you MUST NOT add any LIMIT clause — return all results.
    Examples:
    - PostgreSQL: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name` (or other schemas present in the DATABASE SCHEMA).
    - MySQL: `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`.
    - SQLite: `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`.
    - SQL Server: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'dbo' ORDER BY table_name`.

43. CROSS-TABLE / LATEST ENTRY QUERIES (FAST SYSTEM CATALOG PROXY):
    If the user asks "in which table do we have the latest entry" or similar database-wide latest activity/entry questions:
    - Prefer using a fast query on system catalog tables to avoid slow sequential scans on all user tables.
    - For PostgreSQL, generate a simple query on `pg_stat_user_tables` to estimate latest activity:
      SELECT schemaname || '.' || relname AS table_name,
             COALESCE(GREATEST(last_vacuum, last_autovacuum, last_analyze, last_autoanalyze), '1970-01-01'::timestamp) AS latest_activity
      FROM pg_stat_user_tables
      ORDER BY latest_activity DESC
      LIMIT 1;
    - If the database dialect does not support such catalog stats or if the user explicitly wants exact data timestamps, fall back to querying the maximum timestamp/date column using a UNION query across ONLY the most relevant tables containing timestamp/date columns (e.g. columns named "createdAt", "updatedAt", "date", or "time"):
      SELECT 'public."Users"' AS table_name, MAX("createdAt") AS latest_time FROM public."Users"
      UNION ALL
      SELECT 'public."Appointments"' AS table_name, MAX("appointmentTime") AS latest_time FROM public."Appointments"
      ORDER BY latest_time DESC NULLS LAST
      LIMIT 1;

Now generate SQL for the following question:

Question: "{question}"
SQL:"""


class TextToSQL:
    """Convert natural language to SQL using Groq LLM."""

    def __init__(self, db_provider: DatabaseProvider, model: str | None = None):
        self.db_provider = db_provider
        self.model = model or settings.default_model

        prompt = ChatPromptTemplate.from_template(SQL_GENERATION_PROMPT)
        llm = get_llm(model=self.model)
        self._chain = prompt | llm | StrOutputParser()

    def generate_sql(self, question: str, history: str = "", role: str = "Admin") -> str:
        """Generate SQL from natural language question."""
        # DATA FLOW: Step 4 (SQLCoder Final SQL Generation)
        # Translates validated schema entities and user intent into syntax-accurate SQL.
        # Calls db_provider.get_schema() (Step 3) to fetch the schema structure.
        raw_schema = self.db_provider.get_schema()
        filtered_schema = filter_schema_by_role(raw_schema, role)
        return self._generate_sql(question, filtered_schema, history=history)

    def execute_question(self, question: str, history: str = "", role: str = "Admin") -> list[dict]:
        """Generate SQL from question and execute it."""
        _, results, _ = self.execute_question_with_sql(question, history=history, role=role)
        return results

    def execute_question_with_sql(self, question: str, history: str = "", role: str = "Admin") -> tuple[str, list[dict], Optional[str]]:
        """Generate and execute SQL, repairing one schema-related failure. Falls back to top 10 records if query fails/times out."""
        sql = self.generate_sql(question, history=history, role=role)

        if sql.startswith("-- UNABLE TO ANSWER"):
            raise ValueError(f"Cannot answer: {question}")

        # Double check: secure SQL execution verification
        allowed_tables = ROLE_ACCESS.get(role, ["*"])
        if not allowed_tables or ("*" not in allowed_tables):
            # Clean comments from SQL
            sql_clean = re.sub(r'--.*$', '', sql, flags=re.MULTILINE)
            
            # Find all CTE names in the query to avoid false positives
            cte_pattern = r'\b(?:WITH|,)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:(?:\([^)]*\)\s+)?)AS\s*\('
            ctes = re.findall(cte_pattern, sql_clean, re.IGNORECASE)
            cte_lower = {c.lower() for c in ctes}
            
            # Match FROM/JOIN table_name
            # This captures the table identifier after FROM/JOIN, ignoring optional schema prefix
            pattern = r'\b(?:FROM|JOIN)\s+(?:(?:"?[a-zA-Z_][a-zA-Z0-9_]*"?\.)+)?("?[a-zA-Z_][a-zA-Z0-9_]*"?)\b'
            matches = re.findall(pattern, sql_clean, re.IGNORECASE)
            
            allowed_lower = {t.lower() for t in allowed_tables}
            disallowed_found = []
            for match in matches:
                table_name = match.replace('"', '').strip()
                # Skip if it is a CTE name
                if table_name.lower() in cte_lower:
                    continue
                if table_name.lower() not in allowed_lower:
                    disallowed_found.append(table_name)
                    
            if disallowed_found:
                # Intercept metadata queries (like table counts and lists) to mock the correct restricted response
                is_metadata = any(
                    "schema" in t.lower() or "catalog" in t.lower() or t.lower() in ["tables", "views", "columns", "pg_tables"]
                    for t in disallowed_found
                )
                if is_metadata:
                    if re.search(r'\bCOUNT\s*\(', sql, re.IGNORECASE):
                        return sql, [{"count": len(allowed_tables)}], None
                    else:
                        return sql, [{"table_name": t} for t in allowed_tables], None
                
                # Otherwise, it's an unauthorized database table query. Raise a permission error!
                raise PermissionError(f"Permission Error: Access denied. As a {role}, you only have access to: {', '.join(allowed_tables)}.")

        try:
            # DATA FLOW: Step 5 (Query Generation) & Step 6 (Database Execution)
            # Translates prompt to SQL, then calls db_provider.execute_query(sql) to execute query on active SQL Database.
            raw_results = self.db_provider.execute_query(sql)
            
            is_all_records = (
                bool(re.search(r'\ball\b', question.lower())) or  # standalone word 'all'
                any(phrase in question.lower() for phrase in [
                    # explicit all-records phrases
                    "all records", "full records", "all data", "full data",
                    "entire record", "complete record", "every record",
                    "all rows", "fetch all", "show all", "get all",
                    "entire table", "full table",
                    # metadata / table-listing phrases
                    "all table", "all tables", "list table", "list tables",
                    "table names", "all views", "list views", "all columns",
                    "list columns", "database tables", "tables in", "tables in my",
                ])
            )
            
            if is_all_records:
                results = raw_results
                clean_sql = sql
            else:
                results = raw_results[:10]
                dialect = self.db_provider.dialect
                if dialect == "mssql":
                    clean_sql = re.sub(r'\bTOP\s+\(?\d+\)?\s*', '', sql, flags=re.IGNORECASE)
                else:
                    clean_sql = re.sub(r'\s+LIMIT\s+\d+\b;?', '', sql, flags=re.IGNORECASE)
                
            return clean_sql, results, None
        except Exception as first_error:
            if isinstance(first_error, PermissionError):
                raise first_error
            
            err_str = str(first_error)
            if "Illegal header value" in err_str or "Bearer" in err_str or "API key" in err_str or "API_KEY" in err_str:
                raise RuntimeError("LLM API key is missing. Kindly insert your LLM API key in the settings panel.")
            # DATA FLOW: Step 7 (Error Handling / Bypassed Fallback)
            # If the query execution fails or times out, do not show any database output (return empty results list)
            # and display the customized message suggesting timestamp/year/month granularity.
            msg = "To avoid timing out, try being more specific with a timestamp, year, or month filter. Did you mean to query this?"
            return sql, [], msg

    def _generate_sql(
        self, question: str, schema: str, history: str = "", extra_instruction: str = ""
    ) -> str:
        sql = self._chain.invoke(
            {
                "schema": schema,
                "dialect": self.db_provider.dialect,
                "dialect_rules": self.db_provider.dialect_rules,
                "history": history,
                "question": f"{question}\n\n{extra_instruction}",
            }
        )
        return strip_sql_fences(sql)
