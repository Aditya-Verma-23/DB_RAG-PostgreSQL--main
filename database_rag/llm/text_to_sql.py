"""Text-to-SQL generation using Groq LLM with schema awareness."""

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from sqlalchemy.exc import SQLAlchemyError

from config import settings
from database.base import DatabaseProvider, strip_sql_fences
from llm.factory import get_llm


# System prompt for SQL generation
SQL_GENERATION_PROMPT = """You are an expert {dialect} query generator. Convert natural language questions into a valid read-only SQL query.

DATABASE SCHEMA:
{schema}

DATABASE DIALECT RULES:
{dialect_rules}

RULES:
1. ONLY generate SELECT statements (no INSERT, UPDATE, DELETE, DROP, etc.)
2. Follow the database dialect rules above exactly.
3. Always qualify column names with table names or aliases.
4. When joining tables, use ONLY the FOREIGN KEY relationships listed in the schema to
   determine join columns. Never assume a column exists on another table just because a
   same-named column exists elsewhere (e.g. a child table's foreign key often points at a
   differently-named primary key, such as Id, on the parent table).
5. Never reference a table or column not explicitly listed in the schema.
6. Use the dialect's native date and row-limit syntax.
7. When the question asks for all specifications, details, or information about
   a record, select every column from the relevant table using its alias or table name.
8. Return ONLY the SQL query, no explanations or markdown formatting.
9. If the question cannot be answered with the available schema, return: -- UNABLE TO ANSWER

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

    def generate_sql(self, question: str) -> str:
        """Generate SQL from natural language question."""
        return self._generate_sql(question, self.db_provider.get_schema())

    def execute_question(self, question: str) -> list[dict]:
        """Generate SQL from question and execute it."""
        _, results = self.execute_question_with_sql(question)
        return results

    def execute_question_with_sql(self, question: str) -> tuple[str, list[dict]]:
        """Generate and execute SQL, repairing one schema-related failure."""
        sql = self.generate_sql(question)

        if sql.startswith("-- UNABLE TO ANSWER"):
            raise ValueError(f"Cannot answer: {question}")

        try:
            return sql, self.db_provider.execute_query(sql)
        except SQLAlchemyError as first_error:
            schema = self.db_provider.refresh_schema()
            sql = self._generate_sql(
                question,
                schema,
                "The previous SQL failed in the database with this error:\n"
                f"{first_error}\nRegenerate using only the refreshed schema.",
            )
            if sql.startswith("-- UNABLE TO ANSWER"):
                raise ValueError(f"Cannot answer: {question}")
            return sql, self.db_provider.execute_query(sql)

    def _generate_sql(
        self, question: str, schema: str, extra_instruction: str = ""
    ) -> str:
        sql = self._chain.invoke(
            {
                "schema": schema,
                "dialect": self.db_provider.dialect,
                "dialect_rules": self.db_provider.dialect_rules,
                "question": f"{question}\n\n{extra_instruction}",
            }
        )
        return strip_sql_fences(sql)
