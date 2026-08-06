# End-to-End Data Flow

This document details the step-by-step processing pipeline of the Database RAG Assistant, showing how a natural language question is processed through intent extraction, schema validation, SQL generation, execution, and final explanation.

---

## Processing Pipeline

```mermaid
flowchart TD
    A[User Question] --> B[Gemma 4 31B Cloud<br/>(Intent + Entity Extraction)]
    B --> C[Schema Validator<br/>(Allowed Tables/Columns)]
    C --> D[SQLCoder 15B<br/>(Final SQL Generation)]
    D --> E[PostgreSQL Database]
    E --> F[Result + Natural Language Explanation]
    
    style A fill:#1a202c,stroke:#38bdf8,stroke-width:2px,color:#fff
    style B fill:#1e293b,stroke:#7dd3c0,stroke-width:2px,color:#fff
    style C fill:#1e293b,stroke:#e0b267,stroke-width:2px,color:#fff
    style D fill:#1e293b,stroke:#a78bfa,stroke-width:2px,color:#fff
    style E fill:#1e293b,stroke:#f43f5e,stroke-width:2px,color:#fff
    style F fill:#1a202c,stroke:#34d399,stroke-width:2px,color:#fff
```

---

## Detailed Step-by-Step Breakdown

### 1. User Question
* **Input:** Natural language query typed by the user in the UI.
* **Component:** [ui/src/routes/index.tsx](file:///c:/Users/sit327/Desktop/Shaligram/3/DB_RAG-PostgreSQL--main/database_rag/ui/src/routes/index.tsx)
* **Function Handle:** `handleSend` (starts at Line 1318) and `handleEditSubmit` (starts at Line 628).
* **Code Block:**
  * Packages the user input text and session history.
  * Dispatches an HTTP `POST` request to the backend `/query` endpoint (Line 1265 and Line 699).

---

### 2. Gemma 4 31B Cloud (Intent + Entity Extraction)
* **Processor:** LLM Intent & Entity Parsing.
* **Component:** [llm/factory.py](file:///c:/Users/sit327/Desktop/Shaligram/3/DB_RAG-PostgreSQL--main/database_rag/llm/factory.py) -> `get_llm` (Line 29) & [ui/src/routes/index.tsx](file:///c:/Users/sit327/Desktop/Shaligram/3/DB_RAG-PostgreSQL--main/database_rag/ui/src/routes/index.tsx) (Line 47).
* **Function Handle:** `OllamaCloudProvider` instantiation inside `get_llm` matching target model `gemma4:31b-cloud`.
* **Code Block:**
  * Selected as the primary RAG parsing model in the UI dropdown settings (defined under `POPULAR_MODELS` in `index.tsx`).
  * Processed via backend `api/main.py` routing (Line 222) which invokes `text_to_sql.execute_question_with_sql`.
  * Extracts user intent and formats database schema parameters accordingly.

---

### 3. Schema Validator (Allowed Tables/Columns)
* **Validator:** Database Inspector & Catalog Matching.
* **Component:** [database/sqlalchemy_provider.py](file:///c:/Users/sit327/Desktop/Shaligram/3/DB_RAG-PostgreSQL--main/database_rag/database/sqlalchemy_provider.py)
* **Function Handle:** `get_schema` (Line 85) & `_introspect_schema` (Line 92).
* **Code Block:**
  * Pulls metadata definitions (tables, constraints, views, columns) from the connection engine.
  * Injects validated schema context into prompt instructions inside `llm/text_to_sql.py` (Line 234: `self.db_provider.get_schema()`), verifying that all referenced objects correspond to allowed tables/columns.

---

### 4. SQLCoder 15B (Final SQL Generation)
* **Generator:** Text-to-SQL Translator.
* **Component:** [llm/text_to_sql.py](file:///c:/Users/sit327/Desktop/Shaligram/3/DB_RAG-PostgreSQL--main/database_rag/llm/text_to_sql.py)
* **Function Handle:** `generate_sql` (Line 231) and `_generate_sql` (Line 287).
* **Code Block:**
  * Builds the localized SQL generation prompt injecting system constraints and DB rules.
  * Invokes the LLM output chain `self._chain.ainvoke(...)` to produce the compiled, read-only SQL query block.

---

### 5. PostgreSQL Database
* **Engine:** Target Database Server.
* **Component:** [database/sqlalchemy_provider.py](file:///c:/Users/sit327/Desktop/Shaligram/3/DB_RAG-PostgreSQL--main/database_rag/database/sqlalchemy_provider.py)
* **Function Handle:** `execute_query` (Line 65).
* **Code Block:**
  * Opens connection to PostgreSQL instance using SQLAlchemy connection engine.
  * Runs execution of the generated query statement (Line 70) and returns records mapped to a list of dicts.
  * Features syntax fallback handlers inside `execute_question_with_sql` in `text_to_sql.py` (Line 233) to return empty results and custom timeout recommendations directly if execution fails or times out.

---

### 6. Result + Natural Language Explanation
* **Output:** UI Rendering & Content Display.
* **Component:** [ui/src/routes/index.tsx](file:///c:/Users/sit327/Desktop/Shaligram/3/DB_RAG-PostgreSQL--main/database_rag/ui/src/routes/index.tsx)
* **Function Handle:** JSX Render block (Lines 1720–1835).
* **Code Block:**
  * Receives `QueryResponse` containing execution columns and rows.
  * Renders markdown description texts inside message text nodes.
  * Renders query results as an interactive grid container table `results-table-container` (Line 1728) alongside collapsible generated SQL preview panels.
