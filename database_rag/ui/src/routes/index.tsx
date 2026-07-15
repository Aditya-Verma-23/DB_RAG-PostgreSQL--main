import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useEffect } from 'react'
import { 
  Database, 
  Cpu, 
  RefreshCw, 
  Check, 
  Copy, 
  AlertTriangle, 
  Trash2, 
  Send, 
  Wifi, 
  WifiOff, 
  ChevronDown, 
  ChevronRight, 
  Key, 
  Link as LinkIcon, 
  Server, 
  Table, 
  Search, 
  Code,
  Info,
  Activity,
  Settings,
  X,
  MessageSquare,
  Plus
} from 'lucide-react'

export const Route = createFileRoute('/')({ component: ChatApp })

const BACKEND_URL = 'http://localhost:8000'

const POPULAR_MODELS = {
  groq: [
    { value: 'llama-3.3-70b-specdec', label: 'Llama 3.3 70B (SpecDec)' },
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Versatile)' },
    { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7b' },
    { value: 'gemma2-9b-it', label: 'Gemma 2 9B IT' }
  ],
  ollama_cloud: [
    { value: 'gemma4:31b-cloud', label: 'Gemma 4 31B Cloud' },
    { value: 'gemma3:27b', label: 'Gemma 3 27B' },
    { value: 'gemma3:8b', label: 'Gemma 3 8B' }
  ],
  ollama: [
    { value: 'llama3.3', label: 'Llama 3.3' },
    { value: 'llama3', label: 'Llama 3' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'gemma2', label: 'Gemma 2' }
  ]
}

interface SchemaTable {
  type: 'TABLE' | 'VIEW';
  name: string;
  columnsStr: string;
  primaryKeys: string[];
  foreignKeys: string[];
}

interface Message {
  role: 'user' | 'bot';
  content?: string;
  sql?: string;
  results?: Array<Record<string, any>>;
  rowCount?: number;
  error?: string;
  loading?: boolean;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
}

const parseSchema = (text: string): SchemaTable[] => {
  if (!text) return [];
  const tables: SchemaTable[] = [];
  const lines = text.split('\n');
  let currentTable: SchemaTable | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('TABLE:') || trimmed.startsWith('VIEW:')) {
      if (currentTable) {
        tables.push(currentTable);
      }
      const type = trimmed.startsWith('VIEW:') ? 'VIEW' : 'TABLE';
      const afterPrefix = trimmed.substring(type === 'VIEW' ? 5 : 6).trim();
      const openParenIndex = afterPrefix.indexOf('(');
      const closeParenIndex = afterPrefix.lastIndexOf(')');
      
      let name = afterPrefix;
      let columnsStr = '';
      if (openParenIndex !== -1 && closeParenIndex !== -1) {
        name = afterPrefix.substring(0, openParenIndex).trim();
        columnsStr = afterPrefix.substring(openParenIndex + 1, closeParenIndex).trim();
      }

      currentTable = {
        type,
        name,
        columnsStr,
        primaryKeys: [],
        foreignKeys: []
      };
    } else if (currentTable) {
      if (trimmed.startsWith('PRIMARY KEY:')) {
        const pk = trimmed.substring(12).trim();
        const parts = pk.split('.');
        const col = parts[parts.length - 1] || pk;
        currentTable.primaryKeys.push(col);
      } else if (trimmed.startsWith('FOREIGN KEY:')) {
        const fk = trimmed.substring(12).trim();
        currentTable.foreignKeys.push(fk);
      }
    }
  }
  if (currentTable) {
    tables.push(currentTable);
  }
  return tables;
};

const parseColumns = (columnsStr: string): Array<{ name: string; type: string }> => {
  if (!columnsStr) return [];
  const cols: Array<{ name: string; type: string }> = [];
  let current = '';
  let parenDepth = 0;
  
  for (let i = 0; i < columnsStr.length; i++) {
    const char = columnsStr[i];
    if (char === '(') {
      parenDepth++;
    } else if (char === ')') {
      parenDepth--;
    }
    
    if (char === ',' && parenDepth === 0) {
      pushColumn(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) {
    pushColumn(current);
  }
  
  function pushColumn(colText: string) {
    const trimmed = colText.trim();
    if (!trimmed) return;
    const firstSpace = trimmed.indexOf(' ');
    if (firstSpace !== -1) {
      cols.push({
        name: trimmed.substring(0, firstSpace).trim(),
        type: trimmed.substring(firstSpace + 1).trim()
      });
    } else {
      cols.push({ name: trimmed, type: 'UNKNOWN' });
    }
  }
  
  return cols;
};

// Parse connection URL into individual fields
const parseConnectionString = (connectionString: string) => {
  const defaultValues = {
    dialect: 'postgresql',
    host: 'localhost',
    port: '',
    database: '',
    username: '',
    password: '',
    driver: 'ODBC Driver 18 for SQL Server',
    trustCert: true
  };

  if (!connectionString) return defaultValues;

  try {
    // Handle mssql+pyodbc:// URLs
    if (connectionString.startsWith('mssql+pyodbc://')) {
      const url = connectionString.replace('mssql+pyodbc://', 'http://');
      const parsed = new URL(url);
      
      const driverMatch = connectionString.match(/[?&]driver=([^&]+)/i);
      const trustCertMatch = connectionString.match(/[?&]TrustServerCertificate=([^&]+)/i);
      
      return {
        dialect: 'mssql',
        host: parsed.hostname || 'localhost',
        port: parsed.port || '1433',
        database: parsed.pathname?.substring(1) || '',
        username: parsed.username || '',
        password: parsed.password || '',
        driver: driverMatch ? decodeURIComponent(driverMatch[1]) : defaultValues.driver,
        trustCert: trustCertMatch ? trustCertMatch[1].toLowerCase() === 'yes' : defaultValues.trustCert
      };
    }

    // Handle postgresql://, mysql://, etc.
    const dialectMatch = connectionString.match(/^([^:]+):\/\//);
    const dialect = dialectMatch ? dialectMatch[1] : 'postgresql';
    
    // Remove dialect prefix and parse
    const urlToParse = connectionString.replace(/^[^:]+:\/\//, 'http://');
    const parsed = new URL(urlToParse);
    
    return {
      dialect: dialect === 'postgresql' ? 'postgresql' : dialect === 'mysql' ? 'mysql' : dialect === 'sqlite' ? 'sqlite' : 'postgresql',
      host: parsed.hostname || 'localhost',
      port: parsed.port || (dialect === 'postgresql' ? '5432' : dialect === 'mysql' ? '3306' : ''),
      database: parsed.pathname?.substring(1) || '',
      username: parsed.username || '',
      password: parsed.password || '',
      driver: defaultValues.driver,
      trustCert: defaultValues.trustCert
    };
  } catch (e) {
    return defaultValues;
  }
};

// Build connection URL from individual fields
const buildConnectionString = (config: {
  dialect: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  driver: string;
  trustCert: boolean;
}) => {
  const { dialect, host, port, database, username, password, driver, trustCert } = config;

  if (dialect === 'sqlite') {
    return `sqlite:///${database}`;
  }

  if (dialect === 'mssql') {
    const encodedPassword = encodeURIComponent(password);
    let url = `mssql+pyodbc://${username}:${encodedPassword}@${host}:${port}/${database}`;
    url += `?driver=${encodeURIComponent(driver)}`;
    if (trustCert) {
      url += `&TrustServerCertificate=yes`;
    }
    return url;
  }

  // PostgreSQL, MySQL, etc.
  const encodedPassword = encodeURIComponent(password);
  const portPart = port ? `:${port}` : '';
  return `${dialect}://${username}:${encodedPassword}@${host}${portPart}/${database}`;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button className="copy-btn" onClick={handleCopy} type="button">
      {copied ? <Check size={12} /> : <Copy size={12} />}
      <span>{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  )
}

function ChatApp() {
  const [activeTab, setActiveTab] = useState<'database' | 'llm' | 'schema'>('database')
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null) // null = loading
  const [dbConnected, setDbConnected] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  
  // Chat session management
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', content: 'Hello! I am your Database RAG Assistant. Ask me questions about your database, and I will generate SQL queries to fetch the answers.' }
  ])

  // Database configurations
  const [dbConfigMethod, setDbConfigMethod] = useState<'url' | 'fields'>('url')
  const [dbConfigUrl, setDbConfigUrl] = useState('')
  const [dbDialect, setDbDialect] = useState('postgresql')
  const [dbHost, setDbHost] = useState('localhost')
  const [dbPort, setDbPort] = useState('')
  const [dbName, setDbName] = useState('')
  const [dbUser, setDbUser] = useState('')
  const [dbPassword, setDbPassword] = useState('')
  const [dbDriver, setDbDriver] = useState('ODBC Driver 18 for SQL Server')
  const [dbTrustCert, setDbTrustCert] = useState(true)

  // LLM configurations
  const [llmProvider, setLlmProvider] = useState('ollama_cloud')
  const [llmModel, setLlmModel] = useState('gemma4:31b-cloud')
  const [customModel, setCustomModel] = useState('')
  const [isCustomModel, setIsCustomModel] = useState(false)
  const [llmTemp, setLlmTemp] = useState(0.0)
  const [groqKey, setGroqKey] = useState('')
  const [ollamaCloudKey, setOllamaCloudKey] = useState('')
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')

  // UI status logs
  const [dbStatusMsg, setDbStatusMsg] = useState<{type: 'success' | 'error', text: string} | null>(null)
  const [llmStatusMsg, setLlmStatusMsg] = useState<{type: 'success' | 'error', text: string} | null>(null)

  // Schema state
  const [schemaText, setSchemaText] = useState('')
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaError, setSchemaError] = useState('')
  const [schemaSearch, setSchemaSearch] = useState('')
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({})

  // Track if user is editing URL or fields to prevent sync loops
  const [isSyncingFromUrl, setIsSyncingFromUrl] = useState(false)
  const [isSyncingFromFields, setIsSyncingFromFields] = useState(false)

  // Chat input
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Load chat sessions from localStorage on mount
  useEffect(() => {
    const savedSessions = localStorage.getItem('chatSessions')
    const savedCurrentId = localStorage.getItem('currentSessionId')
    
    if (savedSessions) {
      const sessions = JSON.parse(savedSessions)
      setChatSessions(sessions)
      
      if (savedCurrentId && sessions.find((s: ChatSession) => s.id === savedCurrentId)) {
        setCurrentSessionId(savedCurrentId)
        const currentSession = sessions.find((s: ChatSession) => s.id === savedCurrentId)
        if (currentSession) {
          setMessages(currentSession.messages)
        }
      } else if (sessions.length > 0) {
        // Load most recent session
        const mostRecent = sessions[0]
        setCurrentSessionId(mostRecent.id)
        setMessages(mostRecent.messages)
      }
    }
  }, [])

  // Save sessions to localStorage whenever they change
  useEffect(() => {
    if (chatSessions.length > 0) {
      localStorage.setItem('chatSessions', JSON.stringify(chatSessions))
    }
  }, [chatSessions])

  // Save current session ID
  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem('currentSessionId', currentSessionId)
    }
  }, [currentSessionId])

  const createNewChat = () => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: 'New Chat',
      createdAt: Date.now(),
      messages: [
        { role: 'bot', content: 'Hello! I am your Database RAG Assistant. Ask me questions about your database, and I will generate SQL queries to fetch the answers.' }
      ]
    }
    
    setChatSessions(prev => [newSession, ...prev])
    setCurrentSessionId(newSession.id)
    setMessages(newSession.messages)
  }

  const updateCurrentSession = (updatedMessages: Message[]) => {
    if (!currentSessionId) return
    
    setChatSessions(prev => prev.map(session => {
      if (session.id === currentSessionId) {
        // Generate title from first user message if still "New Chat"
        let title = session.title
        if (title === 'New Chat') {
          const firstUserMessage = updatedMessages.find(m => m.role === 'user' && m.content)
          if (firstUserMessage && firstUserMessage.content) {
            title = firstUserMessage.content.substring(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '')
          }
        }
        return { ...session, messages: updatedMessages, title }
      }
      return session
    }))
  }

  const deleteSession = (sessionId: string) => {
    setChatSessions(prev => {
      const filtered = prev.filter(s => s.id !== sessionId)
      
      // If we deleted the current session, switch to another or create new
      if (sessionId === currentSessionId) {
        if (filtered.length > 0) {
          setCurrentSessionId(filtered[0].id)
          setMessages(filtered[0].messages)
        } else {
          // Create a new session if all are deleted
          const newSession: ChatSession = {
            id: Date.now().toString(),
            title: 'New Chat',
            createdAt: Date.now(),
            messages: [
              { role: 'bot', content: 'Hello! I am your Database RAG Assistant. Ask me questions about your database, and I will generate SQL queries to fetch the answers.' }
            ]
          }
          setCurrentSessionId(newSession.id)
          setMessages(newSession.messages)
          return [newSession]
        }
      }
      
      return filtered
    })
  }

  const loadSession = (sessionId: string) => {
    const session = chatSessions.find(s => s.id === sessionId)
    if (session) {
      setCurrentSessionId(sessionId)
      setMessages(session.messages)
    }
  }

  const checkHealthAndLoadConfigs = async () => {
    setBackendConnected(null)
    try {
      const res = await fetch(`${BACKEND_URL}/health`)
      if (!res.ok) throw new Error("Backend not responding correctly")
      const healthData = await res.json()
      setBackendConnected(true)
      setDbConnected(healthData.database_connected)

      // Fetch configs
      const [dbRes, llmRes] = await Promise.all([
        fetch(`${BACKEND_URL}/config/database`),
        fetch(`${BACKEND_URL}/config/llm`)
      ])

      if (dbRes.ok) {
        const dbData = await dbRes.json()
        setDbConfigUrl(dbData.connection_url || '')
        setDbDialect(dbData.dialect || 'postgresql')
        setDbHost(dbData.host || 'localhost')
        setDbPort(dbData.port ? String(dbData.port) : '')
        setDbName(dbData.database || '')
        setDbUser(dbData.username || '')
        if (dbData.connection_url) {
          setDbConfigMethod('url')
        } else if (dbData.dialect) {
          setDbConfigMethod('fields')
        }
      }

      if (llmRes.ok) {
        const llmData = await llmRes.json()
        const provider = llmData.provider || 'ollama_cloud'
        setLlmProvider(provider)
        setLlmTemp(llmData.temperature ?? 0.0)
        setOllamaUrl(llmData.ollama_base_url || 'http://localhost:11434')
        
        const modelName = llmData.model || ''
        const popularList = POPULAR_MODELS[provider as keyof typeof POPULAR_MODELS] || []
        const isPopular = popularList.some(m => m.value === modelName)
        if (isPopular) {
          setLlmModel(modelName)
          setIsCustomModel(false)
        } else if (modelName) {
          setLlmModel('custom')
          setCustomModel(modelName)
          setIsCustomModel(true)
        }
      }

      if (healthData.database_connected) {
        fetchSchema()
      }
    } catch (err) {
      console.error("Health check / load configs failed:", err)
      setBackendConnected(false)
    }
  }

  const fetchSchema = async () => {
    setSchemaLoading(true)
    setSchemaError('')
    try {
      const res = await fetch(`${BACKEND_URL}/schema`)
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.detail || 'Failed to fetch schema')
      }
      const data = await res.json()
      setSchemaText(data.db_schema || 'No schema information returned.')
    } catch (err: any) {
      setSchemaError(err.message || 'Failed to load database schema.')
    } finally {
      setSchemaLoading(false)
    }
  }

  const handleRefreshSchema = async () => {
    setSchemaLoading(true)
    setSchemaError('')
    try {
      const res = await fetch(`${BACKEND_URL}/schema/refresh`, { method: 'POST' })
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.detail || 'Failed to refresh schema')
      }
      const data = await res.json()
      setSchemaText(data.db_schema || 'No schema information returned.')
      setDbStatusMsg({ type: 'success', text: 'Schema refreshed successfully!' })
    } catch (err: any) {
      setSchemaError(err.message || 'Failed to refresh database schema.')
    } finally {
      setSchemaLoading(false)
    }
  }

  useEffect(() => {
    checkHealthAndLoadConfigs()
  }, [])

  // Sync from URL to fields (when URL changes and user is in URL mode or just loaded)
  useEffect(() => {
    if (isSyncingFromFields) return; // Don't sync if we're currently syncing from fields
    
    if (dbConfigUrl && dbConfigMethod === 'url') {
      setIsSyncingFromUrl(true);
      const parsed = parseConnectionString(dbConfigUrl);
      setDbDialect(parsed.dialect);
      setDbHost(parsed.host);
      setDbPort(parsed.port);
      setDbName(parsed.database);
      setDbUser(parsed.username);
      setDbPassword(parsed.password);
      if (parsed.dialect === 'mssql') {
        setDbDriver(parsed.driver);
        setDbTrustCert(parsed.trustCert);
      }
      setIsSyncingFromUrl(false);
    }
  }, [dbConfigUrl]);

  // Sync from fields to URL (when any field changes and user is in fields mode)
  useEffect(() => {
    if (isSyncingFromUrl) return; // Don't sync if we're currently syncing from URL
    
    if (dbConfigMethod === 'fields') {
      setIsSyncingFromFields(true);
      const url = buildConnectionString({
        dialect: dbDialect,
        host: dbHost,
        port: dbPort,
        database: dbName,
        username: dbUser,
        password: dbPassword,
        driver: dbDriver,
        trustCert: dbTrustCert
      });
      setDbConfigUrl(url);
      setIsSyncingFromFields(false);
    }
  }, [dbDialect, dbHost, dbPort, dbName, dbUser, dbPassword, dbDriver, dbTrustCert, dbConfigMethod]);

  const handleProviderChange = (provider: string) => {
    setLlmProvider(provider)
    const models = POPULAR_MODELS[provider as keyof typeof POPULAR_MODELS] || []
    if (models.length > 0) {
      setLlmModel(models[0].value)
      setIsCustomModel(false)
    } else {
      setLlmModel('custom')
      setIsCustomModel(true)
    }
  }

  const handleModelChange = (value: string) => {
    if (value === 'custom') {
      setIsCustomModel(true)
      setLlmModel('custom')
    } else {
      setIsCustomModel(false)
      setLlmModel(value)
    }
  }

  const handleApplyDbConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setDbStatusMsg(null)
    setLoading(true)

    const payload: any = {}
    if (dbConfigMethod === 'url') {
      if (!dbConfigUrl.trim()) {
        setDbStatusMsg({ type: 'error', text: 'Connection URL is required' })
        setLoading(false)
        return
      }
      payload.connection_url = dbConfigUrl
    } else {
      payload.dialect = dbDialect
      if (dbDialect === 'sqlite') {
        if (!dbName.trim()) {
          setDbStatusMsg({ type: 'error', text: 'Database file path is required for SQLite' })
          setLoading(false)
          return
        }
        payload.database = dbName
      } else {
        if (!dbName.trim()) {
          setDbStatusMsg({ type: 'error', text: 'Database name is required' })
          setLoading(false)
          return
        }
        payload.host = dbHost || 'localhost'
        payload.port = dbPort ? parseInt(dbPort) : undefined
        payload.database = dbName
        payload.username = dbUser || undefined
        payload.password = dbPassword || undefined
        if (dbDialect === 'mssql') {
          payload.driver = dbDriver || 'ODBC Driver 18 for SQL Server'
          payload.trust_server_certificate = dbTrustCert
        }
      }
    }

    try {
      const res = await fetch(`${BACKEND_URL}/config/database`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to configure database')
      }

      setDbStatusMsg({ type: 'success', text: data.message || 'Database connected successfully' })
      setDbConnected(true)
      fetchSchema()
    } catch (err: any) {
      setDbStatusMsg({ type: 'error', text: err.message || 'Failed to connect database' })
      setDbConnected(false)
    } finally {
      setLoading(false)
    }
  }

  const handleApplyLlmConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setLlmStatusMsg(null)
    setLoading(true)

    const selectedModel = isCustomModel ? customModel : llmModel
    if (!selectedModel.trim() || selectedModel === 'custom') {
      setLlmStatusMsg({ type: 'error', text: 'Please select or enter a valid model name' })
      setLoading(false)
      return
    }

    const payload: any = {
      provider: llmProvider,
      model: selectedModel,
      temperature: llmTemp
    }

    if (llmProvider === 'groq') {
      if (groqKey) payload.groq_api_key = groqKey
    } else if (llmProvider === 'ollama_cloud') {
      if (ollamaCloudKey) payload.ollama_cloud_api_key = ollamaCloudKey
    } else if (llmProvider === 'ollama') {
      payload.ollama_base_url = ollamaUrl
    }

    try {
      const res = await fetch(`${BACKEND_URL}/config/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to configure LLM')
      }

      setLlmStatusMsg({ type: 'success', text: data.message || 'LLM settings updated successfully' })
      
      setMessages(prev => [...prev, {
        role: 'bot',
        content: `LLM settings updated in backend: Connected using provider **${llmProvider}** with model **${selectedModel}** (temperature ${llmTemp}).`
      }])
    } catch (err: any) {
      setLlmStatusMsg({ type: 'error', text: err.message || 'Failed to configure LLM' })
    } finally {
      setLoading(false)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || loading) return
    const userQuery = input.trim()
    setInput('')

    // Append user message
    const updatedMessages = [...messages, { role: 'user', content: userQuery } as Message]
    setMessages(updatedMessages)
    
    // Add temporary loading bot message
    setMessages(prev => [...prev, { role: 'bot', loading: true } as Message])
    setLoading(true)

    try {
      const res = await fetch(`${BACKEND_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userQuery })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || 'Failed to execute query')
      }

      // Replace loading bot message with actual results
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'bot',
          sql: data.sql,
          results: data.results,
          rowCount: data.row_count
        }
        // Update session with new messages
        updateCurrentSession(next)
        return next
      })
    } catch (err: any) {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'bot',
          error: err.message || 'An error occurred during query execution.'
        }
        // Update session with error message
        updateCurrentSession(next)
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const toggleTableExpanded = (tableName: string) => {
    setExpandedTables(prev => ({
      ...prev,
      [tableName]: !prev[tableName]
    }))
  }

  // Parse schema blocks
  const schemaTables = parseSchema(schemaText)
  const filteredTables = schemaTables.filter(t => 
    t.name.toLowerCase().includes(schemaSearch.toLowerCase()) ||
    t.columnsStr.toLowerCase().includes(schemaSearch.toLowerCase())
  )

  // Fullscreen loader if backend status is unknown
  if (backendConnected === null) {
    return (
      <div className="fullscreen-loading">
        <div className="glass-loader">
          <Activity size={48} className="pulse-icon" />
          <h2>Connecting to Backend Service...</h2>
          <p>Verifying API server at {BACKEND_URL}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      {/* Configuration Sidebar */}
      <aside className="config-sidebar">
        <div className="config-header">
          <Database size={24} style={{ color: 'var(--accent)' }} />
          <h2>DB RAG Manager</h2>
        </div>

        {/* Sidebar Header with New Chat Button */}
        <div className="sidebar-header">
          <h3>Chat Sessions</h3>
          <button 
            className="btn btn-sm btn-primary"
            onClick={createNewChat}
            type="button"
            title="Start a new chat"
          >
            <Plus size={16} />
            New Chat
          </button>
        </div>
        
        {/* Sessions List */}
        <div className="sessions-list">
          {chatSessions.length === 0 ? (
            <div className="sessions-empty">
              <MessageSquare size={48} className="sessions-empty-icon" />
              <h4>No chat sessions</h4>
              <p>Click "New Chat" to start a conversation.</p>
            </div>
          ) : (
            chatSessions.map((session) => (
              <div 
                key={session.id} 
                className={`session-item ${currentSessionId === session.id ? 'active' : ''}`}
                onClick={() => loadSession(session.id)}
              >
                <div className="session-item-content">
                  <div className="session-item-title">
                    <MessageSquare size={14} />
                    <span>{session.title}</span>
                  </div>
                  <div className="session-item-meta">
                    <span className="session-item-date">
                      {new Date(session.createdAt).toLocaleDateString()}
                    </span>
                    <span className="session-item-count">
                      {session.messages.length} msgs
                    </span>
                  </div>
                </div>
                <button 
                  className="session-item-delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteSession(session.id)
                  }}
                  type="button"
                  title="Delete session"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="chat-container">
        {/* Connection status overlay for frontend if backend is offline */}
        {!backendConnected && (
          <div className="backend-offline-banner">
            <WifiOff size={16} />
            <span>Backend service is offline. Please make sure the FastAPI server is running on port 8000.</span>
            <button className="btn-retry" onClick={checkHealthAndLoadConfigs} type="button">
              <RefreshCw size={12} />
              Retry Connection
            </button>
          </div>
        )}

        <header className="chat-header">
          <div className="chat-header-info">
            <div className={`status-indicator ${dbConnected ? 'online' : 'offline'}`}></div>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Database RAG Assistant</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                Powered by {llmProvider === 'groq' ? 'Groq' : llmProvider === 'ollama_cloud' ? 'Ollama Cloud' : 'Local Ollama'}: {isCustomModel ? customModel : llmModel}
              </p>
            </div>
          </div>
          <div className="chat-header-actions">
            <button 
              className="icon-btn" 
              title="Settings" 
              onClick={() => setSettingsOpen(true)}
              type="button"
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        <div className="chat-messages">
          {messages.map((msg, idx) => (
            <div key={idx} className={`message-wrapper ${msg.role}`}>
              <div className="avatar">
                {msg.role === 'bot' ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                    <path d="M12 8V4H8" />
                    <rect height="12" rx="2" width="16" x="4" y="8" />
                    <path d="M2 14h2" />
                    <path d="M20 14h2" />
                    <path d="M15 13v2" />
                    <path d="M9 13v2" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'white' }}>
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
              </div>
              
              {msg.loading ? (
                <div className="message-content loading">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              ) : (
                <div className="message-content">
                  {msg.content && <div className="msg-text">{msg.content}</div>}
                  
                  {msg.sql && (
                    <div className="sql-box">
                      <div className="sql-header">
                        <div className="sql-title">
                          <Code size={14} />
                          <span>Generated SQL Query</span>
                        </div>
                        <CopyButton text={msg.sql} />
                      </div>
                      <pre className="sql-pre">
                        <code>{msg.sql}</code>
                      </pre>
                    </div>
                  )}

                  {msg.results && msg.results.length > 0 && (
                    <div className="results-box">
                      <div className="results-header">
                        <div className="results-title">
                          <Table size={14} />
                          <span>Query Results ({msg.rowCount || msg.results.length} rows)</span>
                        </div>
                        <CopyButton text={JSON.stringify(msg.results, null, 2)} />
                      </div>
                      <div className="results-table-container">
                        <table className="results-table">
                          <thead>
                            <tr>
                              {Object.keys(msg.results[0]).map((key) => (
                                <th key={key}>{key}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {msg.results.map((row, rIdx) => (
                              <tr key={rIdx}>
                                {Object.values(row).map((val: any, cIdx) => {
                                  let displayVal = val
                                  let isNull = false
                                  if (val === null || val === undefined) {
                                    displayVal = 'NULL'
                                    isNull = true
                                  } else if (typeof val === 'boolean') {
                                    displayVal = val ? 'TRUE' : 'FALSE'
                                  } else if (typeof val === 'object') {
                                    displayVal = JSON.stringify(val)
                                  }
                                  return (
                                    <td key={cIdx} className={isNull ? 'null-val' : ''}>
                                      {displayVal}
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {msg.results && msg.results.length === 0 && msg.sql && (
                    <div className="no-results-box">
                      <Info size={16} />
                      <span>Query executed successfully but returned 0 rows.</span>
                    </div>
                  )}

                  {msg.error && (
                    <div className="error-box">
                      <div className="error-header">
                        <AlertTriangle size={16} />
                        <span>Execution Error</span>
                      </div>
                      <div className="error-details">
                        {msg.error}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-container">
          {!dbConnected && (
            <div className="chat-warning-overlay">
              <AlertTriangle size={20} />
              <span>Please configure and connect to a database in the sidebar to ask questions.</span>
            </div>
          )}
          <div className={`chat-input-wrapper ${!dbConnected ? 'disabled' : ''}`}>
            <textarea 
              className="chat-input" 
              placeholder={dbConnected ? "Ask a question about your database (e.g. 'show top 5 items')" : "Connect to a database first..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!dbConnected || loading}
              rows={1}
            />
            <button 
              className="send-btn" 
              onClick={handleSend} 
              disabled={!input.trim() || !dbConnected || loading}
              type="button"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Settings</h3>
              <button className="modal-close" onClick={() => setSettingsOpen(false)} type="button">
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-tabs">
              <button 
                className={`modal-tab ${activeTab === 'database' ? 'active' : ''}`}
                onClick={() => setActiveTab('database')}
                type="button"
              >
                <Database size={16} />
                Database
              </button>
              <button 
                className={`modal-tab ${activeTab === 'llm' ? 'active' : ''}`}
                onClick={() => setActiveTab('llm')}
                type="button"
              >
                <Cpu size={16} />
                LLM
              </button>
              <button 
                className={`modal-tab ${activeTab === 'schema' ? 'active' : ''}`}
                onClick={() => setActiveTab('schema')}
                type="button"
              >
                <Table size={16} />
                Schema
              </button>
            </div>

            <div className="modal-body">
              {/* Tab 1: Schema */}
              {activeTab === 'schema' && (
                <div className="modal-tab-panel">
                  <div className="schema-browser">
                    <div className="search-box-container">
                      <Search size={16} className="search-icon" />
                      <input 
                        type="text" 
                        placeholder="Search tables or columns..." 
                        value={schemaSearch}
                        onChange={(e) => setSchemaSearch(e.target.value)}
                        className="schema-search-input"
                      />
                    </div>
                    
                    <div className="schema-list">
                      {filteredTables.length === 0 ? (
                        <div className="no-results">No matching tables found.</div>
                      ) : (
                        filteredTables.map((tbl) => {
                          const isExpanded = !!expandedTables[tbl.name]
                          const cols = parseColumns(tbl.columnsStr)
                          return (
                            <div key={tbl.name} className={`schema-card ${isExpanded ? 'expanded' : ''}`}>
                              <div 
                                className="schema-card-header"
                                onClick={() => toggleTableExpanded(tbl.name)}
                              >
                                <div className="card-header-title">
                                  <Table size={16} className="table-icon" />
                                  <span className="table-name" title={tbl.name}>{tbl.name.split('.').pop() || tbl.name}</span>
                                </div>
                                <div className="card-header-meta">
                                  <span className={`type-badge ${tbl.type.toLowerCase()}`}>{tbl.type}</span>
                                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="schema-card-body">
                                  <div className="columns-list">
                                    {cols.map((col, idx) => {
                                      const isPk = tbl.primaryKeys.includes(col.name)
                                      const isFk = tbl.foreignKeys.some(fk => fk.includes(`(${col.name})`))
                                      return (
                                        <div key={idx} className="column-row">
                                          <div className="col-info">
                                            <span className="col-name">{col.name}</span>
                                            <span className="col-type">{col.type}</span>
                                          </div>
                                          <div className="col-keys">
                                            {isPk && <Key size={12} className="pk-icon" aria-label="Primary Key" />}
                                            {isFk && <LinkIcon size={12} className="fk-icon" aria-label="Foreign Key" />}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                  {tbl.foreignKeys.length > 0 && (
                                    <div className="fk-list">
                                      <div className="fk-list-title">Relationships</div>
                                      {tbl.foreignKeys.map((fk, idx) => (
                                        <div key={idx} className="fk-row" title={fk}>
                                          <LinkIcon size={10} />
                                          <span>{fk.split('->').pop()?.trim()}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                    
                    <div className="schema-footer">
                      <button className="btn btn-secondary btn-sm" onClick={handleRefreshSchema} disabled={schemaLoading} type="button" style={{ width: '100%' }}>
                        <RefreshCw size={14} className={schemaLoading ? 'spin-icon' : ''} />
                        Refresh Schema
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Database Config */}
              {activeTab === 'database' && (
                <form className="modal-tab-panel" onSubmit={handleApplyDbConfig}>
                  <div className="status-panel">
                    <span className="status-label">Database Status:</span>
                    <span className={`status-badge ${dbConnected ? 'connected' : 'disconnected'}`}>
                      {dbConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
                      {dbConnected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>

                  <div className="config-method-toggle">
                    <button 
                      type="button"
                      className={`method-btn ${dbConfigMethod === 'url' ? 'active' : ''}`}
                      onClick={() => setDbConfigMethod('url')}
                    >
                      Connection URL
                    </button>
                    <button 
                      type="button"
                      className={`method-btn ${dbConfigMethod === 'fields' ? 'active' : ''}`}
                      onClick={() => setDbConfigMethod('fields')}
                    >
                      Detailed Fields
                    </button>
                  </div>

                  <div className="modal-form-content">
                    {dbConfigMethod === 'url' ? (
                      <div className="config-group">
                        <label htmlFor="dbUri-modal">Database Connection URL</label>
                        <textarea 
                          id="dbUri-modal" 
                          className="config-textarea" 
                          placeholder="dialect://user:pass@host:port/database"
                          value={dbConfigUrl}
                          onChange={(e) => {
                            const newUrl = e.target.value;
                            setDbConfigUrl(newUrl);
                            // Also update fields in real-time for preview
                            const parsed = parseConnectionString(newUrl);
                            setDbDialect(parsed.dialect);
                            setDbHost(parsed.host);
                            setDbPort(parsed.port);
                            setDbName(parsed.database);
                            setDbUser(parsed.username);
                            setDbPassword(parsed.password);
                            if (parsed.dialect === 'mssql') {
                              setDbDriver(parsed.driver);
                              setDbTrustCert(parsed.trustCert);
                            }
                          }}
                          rows={4}
                        />
                        <span className="help-text">
                          Supported: PostgreSQL, MySQL, SQLite (sqlite:///path), MSSQL (mssql+pyodbc://...)
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="config-group">
                          <label htmlFor="dialect-modal">Database Dialect</label>
                          <select 
                            id="dialect-modal" 
                            className="config-select"
                            value={dbDialect}
                            onChange={(e) => setDbDialect(e.target.value)}
                          >
                            <option value="postgresql">PostgreSQL</option>
                            <option value="mysql">MySQL</option>
                            <option value="mssql">SQL Server (MSSQL)</option>
                            <option value="sqlite">SQLite</option>
                          </select>
                        </div>

                        {dbDialect === 'sqlite' ? (
                          <div className="config-group">
                            <label htmlFor="dbName-modal">Database File Path</label>
                            <input 
                              type="text" 
                              id="dbName-modal" 
                              className="config-input" 
                              placeholder="e.g. database.db"
                              value={dbName}
                              onChange={(e) => setDbName(e.target.value)}
                            />
                          </div>
                        ) : (
                          <>
                            <div className="config-row">
                              <div className="config-group flex-grow">
                                <label htmlFor="dbHost-modal">Host</label>
                                <input 
                                  type="text" 
                                  id="dbHost-modal" 
                                  className="config-input" 
                                  placeholder="localhost"
                                  value={dbHost}
                                  onChange={(e) => setDbHost(e.target.value)}
                                />
                              </div>
                              <div className="config-group" style={{ width: '100px' }}>
                                <label htmlFor="dbPort-modal">Port</label>
                                <input 
                                  type="text" 
                                  id="dbPort-modal" 
                                  className="config-input" 
                                  placeholder={dbDialect === 'postgresql' ? '5432' : dbDialect === 'mysql' ? '3306' : '1433'}
                                  value={dbPort}
                                  onChange={(e) => setDbPort(e.target.value)}
                                />
                              </div>
                            </div>

                            <div className="config-group">
                              <label htmlFor="dbName-modal">Database Name</label>
                              <input 
                                type="text" 
                                id="dbName-modal" 
                                className="config-input" 
                                placeholder="my_database"
                                value={dbName}
                                onChange={(e) => setDbName(e.target.value)}
                              />
                            </div>

                            <div className="config-group">
                              <label htmlFor="dbUser-modal">Username</label>
                              <input 
                                type="text" 
                                id="dbUser-modal" 
                                className="config-input" 
                                value={dbUser}
                                onChange={(e) => setDbUser(e.target.value)}
                              />
                            </div>

                            <div className="config-group">
                              <label htmlFor="dbPassword-modal">Password</label>
                              <input 
                                type="password" 
                                id="dbPassword-modal" 
                                className="config-input" 
                                value={dbPassword}
                                onChange={(e) => setDbPassword(e.target.value)}
                              />
                            </div>

                            {dbDialect === 'mssql' && (
                              <>
                                <div className="config-group">
                                  <label htmlFor="dbDriver-modal">ODBC Driver</label>
                                  <input 
                                    type="text" 
                                    id="dbDriver-modal" 
                                    className="config-input" 
                                    value={dbDriver}
                                    onChange={(e) => setDbDriver(e.target.value)}
                                  />
                                </div>

                                <div className="config-group">
                                  <div className="toggle-container">
                                    <label htmlFor="dbTrustCert-modal">Trust Server Certificate</label>
                                    <label className="switch">
                                      <input 
                                        type="checkbox" 
                                        id="dbTrustCert-modal"
                                        checked={dbTrustCert}
                                        onChange={(e) => setDbTrustCert(e.target.checked)}
                                      />
                                      <span className="slider"></span>
                                    </label>
                                  </div>
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>

                  {dbStatusMsg && (
                    <div className={`status-alert ${dbStatusMsg.type}`}>
                      <Info size={14} />
                      <span>{dbStatusMsg.text}</span>
                    </div>
                  )}

                  {/* Auto-generated connection string preview (fields mode) */}
                  {dbConfigMethod === 'fields' && dbConfigUrl && (
                    <div className="config-group" style={{ marginTop: '16px' }}>
                      <label>Auto-generated Connection URL</label>
                      <div style={{ 
                        position: 'relative', 
                        background: 'var(--bg-secondary)', 
                        borderRadius: '8px', 
                        padding: '12px',
                        fontFamily: 'monospace',
                        fontSize: '0.85rem',
                        wordBreak: 'break-all',
                        border: '1px solid var(--border)',
                        color: 'var(--accent)'
                      }}>
                        {dbConfigUrl}
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(dbConfigUrl);
                            setDbStatusMsg({ type: 'success', text: 'Connection URL copied to clipboard!' });
                          }}
                          style={{
                            position: 'absolute',
                            top: '8px',
                            right: '8px',
                            background: 'var(--primary)',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            cursor: 'pointer',
                            color: 'white',
                            fontSize: '0.75rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Copy size={12} />
                          Copy
                        </button>
                      </div>
                      <span className="help-text">
                        This URL is automatically generated from the fields above and will be used when you click "Apply DB Connection".
                      </span>
                    </div>
                  )}

                  <div className="modal-footer">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      {loading ? <RefreshCw size={16} className="spin-icon" /> : <Check size={16} />}
                      Apply DB Connection
                    </button>
                  </div>
                </form>
              )}

              {/* Tab 3: LLM Settings */}
              {activeTab === 'llm' && (
                <form className="modal-tab-panel" onSubmit={handleApplyLlmConfig}>
                  <div className="modal-form-content">
                    <div className="config-group">
                      <label htmlFor="llmProvider-modal">LLM Provider</label>
                      <select 
                        id="llmProvider-modal"
                        className="config-select"
                        value={llmProvider}
                        onChange={(e) => setLlmProvider(e.target.value)}
                      >
                        <option value="groq">Groq Cloud</option>
                        <option value="ollama_cloud">Ollama Cloud</option>
                        <option value="ollama">Local Ollama</option>
                      </select>
                    </div>

                    <div className="config-group">
                      <label htmlFor="llmModel-modal">Model</label>
                      <select 
                        id="llmModel-modal"
                        className="config-select"
                        value={isCustomModel ? 'custom' : llmModel}
                        onChange={(e) => {
                          if (e.target.value === 'custom') {
                            setIsCustomModel(true)
                            setLlmModel('custom')
                          } else {
                            setIsCustomModel(false)
                            setLlmModel(e.target.value)
                          }
                        }}
                      >
                        {(POPULAR_MODELS[llmProvider as keyof typeof POPULAR_MODELS] || []).map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                        <option value="custom">Custom model...</option>
                      </select>
                      
                      {isCustomModel && (
                        <input 
                          type="text"
                          className="config-input"
                          placeholder="Enter custom model name"
                          value={customModel}
                          onChange={(e) => setCustomModel(e.target.value)}
                          style={{ marginTop: '8px' }}
                        />
                      )}
                    </div>

                    <div className="config-group">
                      <label htmlFor="llmTemp-modal">Temperature: {llmTemp.toFixed(1)}</label>
                      <input 
                        type="range" 
                        id="llmTemp-modal"
                        min="0" 
                        max="1" 
                        step="0.1"
                        value={llmTemp}
                        onChange={(e) => setLlmTemp(parseFloat(e.target.value))}
                        className="range-slider"
                        style={{
                          background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${llmTemp * 100}%, var(--border) ${llmTemp * 100}%, var(--border) 100%)`
                        }}
                      />
                      <span className="help-text">Higher = more creative, Lower = more deterministic</span>
                    </div>

                    {llmProvider === 'groq' && (
                      <div className="config-group">
                        <label htmlFor="groqKey-modal">Groq API Key</label>
                        <input 
                          type="password" 
                          id="groqKey-modal"
                          className="config-input" 
                          placeholder="gsk_..."
                          value={groqKey}
                          onChange={(e) => setGroqKey(e.target.value)}
                        />
                        <span className="help-text">Get your key from <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer">console.groq.com</a></span>
                      </div>
                    )}

                    {llmProvider === 'ollama_cloud' && (
                      <div className="config-group">
                        <label htmlFor="ollamaCloudKey-modal">Ollama Cloud API Key</label>
                        <input 
                          type="password" 
                          id="ollamaCloudKey-modal"
                          className="config-input" 
                          placeholder="Enter your Ollama Cloud API key"
                          value={ollamaCloudKey}
                          onChange={(e) => setOllamaCloudKey(e.target.value)}
                        />
                      </div>
                    )}

                    {llmProvider === 'ollama' && (
                      <div className="config-group">
                        <label htmlFor="ollamaUrl-modal">Ollama Base URL</label>
                        <input 
                          type="text" 
                          id="ollamaUrl-modal"
                          className="config-input" 
                          placeholder="http://localhost:11434"
                          value={ollamaUrl}
                          onChange={(e) => setOllamaUrl(e.target.value)}
                        />
                      </div>
                    )}
                  </div>

                  {llmStatusMsg && (
                    <div className={`status-alert ${llmStatusMsg.type}`}>
                      <Info size={14} />
                      <span>{llmStatusMsg.text}</span>
                    </div>
                  )}

                  <div className="modal-footer">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      {loading ? <RefreshCw size={16} className="spin-icon" /> : <Check size={16} />}
                      Apply LLM Settings
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
