# MSSQL Connection String Fix

## Problem
The raw ODBC connection string was failing with "Database connection test failed. Please verify credentials."

**Connection String Used:**
```
Server=192.168.1.95,9905;Database=HardwareInventory;User Id=akash;Password=Sit@321#;TrustServerCertificate=True
```

## Root Cause
The connection string uses **comma-separated port notation** (`192.168.1.95,9905`) which is standard for ODBC/ADO.NET, but SQLAlchemy's URL parser couldn't handle it properly when wrapped in `odbc_connect`.

## Solution
Updated the `/config/database` endpoint to **parse raw ODBC connection strings** and extract individual components:

1. **Server parsing**: Split `192.168.1.95,9905` into `host=192.168.1.95` and `port=9905`
2. **Component extraction**: Parse `User Id`, `Password`, `Database`, `Driver`, `TrustServerCertificate`
3. **Proper URL construction**: Build a SQLAlchemy URL object with correct parameters

## What Was Changed

### `api/main.py`
Added intelligent parsing for raw ODBC connection strings:

```python
# Extract server and port from "Server=host,port" format
server_value = server_match.group(1).strip()
if ',' in server_value:
    server_parts = server_value.split(',')
    server = server_parts[0].strip()
    port = server_parts[1].strip()
else:
    server = server_value
    port = "1433"

# Build proper SQLAlchemy URL
connection_url = URL.create(
    "mssql+pyodbc",
    username=username,
    password=password,
    host=server,
    port=int(port) if port.isdigit() else 1433,
    database=database,
    query={
        "driver": driver,
        "TrustServerCertificate": "yes" if trust_cert else "no"
    }
)
```

## Supported ODBC String Formats

Now supports all these formats:

### Format 1: Comma-separated port (your format)
```
Server=192.168.1.95,9905;Database=HardwareInventory;User Id=akash;Password=Sit@321#;TrustServerCertificate=True
```

### Format 2: Standard port
```
Server=192.168.1.95;Port=9905;Database=HardwareInventory;User Id=akash;Password=Sit@321#;TrustServerCertificate=True
```

### Format 3: With explicit driver
```
Server=192.168.1.95,9905;Database=HardwareInventory;User Id=akash;Password=Sit@321#;Driver={ODBC Driver 18 for SQL Server};TrustServerCertificate=True
```

### Format 4: SQLAlchemy URL (still works)
```
mssql+pyodbc://akash:Sit@321#@192.168.1.95:9905/HardwareInventory?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes
```

## Testing

✅ Connection string parsing: **PASS**
✅ Database connection: **PASS**
✅ Health check: `{"status":"ok","database_connected":true}`
✅ Schema retrieval: **PASS**

## How to Use

### Via UI (Recommended)
1. Open Settings → Database
2. Choose "Detailed Fields" or "Connection URL"
3. If using Connection URL, paste your ODBC string:
   ```
   Server=192.168.1.95,9905;Database=HardwareInventory;User Id=akash;Password=Sit@321#;TrustServerCertificate=True
   ```
4. Click "Apply DB Connection"
5. ✅ Connected!

### Via API
```bash
curl -X POST http://localhost:8000/config/database \
  -H "Content-Type: application/json" \
  -d '{
    "connection_url": "Server=192.168.1.95,9905;Database=HardwareInventory;User Id=akash;Password=Sit@321#;TrustServerCertificate=True"
  }'
```

Response:
```json
{
  "status": "ok",
  "message": "Database connected successfully. Configuration is session-only (dynamic mode)."
}
```

## Notes

- ✅ Comma-separated port notation now works
- ✅ Space in "User Id" handled correctly
- ✅ Special characters in password (`@`, `#`) handled correctly
- ✅ TrustServerCertificate parsed and applied
- ✅ Driver defaults to "ODBC Driver 18 for SQL Server" if not specified
