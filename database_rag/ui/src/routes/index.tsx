import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useEffect } from 'react'
import {
  ArrowDown,
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
  ChevronLeft,
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
  Plus,
  Pin,
  Edit2,
  ThumbsUp,
  ThumbsDown,
  MoreHorizontal,
  Share2,
  Archive
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
  suggestions?: string[];
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
  isPinned?: boolean;
}

const roleAccess = {
  Admin: ['*'],
  User: ['Users', 'Appointments'],
  Therapist: ['Users', 'Appointments', 'DoctorSchedules']
};

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
    <button
      className="copy-btn"
      onClick={handleCopy}
      type="button"
      title={copied ? "Copied!" : "Copy"}
      style={{
        background: 'transparent',
        border: 'none',
        padding: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: copied ? 'var(--accent)' : 'var(--text-muted)',
        cursor: 'pointer',
        transition: 'color 0.2s'
      }}
      onMouseEnter={(e) => {
        if (!copied) e.currentTarget.style.color = 'var(--text-main)';
      }}
      onMouseLeave={(e) => {
        if (!copied) e.currentTarget.style.color = 'var(--text-muted)';
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </button>
  )
}

function UserMessageActions({
  text,
  onEdit,
  userVersions,
  activeUserVersionIdx,
  onPageChange
}: {
  text: string;
  onEdit: () => void;
  userVersions?: string[];
  activeUserVersionIdx?: number;
  onPageChange?: (direction: 'prev' | 'next') => void;
}) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="user-message-actions" style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', marginLeft: '8px' }}>
      <button
        onClick={handleCopy}
        title={copied ? "Copied!" : "Copy Question"}
        type="button"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)'
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <button
        onClick={onEdit}
        title="Edit Question"
        type="button"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)'
        }}
      >
        <Edit2 size={14} />
      </button>
      {userVersions && userVersions.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-muted)', userSelect: 'none', marginLeft: '4px' }}>
          <button
            onClick={() => onPageChange?.('prev')}
            disabled={activeUserVersionIdx === 0}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: activeUserVersionIdx === 0 ? 'default' : 'pointer',
              color: activeUserVersionIdx === 0 ? 'var(--text-dim)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              padding: '2px'
            }}
          >
            <ChevronLeft size={14} />
          </button>
          <span style={{ minWidth: '24px', textAlign: 'center' }}>
            {(activeUserVersionIdx ?? 0) + 1}/{userVersions.length}
          </span>
          <button
            onClick={() => onPageChange?.('next')}
            disabled={activeUserVersionIdx === userVersions.length - 1}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: activeUserVersionIdx === userVersions.length - 1 ? 'default' : 'pointer',
              color: activeUserVersionIdx === userVersions.length - 1 ? 'var(--text-dim)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              padding: '2px'
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

function BotMessageActions() {
  const [liked, setLiked] = useState<boolean | null>(null)

  return (
    <div className="bot-message-actions" style={{ display: 'inline-flex', gap: '12px', alignItems: 'center', marginLeft: '4px', marginTop: '6px' }}>
      <button
        onClick={() => setLiked(prev => prev === true ? null : true)}
        title="Like Response"
        type="button"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: liked === true ? 'var(--accent)' : 'var(--text-muted)',
          transition: 'color 0.2s'
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent)'}
        onMouseLeave={(e) => e.currentTarget.style.color = liked === true ? 'var(--accent)' : 'var(--text-muted)'}
      >
        <ThumbsUp size={14} fill={liked === true ? 'var(--accent)' : 'transparent'} />
      </button>
      <button
        onClick={() => setLiked(prev => prev === false ? null : false)}
        title="Dislike Response"
        type="button"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: liked === false ? '#ef4444' : 'var(--text-muted)',
          transition: 'color 0.2s'
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
        onMouseLeave={(e) => e.currentTarget.style.color = liked === false ? '#ef4444' : 'var(--text-muted)'}
      >
        <ThumbsDown size={14} fill={liked === false ? '#ef4444' : 'transparent'} />
      </button>
    </div>
  )
}

function ChatApp() {
  const [activeTab, setActiveTab] = useState<'database' | 'llm' | 'schema'>('database')
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null) // null = loading
  const [dbConnected, setDbConnected] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showSqlQuery, setShowSqlQuery] = useState<boolean>(() => localStorage.getItem('showSqlQuery') !== 'false')

  useEffect(() => {
    localStorage.setItem('showSqlQuery', String(showSqlQuery))
  }, [showSqlQuery])

  // Chat session management
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', content: 'Hello! I am your Database RAG Assistant. Ask me questions about your database' }
  ])
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renamingTitle, setRenamingTitle] = useState('')
  const [activeDropdownSessionId, setActiveDropdownSessionId] = useState<string | null>(null)

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
  const [llmTemp, setLlmTemp] = useState(0.3)
  const [groqKey, setGroqKey] = useState('')
  const [ollamaCloudKey, setOllamaCloudKey] = useState('')
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')

  // UI status logs
  const [dbStatusMsg, setDbStatusMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [llmStatusMsg, setLlmStatusMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Schema state
  const [schemaText, setSchemaText] = useState('')
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaError, setSchemaError] = useState('')
  const [schemaSearch, setSchemaSearch] = useState('')
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({})
  const [userRole, setUserRole] = useState<'Admin' | 'User' | 'Therapist'>('Admin')

  // Track if user is editing URL or fields to prevent sync loops
  const [isSyncingFromUrl, setIsSyncingFromUrl] = useState(false)
  const [isSyncingFromFields, setIsSyncingFromFields] = useState(false)

  // Chat input
  const [sessionInputs, setSessionInputs] = useState<Record<string, string>>({})
  const activeInput = currentSessionId ? (sessionInputs[currentSessionId] || '') : ''
  const setInputForCurrentSession = (val: string) => {
    if (currentSessionId) {
      setSessionInputs(prev => ({
        ...prev,
        [currentSessionId]: val
      }))
    }
  }
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget
    const isScrolledUp = container.scrollHeight - container.scrollTop - container.clientHeight > 200
    setShowScrollBtn(isScrolledUp)
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const prevSessionIdRef = useRef<string | null>(null)

  const scrollToBottom = (behavior: 'smooth' | 'auto' = 'auto') => {
    const container = messagesEndRef.current?.closest('.chat-messages-container')
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior
      })
    } else {
      messagesEndRef.current?.scrollIntoView({ block: 'end', behavior })
    }
  }

  useEffect(() => {
    scrollToBottom('auto')
  }, [messages, currentSessionId])

  // Auto-resize input textarea based on user typing
  useEffect(() => {
    const textarea = chatInputRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [activeInput])

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
        { role: 'bot', content: 'Hello! I am your Database RAG Assistant. Ask me questions about your database' }
      ]
    }

    setChatSessions(prev => [newSession, ...prev])
    setCurrentSessionId(newSession.id)
    setMessages(newSession.messages)
  }

  const togglePinSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setChatSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        return { ...s, isPinned: !s.isPinned }
      }
      return s
    }))
  }

  const handleEditSubmit = async (idx: number, newQuestion: string) => {
    if (!newQuestion.trim() || loading) return

    const targetSessionId = currentSessionId
    if (!targetSessionId) return

    const botIdx = idx + 1
    const userMsg = messages[idx]
    const botMsg = messages[botIdx]

    // Setup user versions
    const userVersions = userMsg.userVersions ? [...userMsg.userVersions] : [userMsg.content || '']
    if (!userVersions.includes(newQuestion)) {
      userVersions.push(newQuestion)
    }
    const activeUserVersionIdx = userVersions.indexOf(newQuestion)

    const updatedUserMsg: Message = {
      ...userMsg,
      content: newQuestion,
      userVersions,
      activeUserVersionIdx
    }

    // Setup bot versions
    const botVersions = botMsg && botMsg.botVersions ? [...botMsg.botVersions] : []
    if (botVersions.length === 0 && botMsg && !botMsg.loading) {
      botVersions.push({
        content: botMsg.content,
        sql: botMsg.sql,
        results: botMsg.results,
        rowCount: botMsg.rowCount,
        error: botMsg.error,
        suggestions: botMsg.suggestions
      })
    }

    // Set temporary loading bot message
    const updatedMessages = messages.slice(0, idx + 2)
    updatedMessages[idx] = updatedUserMsg
    updatedMessages[botIdx] = {
      role: 'bot',
      loading: true,
      botVersions,
      activeBotVersionIdx: activeUserVersionIdx
    } as Message

    // Update session list with loading state
    setChatSessions(prev => prev.map(session => {
      if (session.id === targetSessionId) {
        const nextMessages = session.messages.slice(0, idx + 2)
        nextMessages[idx] = updatedUserMsg
        nextMessages[botIdx] = {
          role: 'bot',
          loading: true,
          botVersions,
          activeBotVersionIdx: activeUserVersionIdx
        } as Message
        return { ...session, messages: nextMessages }
      }
      return session
    }))

    // Update active screen
    setMessages(updatedMessages)
    setLoading(true)
    setEditingIndex(null)

    try {
      // DATA FLOW: Step 1 (Frontend User Trigger - Edit) -> Calls POST /query on API Backend (api/main.py)
      // Dispatches edited user query and localized log history to the FastAPI server.
      const res = await fetch(`${BACKEND_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: newQuestion,
          history: messages.slice(0, idx).map(m => ({
            role: m.role,
            content: m.content || null,
            sql: m.sql || null
          })),
          role: userRole
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || 'Failed to execute query')
      }

      const newBotVer: BotResponseVersion = {
        content: data.content,
        sql: data.sql,
        results: data.results,
        rowCount: data.row_count,
        suggestions: data.suggestions
      }

      const updatedBotVersions = [...botVersions]
      while (updatedBotVersions.length <= activeUserVersionIdx) {
        updatedBotVersions.push({})
      }
      updatedBotVersions[activeUserVersionIdx] = newBotVer

      setChatSessions(prev => prev.map(session => {
        if (session.id === targetSessionId) {
          const next = [...session.messages]
          if (next.length > botIdx) {
            next[botIdx] = {
              role: 'bot',
              content: data.content,
              sql: data.sql,
              results: data.results,
              rowCount: data.row_count,
              suggestions: data.suggestions,
              botVersions: updatedBotVersions,
              activeBotVersionIdx: activeUserVersionIdx
            }
          }
          return { ...session, messages: next }
        }
        return session
      }))

      setMessages(prev => {
        const next = [...prev]
        if (next.length > botIdx) {
          next[botIdx] = {
            role: 'bot',
            content: data.content,
            sql: data.sql,
            results: data.results,
            rowCount: data.row_count,
            suggestions: data.suggestions,
            botVersions: updatedBotVersions,
            activeBotVersionIdx: activeUserVersionIdx
          }
        }
        return next
      })
    } catch (err: any) {
      if (err.message && err.message.includes('Text-to-SQL not initialized')) {
        setDbConnected(false)
      }
      const newBotVer: BotResponseVersion = {
        error: err.message || 'An error occurred during query execution.'
      }

      const updatedBotVersions = [...botVersions]
      while (updatedBotVersions.length <= activeUserVersionIdx) {
        updatedBotVersions.push({})
      }
      updatedBotVersions[activeUserVersionIdx] = newBotVer

      setChatSessions(prev => prev.map(session => {
        if (session.id === targetSessionId) {
          const next = [...session.messages]
          if (next.length > botIdx) {
            next[botIdx] = {
              role: 'bot',
              error: err.message || 'An error occurred during query execution.',
              botVersions: updatedBotVersions,
              activeBotVersionIdx: activeUserVersionIdx
            }
          }
          return { ...session, messages: next }
        }
        return session
      }))

      setMessages(prev => {
        const next = [...prev]
        if (next.length > botIdx) {
          next[botIdx] = {
            role: 'bot',
            error: err.message || 'An error occurred during query execution.',
            botVersions: updatedBotVersions,
            activeBotVersionIdx: activeUserVersionIdx
          }
        }
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  const handlePageChange = (idx: number, direction: 'prev' | 'next') => {
    setMessages(prev => {
      const next = [...prev]
      const userMsg = next[idx]
      const botMsg = next[idx + 1]

      if (!userMsg || !userMsg.userVersions || userMsg.activeUserVersionIdx === undefined) return prev
      if (!botMsg || !botMsg.botVersions || botMsg.activeBotVersionIdx === undefined) return prev

      let newIdx = userMsg.activeUserVersionIdx
      if (direction === 'prev' && newIdx > 0) {
        newIdx--
      } else if (direction === 'next' && newIdx < userMsg.userVersions.length - 1) {
        newIdx++
      }

      if (newIdx === userMsg.activeUserVersionIdx) return prev

      // Update user message
      next[idx] = {
        ...userMsg,
        content: userMsg.userVersions[newIdx],
        activeUserVersionIdx: newIdx
      }

      // Update bot message
      const botVer = botMsg.botVersions[newIdx]
      next[idx + 1] = {
        ...botMsg,
        content: botVer.content,
        sql: botVer.sql,
        results: botVer.results,
        rowCount: botVer.rowCount,
        error: botVer.error,
        suggestions: botVer.suggestions,
        activeBotVersionIdx: newIdx
      }

      // Update current session
      updateCurrentSession(next)
      return next
    })
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
              { role: 'bot', content: 'Hello! I am your Database RAG Assistant. Ask me questions about your database' }
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

  const handleRenameSubmit = (sessionId: string) => {
    if (!renamingTitle.trim()) return
    setChatSessions(prev => {
      const updated = prev.map(s => {
        if (s.id === sessionId) {
          return { ...s, title: renamingTitle.trim() }
        }
        return s
      })
      return updated
    })
    setRenamingSessionId(null)
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
        setLlmTemp(llmData.temperature ?? 0.3)
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

    const handleOutsideClick = () => {
      setActiveDropdownSessionId(null)
    }
    window.addEventListener('click', handleOutsideClick)
    return () => {
      window.removeEventListener('click', handleOutsideClick)
    }
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

      // Auto-retry last failed user query if it failed due to Text-to-SQL not initialized
      setTimeout(() => {
        setMessages(prev => {
          const lastBotIdx = prev.map((m, i) => ({ m, i })).reverse().find(x => x.m.role === 'bot' && x.m.error && x.m.error.includes('Text-to-SQL not initialized'))?.i;
          if (lastBotIdx !== undefined) {
            const userIdx = lastBotIdx - 1;
            const userMsg = prev[userIdx];
            if (userMsg && userMsg.role === 'user' && userMsg.content) {
              const cleanMessages = prev.slice(0, lastBotIdx);
              setTimeout(() => {
                sendQuery(userMsg.content || '', prev.slice(0, userIdx));
              }, 100);
              return cleanMessages;
            }
          }
          return prev;
        });
      }, 300);
    } catch (err: any) {
      setDbStatusMsg({ type: 'error', text: err.message || 'Failed to connect database' })
      setDbConnected(false)
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnectDatabase = async () => {
    setLoading(true)
    setDbStatusMsg(null)
    try {
      const res = await fetch(`${BACKEND_URL}/config/database/disconnect`, {
        method: 'POST'
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to disconnect database')
      }
      setDbConnected(false)
      setSchemaText('')
      setDbStatusMsg({ type: 'success', text: data.message || 'Database disconnected successfully' })
    } catch (err: any) {
      setDbStatusMsg({ type: 'error', text: err.message || 'Failed to disconnect database' })
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
    } catch (err: any) {
      setLlmStatusMsg({ type: 'error', text: err.message || 'Failed to configure LLM' })
    } finally {
      setLoading(false)
    }
  }

  const sendQuery = async (userQuery: string, currentMsgs: Message[]) => {
    let updatedMessages = [...currentMsgs]
    if (updatedMessages.length === 0 || updatedMessages[updatedMessages.length - 1].content !== userQuery) {
      updatedMessages = [...updatedMessages, { role: 'user', content: userQuery } as Message]
    }

    setMessages(updatedMessages)

    // Add temporary loading bot message
    setMessages(prev => [...prev, { role: 'bot', loading: true } as Message])
    setLoading(true)

    try {
      // DATA FLOW: Step 1 (Frontend User Trigger - Send) -> Calls POST /query on API Backend (api/main.py)
      // Dispatches user query and full conversational log history to the FastAPI server.
      const res = await fetch(`${BACKEND_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: userQuery,
          history: currentMsgs.map(m => ({
            role: m.role,
            content: m.content || null,
            sql: m.sql || null
          })),
          role: userRole
        })
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
          content: data.content,
          sql: data.sql,
          results: data.results,
          rowCount: data.row_count,
          suggestions: data.suggestions
        }
        // Update session with new messages
        updateCurrentSession(next)
        return next
      })
    } catch (err: any) {
      if (err.message && err.message.includes('Text-to-SQL not initialized')) {
        setDbConnected(false)
      }
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

  const handleSend = async () => {
    if (!activeInput.trim() || loading) return
    const userQuery = activeInput.trim()
    setInputForCurrentSession('')
    await sendQuery(userQuery, messages)
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
  const filteredTables = schemaTables.filter(t => {
    // Role-based Access check
    const allowed = roleAccess[userRole];
    if (!allowed.includes('*')) {
      const baseName = (t.name.split('.').pop() || t.name).trim();
      const isAllowed = allowed.some(allowedTab =>
        baseName.toLowerCase() === allowedTab.toLowerCase() ||
        t.name.toLowerCase().trim() === allowedTab.toLowerCase()
      );
      if (!isAllowed) return false;
    }

    // Search query check
    return (
      t.name.toLowerCase().includes(schemaSearch.toLowerCase()) ||
      t.columnsStr.toLowerCase().includes(schemaSearch.toLowerCase())
    );
  })

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
        <div className="sessions-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {chatSessions.length === 0 ? (
            <div className="sessions-empty">
              <MessageSquare size={48} className="sessions-empty-icon" />
              <h4>No chat sessions</h4>
              <p>Click "New Chat" to start a conversation.</p>
            </div>
          ) : (
            (() => {
              const pinned = chatSessions.filter(s => s.isPinned).sort((a, b) => b.createdAt - a.createdAt);
              const recent = chatSessions.filter(s => !s.isPinned).sort((a, b) => b.createdAt - a.createdAt);

              const renderSessionItem = (session: ChatSession) => (
                <div
                  key={session.id}
                  className={`session-item ${currentSessionId === session.id ? 'active' : ''}`}
                  onClick={() => loadSession(session.id)}
                >
                  <div className="session-item-content" style={{ flex: 1, minWidth: 0 }}>
                    <div className="session-item-title">
                      <MessageSquare size={14} style={{ flexShrink: 0 }} />
                      {renamingSessionId === session.id ? (
                        <input
                          className="rename-session-input"
                          value={renamingTitle}
                          onChange={(e) => setRenamingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleRenameSubmit(session.id)
                            } else if (e.key === 'Escape') {
                              setRenamingSessionId(null)
                            }
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            background: 'var(--bg)',
                            color: 'var(--text)',
                            border: '1px solid var(--border)',
                            borderRadius: '4px',
                            padding: '2px 6px',
                            fontSize: '0.85rem',
                            width: '100%',
                            outline: 'none'
                          }}
                        />
                      ) : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, width: '100%' }} title={session.title}>
                          <span style={{ flex: 1, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                            {session.title}
                          </span>
                        </span>
                      )}
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

                  {renamingSessionId === session.id ? (
                    <div className="session-item-actions" style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRenameSubmit(session.id)
                        }}
                        type="button"
                        title="Save"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--accent)',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'inline-flex',
                          alignItems: 'center'
                        }}
                      >
                        <Check size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenamingSessionId(null)
                        }}
                        type="button"
                        title="Cancel"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'inline-flex',
                          alignItems: 'center'
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="session-item-actions" style={{ display: 'flex', gap: '4px', flexShrink: 0, position: 'relative' }}>
                      <button
                        onClick={(e) => togglePinSession(session.id, e)}
                        type="button"
                        title={session.isPinned ? "Unpin session" : "Pin session"}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: session.isPinned ? 'var(--accent)' : 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'inline-flex',
                          alignItems: 'center'
                        }}
                      >
                        <Pin size={12} fill={session.isPinned ? 'var(--accent)' : 'transparent'} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setActiveDropdownSessionId(activeDropdownSessionId === session.id ? null : session.id)
                        }}
                        type="button"
                        title="More options"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'inline-flex',
                          alignItems: 'center'
                        }}
                      >
                        <MoreHorizontal size={12} />
                      </button>

                      {activeDropdownSessionId === session.id && (
                        <div
                          className="chat-context-menu"
                          style={{
                            position: 'absolute',
                            top: '24px',
                            right: '0',
                            backgroundColor: '#202123',
                            border: '1px solid #4d4d4f',
                            borderRadius: '8px',
                            padding: '6px',
                            minWidth: '150px',
                            zIndex: 100,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px'
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveDropdownSessionId(null)
                              navigator.clipboard.writeText(session.title)
                              alert("Copied session title to clipboard!")
                            }}
                            className="menu-item"
                          >
                            <Share2 size={12} />
                            Share
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveDropdownSessionId(null)
                              setRenamingSessionId(session.id)
                              setRenamingTitle(session.title)
                            }}
                            className="menu-item"
                          >
                            <Edit2 size={12} />
                            Rename
                          </button>
                          <button
                            onClick={(e) => {
                              togglePinSession(session.id, e)
                              setActiveDropdownSessionId(null)
                            }}
                            className="menu-item"
                          >
                            <Pin size={12} style={{ transform: 'rotate(45deg)' }} />
                            {session.isPinned ? 'Unpin chat' : 'Pin chat'}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveDropdownSessionId(null)
                              alert("Chat archived!")
                            }}
                            className="menu-item"
                          >
                            <Archive size={12} />
                            Archive
                          </button>
                          <div style={{ height: '1px', background: '#3e3f41', margin: '4px 0' }} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveDropdownSessionId(null)
                              deleteSession(session.id)
                            }}
                            className="menu-item danger"
                          >
                            <Trash2 size={12} />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );

              return (
                <>
                  {pinned.length > 0 && (
                    <div className="pinned-sessions-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div className="sessions-section-title" style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '0.05em', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8, paddingLeft: '8px' }}>
                        <Pin size={10} fill="var(--accent)" style={{ color: 'var(--accent)', transform: 'rotate(45deg)' }} />
                        Pinned
                      </div>
                      {pinned.map(renderSessionItem)}
                    </div>
                  )}

                  {recent.length > 0 && (
                    <div className="recent-sessions-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: pinned.length > 0 ? '12px' : '0' }}>
                      {pinned.length > 0 && (
                        <div className="sessions-section-title" style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '0.05em', paddingLeft: '8px', opacity: 0.8 }}>
                          Recent
                        </div>
                      )}
                      {recent.map(renderSessionItem)}
                    </div>
                  )}
                </>
              );
            })()
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
          <div className="chat-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: 500 }}>Show SQL</span>
              <label style={{ width: '40px', height: '20px', position: 'relative', display: 'inline-block', cursor: 'pointer', margin: 0 }}>
                <input
                  type="checkbox"
                  checked={showSqlQuery}
                  onChange={(e) => setShowSqlQuery(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                />
                <span style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: showSqlQuery ? 'var(--accent)' : 'var(--border-soft)',
                  transition: '0.3s',
                  borderRadius: '20px',
                  boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)'
                }}>
                  <span style={{
                    position: 'absolute',
                    height: '14px',
                    width: '14px',
                    left: showSqlQuery ? '23px' : '3px',
                    bottom: '3px',
                    backgroundColor: showSqlQuery ? '#0B0E14' : 'var(--text-muted)',
                    transition: '0.3s',
                    borderRadius: '50%',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.4)'
                  }}></span>
                </span>
              </label>
            </div>
            <div className="status-badge connected" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', height: '24px', display: 'flex', alignItems: 'center' }}>
              Role: {userRole}
            </div>
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

        {messages.filter(m => m.role === 'user').length === 0 ? (
          <div className="chat-landing-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '40px 24px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
            <h1 style={{ fontSize: '2.2rem', fontWeight: 600, color: 'var(--text)', marginBottom: '32px', textAlign: 'center', fontFamily: 'var(--font-sans)' }}>
              What's on your mind today?
            </h1>

            {/* Centered input box wrapper */}
            <div className="chat-input-wrapper" style={{ width: '100%', maxWidth: '650px', background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: '24px', padding: '12px 16px 12px 20px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 8px 30px rgba(0,0,0,0.3)', transition: 'border-color 0.2s', marginBottom: '40px' }}>
              <textarea
                ref={chatInputRef}
                className="chat-input"
                placeholder={dbConnected ? "Ask anything about your database..." : "Connect to a database first..."}
                value={activeInput}
                onChange={(e) => setInputForCurrentSession(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!dbConnected || loading}
                rows={1}
              />
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!activeInput.trim() || !dbConnected || loading}
                type="button"
                style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--accent)', color: '#0B0E14', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <Send size={16} />
              </button>
            </div>

            {/* Helper query suggestion items */}
            <div className="landing-suggestions" style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '650px' }}>
              <button
                onClick={() => setInputForCurrentSession("List all table names in my database")}
                style={{ background: 'var(--panel-raised)', border: '1px solid var(--border-soft)', color: 'var(--text-dim)', padding: '14px 18px', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left', width: '100%', transition: 'background 0.2s', fontSize: '0.95rem' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--border-soft)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--panel-raised)'}
              >
                <Table size={16} style={{ color: 'var(--accent)' }} />
                <span>List all table names in my database</span>
              </button>
              <button
                onClick={() => setInputForCurrentSession("Describe columns and structure of table ")}
                style={{ background: 'var(--panel-raised)', border: '1px solid var(--border-soft)', color: 'var(--text-dim)', padding: '14px 18px', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left', width: '100%', transition: 'background 0.2s', fontSize: '0.95rem' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--border-soft)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--panel-raised)'}
              >
                <Code size={16} style={{ color: 'var(--accent)' }} />
                <span>Describe columns and structure of a table</span>
              </button>
              <button
                onClick={() => setInputForCurrentSession("Fetch first 10 rows from table public.AppointmentFinancials ")}
                style={{ background: 'var(--panel-raised)', border: '1px solid var(--border-soft)', color: 'var(--text-dim)', padding: '14px 18px', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left', width: '100%', transition: 'background 0.2s', fontSize: '0.95rem' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--border-soft)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--panel-raised)'}
              >
                <Search size={16} style={{ color: 'var(--accent)' }} />
                <span>Fetch first 10 rows from a table</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="chat-messages-container" onScroll={handleScroll}>
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

                    <div className="message-bubble-group" style={{ display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0 }}>
                      {msg.loading ? (
                        <div className="message-content loading">
                          <div className="typing-indicator">
                            <span></span>
                            <span></span>
                            <span></span>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="message-content">
                            {msg.content && (
                              editingIndex === idx ? (
                                <div className="edit-message-container" style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', minWidth: '300px' }}>
                                  <textarea
                                    className="edit-message-textarea"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    style={{
                                      width: '100%',
                                      background: 'var(--bg-secondary)',
                                      color: 'var(--text-main)',
                                      border: '1px solid var(--border)',
                                      borderRadius: '6px',
                                      padding: '8px',
                                      minHeight: '60px',
                                      resize: 'vertical',
                                      fontFamily: 'inherit',
                                      fontSize: '0.9rem'
                                    }}
                                  />
                                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                    <button
                                      onClick={() => setEditingIndex(null)}
                                      type="button"
                                      style={{
                                        background: 'transparent',
                                        border: '1px solid var(--border)',
                                        color: 'var(--text-muted)',
                                        borderRadius: '4px',
                                        padding: '4px 10px',
                                        fontSize: '0.8rem',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => handleEditSubmit(idx, editValue)}
                                      type="button"
                                      style={{
                                        background: 'var(--accent)',
                                        border: 'none',
                                        color: 'white',
                                        borderRadius: '4px',
                                        padding: '4px 10px',
                                        fontSize: '0.8rem',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      Save & Run
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="msg-text">
                                  {msg.content}
                                </div>
                              )
                            )}

                            {showSqlQuery && msg.sql && (
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
                                    <span>Results ({msg.rowCount || msg.results.length} rows)</span>
                                  </div>
                                  <CopyButton text={(() => {
                                    if (!msg.results || msg.results.length === 0) return '';
                                    const headers = Object.keys(msg.results[0]);
                                    const headerLine = headers.join('\t');
                                    const rowLines = msg.results.map(row =>
                                      headers.map(h => row[h] === null ? 'NULL' : String(row[h])).join('\t')
                                    );
                                    return [headerLine, ...rowLines].join('\n');
                                  })()} />
                                </div>
                                <div className="results-table-container">
                                  <table>
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
                                          {Object.values(row).map((val: any, cIdx) => (
                                            <td key={cIdx}>
                                              {val === null ? <span className="null-val">NULL</span> : String(val)}
                                            </td>
                                          ))}
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

                            {msg.suggestions && msg.suggestions.length > 0 && (
                              <div className="message-suggestions" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                                {msg.suggestions.map((suggestion, sIdx) => (
                                  <button
                                    key={sIdx}
                                    onClick={() => setInputForCurrentSession(suggestion)}
                                    style={{
                                      background: 'var(--panel-raised)',
                                      border: '1px solid var(--border-soft)',
                                      color: 'var(--text-dim)',
                                      padding: '6px 12px',
                                      borderRadius: '8px',
                                      cursor: 'pointer',
                                      fontSize: '0.85rem',
                                      transition: 'all 0.2s',
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = 'var(--border-soft)';
                                      e.currentTarget.style.color = 'var(--accent)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = 'var(--panel-raised)';
                                      e.currentTarget.style.color = 'var(--text-dim)';
                                    }}
                                  >
                                    {suggestion}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {msg.role === 'user' && !loading && editingIndex !== idx && (
                            <div className="user-message-actions-wrapper" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px', paddingRight: '8px' }}>
                              <UserMessageActions
                                text={msg.content || ''}
                                onEdit={() => {
                                  setEditingIndex(idx)
                                  setEditValue(msg.content || '')
                                }}
                                userVersions={msg.userVersions}
                                activeUserVersionIdx={msg.activeUserVersionIdx}
                                onPageChange={(dir) => handlePageChange(idx, dir)}
                              />
                            </div>
                          )}

                          {msg.role === 'bot' && !loading && !msg.loading && (
                            <div className="bot-message-actions-wrapper" style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px', paddingLeft: '8px' }}>
                              <BotMessageActions />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {showScrollBtn && dbConnected && (
              <button
                onClick={() => scrollToBottom('smooth')}
                type="button"
                style={{
                  position: 'absolute',
                  bottom: '120px',
                  right: 'calc(50% - 18px)',
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'var(--panel-raised)',
                  border: '1px solid var(--border-soft)',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 10,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  transition: 'background 0.2s, color 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--border-soft)';
                  e.currentTarget.style.color = 'var(--accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--panel-raised)';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }}
              >
                <ArrowDown size={18} />
              </button>
            )}

            <div className="chat-input-container">
              {!dbConnected && (
                <div className="chat-warning-overlay">
                  <AlertTriangle size={20} />
                  <span>Please configure and connect to a database in the sidebar to ask questions.</span>
                </div>
              )}
              <div className={`chat-input-wrapper ${!dbConnected ? 'disabled' : ''}`}>
                <textarea
                  ref={chatInputRef}
                  className="chat-input"
                  placeholder={dbConnected ? "Ask a question about your database ..." : "Connect to a database first..."}
                  value={activeInput}
                  onChange={(e) => setInputForCurrentSession(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={!dbConnected || loading}
                  rows={1}
                />
                <button
                  className="send-btn"
                  onClick={loading ? () => { } : handleSend}
                  disabled={!loading && (!activeInput.trim() || !dbConnected)}
                  type="button"
                  style={loading ? {
                    background: 'var(--accent)',
                    color: 'var(--bg)',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    cursor: 'default',
                    boxShadow: '0 0 12px var(--accent-glow)',
                    animation: 'heartbeat 1.2s infinite ease-in-out'
                  } : {}}
                >
                  {loading ? (
                    <div style={{ width: '10px', height: '10px', background: 'var(--bg)', borderRadius: '1px' }}></div>
                  ) : (
                    <Send size={18} />
                  )}
                </button>
              </div>
              <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '6px', opacity: 0.7, fontFamily: 'var(--font-sans)', userSelect: 'none' }}>
                Database RAG Assistant can make mistakes. Check important info.
              </div>
            </div>
          </>
        )}
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
                    <div className="role-selector-container" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Access Role:</span>
                      <select
                        value={userRole}
                        onChange={(e) => setUserRole(e.target.value as any)}
                        className="config-select"
                        style={{ flex: 1, padding: '7px 11px', height: '36px' }}
                      >
                        <option value="Admin">Admin</option>
                        <option value="User">User</option>
                        <option value="Therapist">Therapist</option>
                      </select>
                    </div>

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

                  <div className="modal-footer" style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    {dbConnected && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleDisconnectDatabase}
                        disabled={loading}
                        style={{
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          color: '#ef4444',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: 500
                        }}
                      >
                        <X size={16} />
                        Disconnect Database
                      </button>
                    )}
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
