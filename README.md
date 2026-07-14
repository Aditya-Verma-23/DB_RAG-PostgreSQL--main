# DB Chat — Ask Your Database in Plain English

> Chat with any PostgreSQL, MySQL, or SQLite database using natural language.  
> Powered by **Groq's free API** (Llama 3.3 70B) · Built with **FastAPI** · No paid LLM required.

---

## What it does

You type a question. It generates SQL, runs it against your live database, and gives you a plain-English answer — showing every query it ran so nothing is hidden.

```
You:    Which customers placed the most orders last month?
SQL:    SELECT c.name, COUNT(o.id) AS order_count
        FROM customers c JOIN orders o ON c.id = o.customer_id
        WHERE o.order_date >= '2026-05-01'
        GROUP BY c.name ORDER BY order_count DESC LIMIT 10
Wait:   10 rows returned
Answer: Alice leads with 14 orders, followed by Bob (11) and Carol (9).

You:    What was their average order value?       ← follow-up, remembers context
SQL:    SELECT c.name, AVG(o.amount) AS avg_value ...
Answer: Alice averaged ₹340 per order, Bob ₹210, Carol ₹290.
```

---

## Features

- **Plain-English to SQL** — Llama 3.3 70B reads your schema and writes the query
- **Conversation memory** — follow-up questions like "now filter by city" resolve correctly across up to 10 turns
- **Multi-database support** — PostgreSQL, MySQL, SQLite, MariaDB, MSSQL — anything SQLAlchemy supports
- **Live data, always** — INSERT/UPDATE from outside the app are visible in the next query instantly
- **Auto schema refresh** — new tables/columns picked up automatically every 60 seconds; manual refresh button in the UI
- **Hard safety gate** — only `SELECT` and `WITH` are ever allowed to execute. `DROP`, `DELETE`, `UPDATE`, etc. are rejected in code, independent of the LLM
- **Production Code Split** — Clean, modular directory structure splitting configurations, API routing, safety validations, memory, and query execution engine
- **Free to run** — Groq's free tier gives 1,000 requests/day on Llama 3.3 70B, no credit card

---

## Data Flow & Architecture

The application operates as a sequential pipeline with thread-safe session memory tracking. The detailed flow of data and routing is detailed below.

### 1. Architectural Diagram

```
                              ┌────────────────────────────────────────┐
                              │           Browser (Chat UI)            │
                              └──────────────────┬─────────────────────┘
                                                 │ POST /ask
                                                 ▼
                              ┌────────────────────────────────────────┐
                              │            app/main.py (API)           │
                              └──────────────────┬─────────────────────┘
                                                 │ ask(question, session_id)
                                                 ▼
                              ┌────────────────────────────────────────┐
                              │         app/memory.py (Session)        │
                              │       - Get / create history           │
                              │       - cap at last 10 turns           │
                              └──────────────────┬─────────────────────┘
                                                 │ question + history
                                                 ▼
                              ┌────────────────────────────────────────┐
                              │        app/engine.py (DBRagEngine)     │
                              │       1. generate_sql()                │
                              └──────────────────┬─────────────────────┘
                                                 │ System & User prompts
                                                 ▼
                              ┌────────────────────────────────────────┐
                              │                Groq API                │
                              │        (Llama 3.3 70B / GPT-OSS)       │
                              └──────────────────┬─────────────────────┘
                                                 │ Raw generated SQL
                                                 ▼
                              ┌────────────────────────────────────────┐
                              │        app/safety.py (Validator)       │
                              │      - SELECT/WITH prefix check        │
                              │      - Forbidden keyword search        │
                              └──────────────────┬─────────────────────┘
                                                 │ Safe SQL Query
                                                 ▼
                              ┌────────────────────────────────────────┐
                              │         app/engine.py (Execute)        │
                              │      - Runs query via SQLAlchemy       │
                              │      - Caps returned rows at 200       │
                              └────────────┬──────────────────┬────────┘
                                           │                  │
                         SQL Result Rows   │                  │ SQL Result Rows
                         (up to 50 rows)   ▼                  ▼ (all rows up to 200)
                              ┌──────────────────┐      ┌──────────────────┐
                              │     Groq API     │      │  app/memory.py   │
                              │  (Synthesizer)   │      │  (Save history)  │
                              └────────┬─────────┘      └────────┬─────────┘
                                       │                         │
                   Plain-text answer   ▼                         │
                              ┌──────────────────────────────────┴─────┐
                              │            app/main.py (API)           │
                              └──────────────────┬─────────────────────┘
                                                 │ JSON Response
                                                 ▼
                              ┌────────────────────────────────────────┐
                              │           Browser (Chat UI)            │
                              └────────────────────────────────────────┘
```

### 2. Step-by-Step Data Flow

1. **Client Submission**: The user submits a question on the frontend. The web browser sends a `POST` request to `/ask` payload containing the `{ question: str, session_id: str }`.
2. **Routing and Memory Lookup**: `app/main.py` intercepts the request and routes it to `engine.ask()`. The engine requests the conversation history matching the `session_id` from the thread-safe `SessionStore` (defined in `app/memory.py`).
3. **SQL Generation (Groq)**: The `DBRagEngine` builds a system prompt containing the live database schema (cached and auto-updated by a watcher thread), appends the conversation history turns, and sends it to Groq API to obtain raw SQL.
4. **Safety Check**: Before running, the SQL query is run through the validator in `app/safety.py`. If it doesn't start with `SELECT`/`WITH` or contains mutation keywords like `DELETE` or `DROP`, an `UnsafeSQLError` is raised, stopping execution.
5. **Database Execution**: The validated query runs against the live database using `SQLAlchemy`. Rows are fetched and capped to prevent memory overload.
6. **Answer Synthesis (Groq)**: The engine passes the user's question, the SQL executed, and a preview of the results (first 50 rows) to the Groq model. The model synthesizes this into a natural, plain-English response.
7. **History Update**: The turn (Question, SQL query, Synthesized answer, and error state) is saved back to `SessionStore` for context preservation.
8. **HTTP Response**: The web router packages the final answer, original SQL query, record count, and results array, delivering a JSON payload back to the browser UI.

---

## API Endpoints & Routing

The FastAPI server (routed in [app/main.py](file:///c:/Users/sit327/Desktop/Shaligram/3/DB_RAG-PostgreSQL--main/app/main.py)) exposes the following REST endpoints:

| Method | Path | Request Body | Response JSON | Description |
|---|---|---|---|---|
| `GET` | `/` | *None* | `FileResponse` | Serves the HTML frontend interface from `web/index.html` |
| `POST` | `/ask` | `{ "question": str, "session_id": str }` | `{ "question", "sql", "row_count", "rows", "answer", "error", "turn_count", "history" }` | Translates natural language question to SQL, runs it, and returns the response |
| `POST` | `/session/clear` | `{ "session_id": str }` | `{ "cleared": true, "session_id" }` | Resets conversation history for the specified session |
| `GET` | `/schema` | *None* | `{ "schema": str, "refreshed_at": str }` | Retrieves the currently active cached schema documentation |
| `POST` | `/schema/refresh` | *None* | `{ "refreshed_at", "changed", "schema" }` | Forces an immediate schema introspection from the database |
| `GET` | `/health` | *None* | `{ "status": "ok", "model", "schema_refreshed_at", "schema_ttl_seconds" }` | System status, model in use, and schema caching TTL information |

---

## Quick start

### 1. Get a free Groq API key

Sign up at **[console.groq.com](https://console.groq.com)** — no credit card required.  
Copy your key (starts with `gsk_...`).

### 2. Clone and set up

```bash
git clone https://github.com/your-username/db-chat.git
cd db-chat

python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate.bat

pip install -r requirements.txt
cp .env.example .env
```

### 3. Configure `.env`

```env
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=llama-3.3-70b-versatile
DB_URL=postgresql+psycopg2://user:password@localhost:5432/mydb
ALLOWED_ORIGINS=*
```

### 4. Run

```bash
# Runs the application package
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

Open **[http://localhost:8000](http://localhost:8000)** — the chat UI is served from the same port.

---

## Database connection strings

| Database | DB_URL format |
|---|---|
| PostgreSQL (local) | `postgresql+psycopg2://user:pass@localhost:5432/dbname` |
| PostgreSQL (Neon / Supabase) | `postgresql+psycopg2://user:pass@host.neon.tech/dbname?sslmode=require` |
| MySQL | `mysql+pymysql://user:pass@localhost:3306/dbname` |
| SQLite | `sqlite:///path/to/local.db` |
| MariaDB | `mysql+pymysql://user:pass@localhost:3306/dbname` |
| MSSQL | `mssql+pyodbc://user:pass@host/dbname?driver=ODBC+Driver+17+for+SQL+Server` |

---

## Project Structure

```
db-chat/
├── app/                  # FastAPI Application Package
│   ├── __init__.py       # Exposes FastAPI app instance for clean loading
│   ├── main.py           # Endpoint definitions, schemas, and router setup
│   ├── config.py         # Configuration settings & environment variables
│   ├── exceptions.py     # Custom application exceptions
│   ├── safety.py         # SQL regex matching rules for safety validation
│   ├── memory.py         # Session history tracking and store definitions
│   └── engine.py         # Database schema mapping and query execution engine
├── web/                  # Static assets folder
│   └── index.html        # Chat UI — served at root endpoint (/)
├── requirements.txt      # Python dependencies
├── .env                  # Environment configurations
└── README.md
```

---

## Safety

The app enforces **read-only access in code**, independent of the LLM:

```python
# Only these pass:
ALLOWED_SQL_PREFIX = re.compile(r"^\s*(SELECT|WITH)\b", re.IGNORECASE)

# These are always blocked, even inside subqueries:
FORBIDDEN_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|"
    r"CREATE|REPLACE|MERGE|EXEC|EXECUTE|CALL)\b",
    re.IGNORECASE,
)
```

Additionally, it is recommended to connect with a **read-only database user**:

```sql
-- PostgreSQL example
CREATE USER chatbot_readonly WITH PASSWORD 'yourpassword';
GRANT CONNECT ON DATABASE mydb TO chatbot_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO chatbot_readonly;
```

---

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | — | Required. Your Groq API key |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model to use |
| `DB_URL` | — | Required. SQLAlchemy connection string |
| `ALLOWED_ORIGINS` | `*` | CORS allowed origins. Set to your domain in production |

**In-code constants** (edit [app/config.py](file:///c:/Users/sit327/Desktop/Shaligram/3/DB_RAG-PostgreSQL--main/app/config.py)):

| Constant | Default | Description |
|---|---|---|
| `MAX_ROWS_RETURNED` | `200` | Hard cap on rows returned per query |
| `MAX_HISTORY_TURNS` | `10` | Conversation turns kept in context per session |
| `SESSION_IDLE_MINUTES` | `60` | Minutes before an idle session is cleaned up |

---

## Requirements

- Python 3.10+
- A running database (PostgreSQL, MySQL, or SQLite)
- A free Groq API key

```
openai>=1.50.0
sqlalchemy>=2.0.0
psycopg2-binary>=2.9.9
pymysql>=1.1.0
python-dotenv>=1.0.0
fastapi>=0.115.0
uvicorn>=0.32.0
pydantic>=2.9.0
```

---

## License

MIT
