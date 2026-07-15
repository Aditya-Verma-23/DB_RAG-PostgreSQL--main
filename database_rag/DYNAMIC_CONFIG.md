# Dynamic Database Configuration

## Overview
The application has been updated to use **fully dynamic database configuration** via the UI. No static database credentials are stored or loaded from configuration files.

## What Changed

### Backend Changes

1. **`config.py`**
   - Removed all static database configuration (`database_url`, `mssql_*` settings)
   - Only LLM configuration remains in settings
   - Database connections are now 100% dynamic via UI

2. **`api/main.py`**
   - Removed automatic database connection on startup
   - Database configuration endpoints now work in session-only mode
   - No longer saves database credentials to `.env` file
   - Added support for raw ODBC connection strings

3. **`database/factory.py`**
   - Updated to accept connection URL as parameter instead of settings object
   - Pure factory function for dynamic database creation

### Frontend Changes

1. **`ui/src/routes/index.tsx`**
   - Bidirectional sync between connection URL and individual fields
   - Real-time URL generation from fields
   - Auto-parsing of connection URLs into fields
   - Copy button for auto-generated URLs

### Configuration Files

1. **`.env`**
   - Removed all database configuration
   - Only LLM settings remain (optional, can also be set via UI)

2. **`.env.example`**
   - Updated to document dynamic-only database configuration

## How It Works

### Starting the Application

1. **Start Backend:**
   ```bash
   cd c:\Projects\DB_RAG-PostgreSQL--main\database_rag
   uv run uvicorn api.main:app --reload --port 8000
   ```

2. **Start Frontend:**
   ```bash
   cd c:\Projects\DB_RAG-PostgreSQL--main\database_rag\ui
   npm run dev
   ```

### Configuring Database

1. Open UI at http://localhost:3000
2. Click **Settings** (gear icon)
3. Go to **Database** tab
4. Choose configuration method:
   - **Connection URL**: Paste your database connection string
   - **Detailed Fields**: Fill in host, port, database, credentials
5. Click **Apply DB Connection**
6. Connection is tested and established immediately

### Supported Databases

- **PostgreSQL** - `postgresql+psycopg://...`
- **MySQL** - `mysql+pymysql://...`
- **SQL Server** - `mssql+pyodbc://...` or raw ODBC strings
- **SQLite** - `sqlite:///path.db`

## Security Benefits

✅ No database credentials stored in version control
✅ No `.env` files with sensitive data
✅ Session-only configuration (cleared on server restart)
✅ Perfect for multi-tenant or shared deployments

## Migration Notes

If you were using static database configuration:

1. Remove `DATABASE_URL` from your `.env`
2. Remove `MSSQL_*` settings from your `.env`
3. Configure database via UI instead
4. Re-connect after each server restart (by design)

## LLM Configuration

LLM settings can still be stored in `.env` for convenience, but can also be configured dynamically via the UI:

- Provider selection
- Model selection
- Temperature
- API keys

## Session Persistence

Database connections are **session-only**:
- ✅ Persists during server runtime
- ✅ Survives frontend refresh
- ❌ Lost on server restart (by design)
- ❌ Not shared between server instances

This is intentional for security and flexibility.
