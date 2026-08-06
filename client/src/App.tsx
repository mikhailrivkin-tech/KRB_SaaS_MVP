import React, { useState, useEffect, useRef } from 'react';

if (typeof window !== 'undefined') {
  (window as any).__BUILD_TIMESTAMP__ = 'LIVE_DEV_2026_07_29_V3';
}

import { createPortal } from 'react-dom';
import { ThemeProvider, useTheme } from './design-system/theme-provider/ThemeProvider';
import { DemoPage } from './design-system/DemoPage';
import { Button } from './design-system/primitives/Button';
import { Input } from './design-system/primitives/Input';
import { Card } from './design-system/primitives/Card';
import { Modal } from './design-system/primitives/Modal';
import { Badge } from './design-system/primitives/Badge';
import { ProgressBar } from './design-system/primitives/ProgressBar';
import { DropdownSelect } from './design-system/DropdownSelect';
import {
  Bot as BotIcon,
  FolderPlus,
  UploadCloud,
  Trash2,
  Send,
  Lock,
  Key,
  Sliders,
  Activity,
  FileText,
  AlertTriangle,
  RefreshCw,
  LogOut,
  Folder,
  ChevronRight,
  ShieldCheck,
  UserCheck,
  Sun,
  Moon,
  Sparkles,
  Palette,
  CheckCircle,
  HelpCircle,
  FileDown,
  Search,
  FolderInput,
  Loader2,
  Users,
  UserPlus,
  Maximize2,
  Edit3
} from 'lucide-react';

interface Bot {
  id: string;
  name: string;
  description: string;
  systemInstruction: string;
  fileSearchStoreName?: string;
  modelName?: string;
  clientAccess?: Array<{ userId: string }>;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  groundingMetadata?: string;
  createdAt: string;
}

interface GoogleFile {
  name: string;
  displayName: string;
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  updateTime?: string;
  state?: string;
  customMetadata?: Array<{ key: string; stringValue: string }>;
}

// Perplexity AI Style Markdown Renderer with exact spacing & line-heights
function PerplexityMarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;

  const parseInline = (text: string) => {
    // Convert **bold** to <strong>
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        return (
          <strong key={i} className="font-semibold text-[var(--color-text-primary)]">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-4 space-y-3 pl-5 list-disc text-[var(--color-text-primary)] font-sans-claude">
          {listItems}
        </ul>
      );
      listItems = [];
    }
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    // Horizontal Rule
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      flushList();
      elements.push(<hr key={idx} className="my-6 border-t border-[var(--color-border)] opacity-60" />);
      return;
    }

    // Headings H3 (Perplexity H3: 19px, mt-7 mb-3, tracking-tight)
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={idx} className="text-[19px] font-semibold font-sans-claude text-[var(--color-text-primary)] mt-7 mb-3 tracking-tight flex items-center gap-2">
          {parseInline(trimmed.slice(4))}
        </h3>
      );
      return;
    }

    // Headings H2 (Perplexity H2: 21px, mt-8 mb-4, tracking-tight)
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={idx} className="text-[21px] font-bold font-sans-claude text-[var(--color-text-primary)] mt-8 mb-4 tracking-tight">
          {parseInline(trimmed.slice(3))}
        </h2>
      );
      return;
    }

    // Headings H1
    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <h1 key={idx} className="text-2xl font-bold font-sans-claude text-[var(--color-text-primary)] mt-8 mb-4 tracking-tight">
          {parseInline(trimmed.slice(2))}
        </h1>
      );
      return;
    }

    // Bullet List Item (Perplexity List Item: 15px, leading-[1.65])
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      const itemContent = trimmed.slice(2);
      listItems.push(
        <li key={idx} className="text-[15px] font-sans-claude leading-[1.65] text-[var(--color-text-primary)]">
          {parseInline(itemContent)}
        </li>
      );
      return;
    }

    // Numbered List Item
    if (/^\d+\.\s/.test(trimmed)) {
      flushList();
      const match = trimmed.match(/^(\d+\.\s)(.*)/);
      if (match) {
        elements.push(
          <div key={idx} className="my-3 pl-4 text-[15px] font-sans-claude leading-[1.65] text-[var(--color-text-primary)] flex gap-2">
            <span className="font-semibold text-[var(--color-accent-primary)] shrink-0">{match[1]}</span>
            <span>{parseInline(match[2])}</span>
          </div>
        );
        return;
      }
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      flushList();
      elements.push(
        <blockquote key={idx} className="my-4 pl-4 border-l-3 border-[var(--color-accent-primary)] italic text-[15px] leading-[1.65] text-[var(--color-text-secondary)] font-sans-claude">
          {parseInline(trimmed.slice(2))}
        </blockquote>
      );
      return;
    }

    // Empty line
    if (trimmed === '') {
      flushList();
      return;
    }

    // Standard Paragraph (Perplexity Paragraph: 15px, leading-[1.65], mb-4)
    flushList();
    elements.push(
      <p key={idx} className="text-[15px] font-sans-claude leading-[1.65] text-[var(--color-text-primary)] mb-4">
        {parseInline(line)}
      </p>
    );
  });

  flushList();

  return <div className="text-[15px] font-sans-claude text-[var(--color-text-primary)] leading-[1.65]">{elements}</div>;
}

export function AppContent() {
  const { mode, toggleMode, tokens, updateTokens, resetTokens } = useTheme();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const isAdminRoute = currentPath.startsWith('/admin');

  const navigatePath = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  // Auth state
  const [token, setToken] = useState<string | null>(localStorage.getItem('krb_token'));
  const [userRole, setUserRole] = useState<'CLIENT' | 'ADMIN' | null>(
    (localStorage.getItem('krb_role') as any) || null
  );

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [require2FA, setRequire2FA] = useState(false);
  const [isAdminLogin, setIsAdminLogin] = useState(isAdminRoute);
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    const handlePopState = () => {
      const p = window.location.pathname;
      setCurrentPath(p);
      if (p.startsWith('/admin')) {
        setIsAdminLogin(true);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Automatic Token Validation & Guard Effect upon boot and route change
  useEffect(() => {
    if (token) {
      try {
        const storedRole = localStorage.getItem('krb_role');
        if (!storedRole) {
          localStorage.removeItem('krb_token');
          localStorage.removeItem('krb_role');
          setToken(null);
          setUserRole(null);
          return;
        }
        if (isAdminRoute && storedRole !== 'ADMIN') {
          localStorage.removeItem('krb_token');
          localStorage.removeItem('krb_role');
          setToken(null);
          setUserRole(null);
          setIsAdminLogin(true);
        }
      } catch (err) {
        localStorage.removeItem('krb_token');
        localStorage.removeItem('krb_role');
        setToken(null);
        setUserRole(null);
      }
    } else if (isAdminRoute) {
      setIsAdminLogin(true);
    }
  }, [currentPath, token, isAdminRoute]);
  // 2FA Admin Settings State
  const [totpEnabled, setTotpEnabled] = useState(true);
  const [totpSecret, setTotpSecret] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');

  // Active view for Client: 'chat' | 'library'
  const [clientTab, setClientTab] = useState<'chat' | 'library'>('chat');

  // Active view for Admin: 'keys' | 'bots' | 'users' | 'limits' | 'diagnostics' | 'logs' | 'theme'
  const [adminTab, setAdminTab] = useState<'keys' | 'bots' | 'users' | 'limits' | 'diagnostics' | 'logs' | 'theme'>('keys');

  // Admin Users Management State
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'CLIENT' | 'ADMIN'>('CLIENT');
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Chat State
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBot, setSelectedBot] = useState<Bot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatErrorDetails, setChatErrorDetails] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Business Library (RAG) State
  const [files, setFiles] = useState<GoogleFile[]>([]);
  const [folders, setFolders] = useState<string[]>(['Все файлы', 'Маркетинг', 'Юриспруденция']);
  const [selectedFolder, setSelectedFolder] = useState<string>('Все файлы');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deletingFileName, setDeletingFileName] = useState<string | null>(null);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Universal Dialog Portal state
  const [dialog, setDialog] = useState<{
    type: 'alert' | 'confirm';
    message: string;
    onConfirm?: () => void;
  } | null>(null);

  const showAlert = (message: string) => {
    setDialog({ type: 'alert', message });
  };

  const showConfirm = (message: string, onConfirm: () => void) => {
    setDialog({ type: 'confirm', message, onConfirm });
  };

  // Admin Logs State
  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  const [selectedLogLevel, setSelectedLogLevel] = useState<'ALL' | 'INFO' | 'ERROR' | 'DEBUG'>('ALL');
  const [serverLogLevel, setServerLogLevel] = useState<'INFO' | 'ERROR' | 'DEBUG'>('DEBUG');
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isAutoRefreshLogs, setIsAutoRefreshLogs] = useState(false);

  // Admin API Keys State
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [newKeyService, setNewKeyService] = useState('GEMINI');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [uploadingBotId, setUploadingBotId] = useState<string | null>(null);

  // Large Modal Bot System Instruction Editor State
  const [editingPromptBot, setEditingPromptBot] = useState<Bot | null>(null);
  const [editingPromptText, setEditingPromptText] = useState('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  // Model Live Verification & Registry State
  const [dynamicModels, setDynamicModels] = useState<any[]>([]);
  const [verifyingBotId, setVerifyingBotId] = useState<string | null>(null);
  const [modelPingLatencyMap, setModelPingLatencyMap] = useState<Record<string, number>>({});
  const [diagnosticsLogs, setDiagnosticsLogs] = useState<any[]>([]);

  // Admin Settings & Diagnostics State
  const [systemSettings, setSystemSettings] = useState<{
    slidingWindowSize: number;
    summarizationThreshold: number;
    rateLimitPerMinute?: number;
    rateLimitPerDay?: number;
    clientRagQuotaMB?: number;
    dualRagPrompt?: string;
  }>({
    slidingWindowSize: 15,
    summarizationThreshold: 30,
    rateLimitPerMinute: 20,
    rateLimitPerDay: 500,
    clientRagQuotaMB: 500,
    dualRagPrompt: ''
  });

  const fetchSettings = async () => {
    if (!token || userRole !== 'ADMIN') return;
    try {
      const res = await fetch('/api/admin/settings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSystemSettings(data);
      }
    } catch (err) {
      console.error(err);
    }
  };
  const [adminBots, setAdminBots] = useState<Bot[]>([]);
  const [botToDelete, setBotToDelete] = useState<Bot | null>(null);

  // Theme Engine Editing State
  const [editableTokens, setEditableTokens] = useState<Record<string, string>>({});
  const [isSavingTheme, setIsSavingTheme] = useState(false);

  useEffect(() => {
    setEditableTokens(tokens as unknown as Record<string, string>);
  }, [tokens]);

  const logClientAction = (level: 'INFO' | 'ERROR' | 'DEBUG', message: string, meta?: any) => {
    if (!token) return;
    fetch('/api/admin/logs/client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ level, message, meta })
    }).catch(e => console.warn('Could not record client log', e));
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch Bots
  const fetchBots = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/bots', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setBots(data);
        if (data.length > 0 && !selectedBot) {
          setSelectedBot(data[0]);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch Gemini Diagnostics Logs
  const fetchDiagnostics = async () => {
    if (!token || userRole !== 'ADMIN') return;
    try {
      const res = await fetch('/api/admin/diagnostics', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDiagnosticsLogs(data);
      }
    } catch (e) {
      console.error('Fetch diagnostics error:', e);
    }
  };

  // Fetch Admin Users
  const fetchAdminUsers = async () => {
    if (!token || userRole !== 'ADMIN') return;
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAdminUsers(data);
      }
    } catch (err) {
      console.error('Fetch users error:', err);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail || !newUserPassword) return;
    setIsCreatingUser(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole
        })
      });
      const data = await res.json();
      if (res.ok) {
        setShowAddUserModal(false);
        setNewUserEmail('');
        setNewUserPassword('');
        setNewUserRole('CLIENT');
        fetchAdminUsers();
        logClientAction('INFO', `Администратор создал пользователя [${data.email}]`);
      } else {
        alert(`Ошибка создания: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Ошибка вызова API: ${err.message}`);
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleDeleteUser = async (userId: string, userEmail: string) => {
    if (!confirm(`Вы уверены, что хотите удалить пользователя ${userEmail}?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        fetchAdminUsers();
        logClientAction('INFO', `Администратор удалил пользователя [${userEmail}]`);
      } else {
        alert(`Ошибка удаления: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Ошибка соединения: ${err.message}`);
    }
  };

  // Fetch Chat History
  const fetchHistory = async (botId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/chat/history/${botId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch Business Library Files
  const fetchFiles = async (retryCount = 0) => {
    if (!token) return;
    try {
      const res = await fetch('/api/files', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const fileList = Array.isArray(data) ? data : (data.files || []);
        setFiles(fileList);

        // If a file was just uploaded and list is empty, retry fetching after 1.5s (Google Store propagation delay)
        if (fileList.length === 0 && retryCount < 2) {
          setTimeout(() => fetchFiles(retryCount + 1), 1500);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch System Logs
  const fetchSystemLogs = async () => {
    if (!token || userRole !== 'ADMIN') return;
    setIsLoadingLogs(true);
    try {
      const levelParam = selectedLogLevel !== 'ALL' ? `?level=${selectedLogLevel}` : '';
      const res = await fetch(`/api/admin/logs${levelParam}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSystemLogs(data.logs || []);
        if (data.logLevel) setServerLogLevel(data.logLevel);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const deleteSystemLogs = async () => {
    if (!token || userRole !== 'ADMIN') return;
    try {
      const res = await fetch('/api/admin/logs', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setSystemLogs([]);
        showAlert('Файл логов успешно очищен');
      } else {
        showAlert('Ошибка при очистке файла логов');
      }
    } catch (err) {
      showAlert('Ошибка сети при очистке логов');
    }
  };

  const changeServerLogLevel = async (newLevel: 'INFO' | 'ERROR' | 'DEBUG') => {
    if (!token || userRole !== 'ADMIN') return;
    try {
      const res = await fetch('/api/admin/logs/level', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ level: newLevel })
      });
      if (res.ok) {
        setServerLogLevel(newLevel);
        fetchSystemLogs();
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchBots();
      fetchFiles();
    }
  }, [token]);

  useEffect(() => {
    if (selectedBot) {
      fetchHistory(selectedBot.id);
    }
  }, [selectedBot]);

  useEffect(() => {
    if (token && userRole === 'ADMIN' && adminTab === 'logs') {
      fetchSystemLogs();
    }
  }, [token, userRole, adminTab, selectedLogLevel]);

  useEffect(() => {
    if (token && userRole === 'ADMIN') {
      fetchDynamicModels();
      fetchRagStats();
      fetchSettings();
      if (adminTab === 'users') fetchAdminUsers();
      if (adminTab === 'diagnostics') fetchDiagnostics();
    }
  }, [token, userRole, adminTab]);

  useEffect(() => {
    let interval: any;
    if (isAutoRefreshLogs && userRole === 'ADMIN' && adminTab === 'logs') {
      interval = setInterval(() => {
        fetchSystemLogs();
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isAutoRefreshLogs, userRole, adminTab, selectedLogLevel]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const endpoint = isAdminLogin ? '/api/auth/admin-login' : '/api/auth/login';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
          totpCode: require2FA ? totpCode : undefined
        })
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.require2FA) {
          setRequire2FA(true);
          setLoginError('Требуется 2FA код подтверждения из Google Authenticator');
        } else {
          setLoginError(data.error || 'Ошибка авторизации');
        }
        return;
      }

      localStorage.setItem('krb_token', data.token);
      localStorage.setItem('krb_role', data.user.role);
      setToken(data.token);
      setUserRole(data.user.role);

      if (data.user.role === 'ADMIN') {
        navigatePath('/admin');
      } else {
        navigatePath('/');
      }
    } catch (err: any) {
      setLoginError('Ошибка сети или сервера');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('krb_token');
    localStorage.removeItem('krb_role');
    setToken(null);
    setUserRole(null);
    setRequire2FA(false);
    setTotpCode('');
    navigatePath('/login');
  };

  // Send Chat Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !selectedBot || isSending) return;

    logClientAction('INFO', `Отправка запроса ассистенту [${selectedBot.name}]: "${inputMessage.slice(0, 50)}..."`);

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputMessage,
      createdAt: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setIsSending(true);
    setChatError(null);
    setChatErrorDetails(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          botId: selectedBot.id,
          message: userMsg.content
        })
      });

      const data = await res.json();

      if (!res.ok) {
        const errTxt = data.error || 'Не удалось получить ответ от ассистента.';
        const techReason = data.technicalReason || data.details || null;
        setChatError(errTxt);
        setChatErrorDetails(techReason);
        logClientAction('ERROR', `Ошибка в чате [${selectedBot.name}]: ${errTxt}${techReason ? ' | Причина: ' + techReason : ''}`);
      } else {
        setMessages(prev => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'model',
            content: data.content,
            groundingMetadata: data.groundingMetadata,
            createdAt: new Date().toISOString()
          }
        ]);
        logClientAction('INFO', `Получен успешный ответ от ассистента [${selectedBot.name}]`);
      }
    } catch (err: any) {
      const errTxt = 'Ошибка соединения с сервером. Попробуйте снова.';
      setChatError(errTxt);
      setChatErrorDetails(err.message || String(err));
      logClientAction('ERROR', `Сетевое исключение чата: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleClearHistory = async () => {
    if (!selectedBot) return;
    showConfirm(`Очистить историю диалога с ассистентом "${selectedBot.name}"?`, async () => {
      logClientAction('INFO', `Пользователь очистил историю диалога с ботом [${selectedBot.name}]`);
      try {
        const res = await fetch(`/api/chat/history/${selectedBot.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setMessages([]);
          logClientAction('INFO', `История диалога с ботом [${selectedBot.name}] очищена`);
        } else {
          showAlert(data.error || 'Ошибка при очистке истории');
        }
      } catch (err: any) {
        showAlert('Сетевая ошибка при очистке истории');
      }
    });
  };

  // Upload RAG File
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | { target: { files: FileList | File[] } }) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    logClientAction('INFO', `Начата загрузка файла "${selectedFile.name}" в папку "${selectedFolder}"`);

    setIsUploading(true);
    setUploadingFileName(selectedFile.name);
    setUploadProgress(20);

    const progressTimer = setInterval(() => {
      setUploadProgress(prev => (prev < 85 ? prev + 15 : prev));
    }, 400);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('folderTag', selectedFolder);

    try {
      const res = await fetch('/api/rag/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      clearInterval(progressTimer);

      if (res.ok) {
        setUploadProgress(100);
        logClientAction('INFO', `Файл "${selectedFile.name}" успешно загружен и привязан к папке "${selectedFolder}"`);
        showAlert(`Файл "${selectedFile.name}" успешно проиндексирован`);
        fetchFiles();
      } else {
        const data = await res.json();
        logClientAction('ERROR', `Ошибка загрузки файла "${selectedFile.name}": ${data.error}`);
        showAlert(data.error || 'Ошибка при загрузке файла');
      }
    } catch (err: any) {
      clearInterval(progressTimer);
      logClientAction('ERROR', `Сетевая ошибка загрузки: ${err.message}`);
      showAlert('Ошибка сети при загрузке файла');
    } finally {
      setTimeout(() => {
        setIsUploading(false);
        setUploadingFileName(null);
        setUploadProgress(0);
      }, 500);
      if (e.target && 'value' in e.target) {
        try { (e.target as HTMLInputElement).value = ''; } catch (err) {}
      }
    }
  };

  const handleDeleteFile = async (documentName: string, displayTitle?: string) => {
    const title = displayTitle || documentName;
    showConfirm(`Вы действительно хотите удалить файл "${title}" из базы RAG?`, async () => {
      logClientAction('INFO', `Запрос на удаление файла "${title}" из RAG`);
      setDeletingFileName(title);
      try {
        const encodedName = encodeURIComponent(documentName);
        const res = await fetch(`/api/rag/files/${encodedName}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });

        if (res.ok) {
          logClientAction('INFO', `Файл "${title}" успешно удален из Google Store и базы`);
          fetchFiles();
        } else {
          const errData = await res.json();
          logClientAction('ERROR', `Ошибка удаления файла "${title}": ${errData.error}`);
          showAlert('Ошибка при удалении файла из Google Store');
        }
      } catch (err: any) {
        logClientAction('ERROR', `Сетевое исключение при удалении файла: ${err.message}`);
        showAlert('Ошибка при удалении файла из Google Store');
      } finally {
        setDeletingFileName(null);
      }
    });
  };

  const handleMoveFile = async (documentName: string, targetFolderTag: string) => {
    // Optimistic UI Update for instant reactivity
    setFiles(prevFiles => prevFiles.map(f => {
      if (f.name === documentName) {
        const existingMeta = f.customMetadata || [];
        const filteredMeta = existingMeta.filter(m => m.key !== 'folderTag');
        filteredMeta.push({ key: 'folderTag', stringValue: targetFolderTag });
        return { ...f, customMetadata: filteredMeta };
      }
      return f;
    }));

    try {
      const res = await fetch('/api/files/move', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ documentName, targetFolderTag })
      });
      if (res.ok) {
        logClientAction('INFO', `Файл успешно перенесен в папку "${targetFolderTag}"`);
        fetchFiles();
      } else {
        showAlert('Не удалось привязать файл к выбранной папке');
        fetchFiles();
      }
    } catch (err: any) {
      showAlert('Сетевая ошибка при переносе файла');
      fetchFiles();
    }
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim() && !folders.includes(newFolderName.trim())) {
      setFolders(prev => [...prev, newFolderName.trim()]);
      setSelectedFolder(newFolderName.trim());
      setNewFolderName('');
      setShowFolderModal(false);
    }
  };

  const getFileFolder = (file: GoogleFile) => {
    const tag = file.customMetadata?.find(m => m.key === 'folderTag');
    return tag ? tag.stringValue : 'Все файлы';
  };

  const handleDeleteFolder = (folderName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (folderName === 'Все файлы') {
      showAlert('Корневую папку "Все файлы" нельзя удалить');
      return;
    }
    const hasFiles = files.some(file => getFileFolder(file) === folderName);
    if (hasFiles) {
      showAlert(`Невозможно удалить папку "${folderName}", пока в ней есть файлы! Сначала удалите их.`);
      return;
    }
    showConfirm(`Удалить пустую папку "${folderName}"?`, () => {
      setFolders(prev => prev.filter(f => f !== folderName));
      if (selectedFolder === folderName) setSelectedFolder('Все файлы');
    });
  };

  const fetchAdmin2FAInfo = async () => {
    try {
      const res = await fetch('/api/admin/2fa-info', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setTotpEnabled(data.totpEnabled);
      setTotpSecret(data.totpSecret);
      setQrCodeUrl(data.qrCodeUrl);
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggle2FA = async (enabled: boolean) => {
    try {
      const res = await fetch('/api/admin/toggle-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled })
      });
      const data = await res.json();
      setTotpEnabled(data.totpEnabled);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchAdminKeys = async () => {
    const res = await fetch('/api/admin/keys', { headers: { Authorization: `Bearer ${token}` } });
    setApiKeys(await res.json());
    fetchAdmin2FAInfo();
  };

  const fetchAdminSettings = async () => {
    const res = await fetch('/api/admin/settings', { headers: { Authorization: `Bearer ${token}` } });
    setSystemSettings(await res.json());
  };

  const fetchAdminDiagnostics = async () => {
    const res = await fetch('/api/admin/diagnostics', { headers: { Authorization: `Bearer ${token}` } });
    setDiagnosticsLogs(await res.json());
  };

  const fetchAdminBots = async () => {
    try {
      const res = await fetch('/api/admin/bots', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setAdminBots(data.bots || []);
      setAdminUsers(data.users || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateBot = async () => {
    if (!newBotName.trim() || !newBotPrompt.trim()) return;
    try {
      const res = await fetch('/api/admin/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: newBotName,
          description: newBotDesc,
          systemInstruction: newBotPrompt,
          modelName: newBotModel
        })
      });
      if (!res.ok) throw new Error('Ошибка создания бота');
      setNewBotName('');
      setNewBotDesc('');
      setNewBotPrompt('');
      fetchAdminBots();
      fetchBots();
    } catch (e: any) {
      showAlert(e.message);
    }
  };

  const [newBotName, setNewBotName] = useState('');
  const [newBotDesc, setNewBotDesc] = useState('');
  const [newBotPrompt, setNewBotPrompt] = useState('');
  const [newBotModel, setNewBotModel] = useState('gemini-2.5-flash');
  const [isApiKeyConfigured, setIsApiKeyConfigured] = useState<boolean>(true);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [ragStats, setRagStats] = useState<any>(null);

  const fetchDynamicModels = async () => {
    try {
      const res = await fetch('/api/admin/models', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setDynamicModels(data);
          setAvailableModels(data.map(m => m.name));
          setIsApiKeyConfigured(true);
        } else if (data.models && data.models.length > 0) {
          setAvailableModels(data.models);
          setIsApiKeyConfigured(true);
        }
      } else {
        const data = await res.json();
        if (data.error === 'API_KEY_REQUIRED') {
          setIsApiKeyConfigured(false);
          setAvailableModels([]);
        }
      }
    } catch (e) {
      console.error('Failed to fetch models:', e);
    }
  };

  const fetchRagStats = async () => {
    try {
      const res = await fetch('/api/admin/rag-stats', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setRagStats(data);
      }
    } catch (e) {
      console.error('Failed to fetch RAG stats:', e);
    }
  };

  const handleToggleBotAccess = async (userId: string, botId: string, currentAccess: boolean) => {
    try {
      await fetch('/api/admin/bot-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, botId, hasAccess: !currentAccess })
      });
      fetchAdminBots();
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddApiKey = async () => {
    if (!newKeyValue) return;
    await fetch('/api/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ service: newKeyService, apiKey: newKeyValue })
    });
    setNewKeyValue('');
    fetchAdminKeys();
  };

  const handleDeleteApiKey = async (keyId: string) => {
    showConfirm('Вы действительно хотите удалить этот API-ключ?', async () => {
      try {
        const res = await fetch(`/api/admin/keys/${keyId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Не удалось удалить ключ');
        fetchAdminKeys();
      } catch (err: any) {
        showAlert(err.message);
      }
    });
  };

  const handleSaveSettings = async () => {
    try {
      await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(systemSettings)
      });
      showAlert('Настройки сохранены');
    } catch (e) {
      showAlert('Ошибка сохранения настроек');
    }
  };

  const handleSaveTheme = async () => {
    setIsSavingTheme(true);
    try {
      const res = await fetch('/api/theme', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ tokens: editableTokens })
      });
      if (res.ok) {
        updateTokens(editableTokens);
        showAlert('Новая тема успешно сохранена в БД');
      } else {
        showAlert('Ошибка при сохранении темы');
      }
    } catch (e) {
      showAlert('Сетевая ошибка сохранения темы');
    } finally {
      setIsSavingTheme(false);
    }
  };

  const handleResetTheme = async () => {
    showConfirm('Сбросить цветовую схему до заводской темы Claude.ai?', async () => {
      try {
        await fetch('/api/theme/reset', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
        resetTokens();
        showAlert('Тема сброшена до стандартной');
      } catch (e) {
        showAlert('Ошибка сброса темы');
      }
    });
  };

  useEffect(() => {
    if (token && userRole === 'ADMIN' && isAdminRoute) {
      fetchAdminKeys();
      fetchAdminSettings();
      fetchAdminDiagnostics();
      fetchAdminBots();
    }
  }, [token, userRole, currentPath]);

  // Auth Screen UI (Not logged in)
  if (!token) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] flex items-center justify-center p-4 font-sans-claude transition-colors duration-200">
        <Card className="w-full max-w-md p-8 shadow-xl">
          <div className="text-center space-y-2 mb-8">
            <div className="inline-flex p-3 rounded-2xl bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-primary)] mb-2">
              <Sparkles size={28} />
            </div>
            <h1 className="text-3xl font-serif-claude font-bold tracking-tight text-[var(--color-text-primary)]">
              {isAdminLogin ? 'Вход в Админ-панель' : 'Вход в KRB SaaS'}
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Интеллектуальная система бизнес-аналитики и RAG
            </p>
          </div>

          {loginError && (
            <div className="mb-6 p-4 rounded-xl bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 text-[var(--color-error)] text-xs flex items-start gap-2 font-medium">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">
                Email
              </label>
              <Input
                type="email"
                required
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                placeholder="mikhail@company.ru"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">
                Пароль
              </label>
              <Input
                type="password"
                required
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {require2FA && (
              <div>
                <label className="block text-xs font-semibold text-[var(--color-success)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ShieldCheck size={14} /> 2FA Код подтверждения (TOTP)
                </label>
                <Input
                  type="text"
                  required
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value)}
                  placeholder="6-значный код из Authenticator"
                  className="font-mono-claude text-center tracking-widest text-lg"
                />
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full shadow-md"
            >
              {require2FA ? 'Подтвердить 2FA и Войти' : 'Войти в систему'}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-[var(--color-border)] text-center flex items-center justify-between text-xs text-[var(--color-text-tertiary)]">
            <span className="font-sans-claude text-[var(--color-text-tertiary)]">
              {isAdminRoute ? 'Защищенный шлюз администрирования' : 'KRB SaaS Platform'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={mode === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              onClick={toggleMode}
              aria-label="Тема"
            >
              {mode === 'dark' ? 'Paper' : 'Dark'}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] flex flex-col font-sans-claude transition-colors duration-200">
      
      {/* Universal Header Navigation Bar */}
      <header className="h-16 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => navigatePath('/')}>
            <div className="p-2 bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-primary)] rounded-xl">
              <Sparkles size={20} />
            </div>
            <span className="font-serif-claude font-bold text-xl tracking-tight">
              KRB SaaS
            </span>
          </div>

          {/* Unified Navigation Tabs */}
          <nav className="flex items-center gap-1.5 bg-[var(--color-bg)] p-1 rounded-xl border border-[var(--color-border)]">
            {userRole === 'ADMIN' && (
              <button
                onClick={() => {
                  setAdminTab('keys');
                  navigatePath('/admin');
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  isAdminRoute
                    ? 'bg-[var(--color-accent-primary)] text-white shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <ShieldCheck size={14} /> Панель администратора
              </button>
            )}

            <button
              onClick={() => {
                setClientTab('library');
                navigatePath('/');
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                !isAdminRoute && clientTab === 'library'
                  ? 'bg-[var(--color-accent-primary)] text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Folder size={14} /> Библиотека бизнеса
            </button>

            <button
              onClick={() => {
                setClientTab('chat');
                navigatePath('/');
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                !isAdminRoute && clientTab === 'chat'
                  ? 'bg-[var(--color-accent-primary)] text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <BotIcon size={14} /> Чат с ассистентом
            </button>
          </nav>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            icon={mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            onClick={toggleMode}
            aria-label="Переключить тему"
          >
            {mode === 'dark' ? 'Paper' : 'Dark'}
          </Button>

          <div className="h-4 w-px bg-[var(--color-border)]" />

          <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
            <span className="w-2 h-2 rounded-full bg-[var(--color-success)]" />
            <span>{userRole === 'ADMIN' ? 'Администратор' : 'Клиент'}</span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            icon={<LogOut size={16} />}
            onClick={handleLogout}
          >
            Выйти
          </Button>
        </div>
      </header>

      {/* Main Workspace Body */}
      {isAdminRoute && userRole !== 'ADMIN' ? (
        <div className="flex-1 flex items-center justify-center p-8 bg-[var(--color-bg)]">
          <Card className="max-w-md w-full text-center space-y-4 p-8">
            <ShieldCheck size={48} className="mx-auto text-[var(--color-accent-primary)] opacity-80" />
            <h3 className="text-xl font-serif-claude font-bold text-[var(--color-text-primary)]">Доступ ограничен</h3>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Раздел управления администратора предназначен только для пользователей с ролью Администратор.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Button variant="secondary" onClick={() => navigatePath('/')}>
                Вернуться к чату
              </Button>
              <Button variant="primary" onClick={handleLogout}>
                Войти как Администратор
              </Button>
            </div>
          </Card>
        </div>
      ) : isAdminRoute && userRole === 'ADMIN' ? (
        
        /* ADMIN PANEL VIEW */
        <div className="flex-1 flex overflow-hidden">
          <aside className="w-64 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-1 shrink-0">
            <button
              onClick={() => setAdminTab('keys')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                adminTab === 'keys'
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'
              }`}
            >
              <Key size={18} /> API-ключи
            </button>
            <button
              onClick={() => setAdminTab('bots')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                adminTab === 'bots'
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'
              }`}
            >
              <BotIcon size={18} /> Ассистенты & Доступ
            </button>
            <button
              onClick={() => setAdminTab('limits')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                adminTab === 'limits'
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'
              }`}
            >
              <Sliders size={18} /> Память & Лимиты
            </button>
            <button
              onClick={() => {
                logClientAction('INFO', 'Переключение на вкладку [Пользователи]');
                setAdminTab('users');
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                adminTab === 'users'
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'
              }`}
            >
              <Users size={18} /> Пользователи
            </button>
            <button
              onClick={() => setAdminTab('theme')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                adminTab === 'theme'
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'
              }`}
            >
              <Palette size={18} /> Оформление (Theme Engine)
            </button>
            <button
              onClick={() => {
                logClientAction('INFO', 'Переключение на вкладку [Диагностика API]');
                setAdminTab('diagnostics');
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                adminTab === 'diagnostics'
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'
              }`}
            >
              <Activity size={18} /> Диагностика Gemini
            </button>
            <button
              onClick={() => {
                logClientAction('INFO', 'Переключение на вкладку [Логи системы (Файл)]');
                setAdminTab('logs');
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                adminTab === 'logs'
                  ? 'bg-[var(--color-accent-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'
              }`}
            >
              <FileText size={18} /> Системные Логи
            </button>
          </aside>

          <main className="flex-1 p-8 overflow-y-auto">
            {/* Admin Theme Engine Tab */}
            {adminTab === 'theme' && (
              <div className="max-w-4xl space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-[var(--color-border)]">
                  <div>
                    <h2 className="text-2xl font-serif-claude font-bold">Управление дизайном (Theme Engine)</h2>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                      Динамическое редактирование токенов цвета без перезапуска кода (Сохраняется в БД)
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={handleResetTheme}>Сбросить тема</Button>
                    <Button variant="primary" onClick={handleSaveTheme} disabled={isSavingTheme}>
                      {isSavingTheme ? 'Сохранение...' : 'Сохранить тему в БД'}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {Object.entries(editableTokens).map(([key, value]) => (
                    <Card key={key} padding="sm" className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold font-mono-claude text-[var(--color-text-primary)]">{key}</span>
                        <span className="text-xs text-[var(--color-text-tertiary)] font-mono-claude">{value}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={value.startsWith('#') ? value : '#000000'}
                          onChange={(e) => {
                            setEditableTokens(prev => ({ ...prev, [key]: e.target.value }));
                            updateTokens({ [key]: e.target.value });
                          }}
                          className="w-10 h-8 rounded border border-[var(--color-border)] cursor-pointer bg-transparent"
                        />
                        <Input
                          value={value}
                          onChange={(e) => {
                            setEditableTokens(prev => ({ ...prev, [key]: e.target.value }));
                            updateTokens({ [key]: e.target.value });
                          }}
                          className="text-xs font-mono-claude"
                        />
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Admin Keys Tab */}
            {adminTab === 'keys' && (
              <div className="max-w-4xl space-y-6">
                <h2 className="text-2xl font-serif-claude font-bold">Управление API-ключами (AES-256)</h2>
                <Card className="flex gap-4 items-center">
                  <select
                    value={newKeyService}
                    onChange={e => setNewKeyService(e.target.value)}
                    className="bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-lg px-4 py-2 text-sm text-[var(--color-text-primary)]"
                  >
                    <option value="GEMINI">Google Gemini API</option>
                  </select>
                  <Input
                    type="password"
                    placeholder="Вставьте секретный API-ключ"
                    value={newKeyValue}
                    onChange={e => setNewKeyValue(e.target.value)}
                  />
                  <Button variant="primary" onClick={handleAddApiKey}>
                    Сохранить ключ
                  </Button>
                </Card>

                <Card padding="none" className="overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[var(--color-surface-strong)] text-[var(--color-text-secondary)] uppercase text-xs">
                      <tr>
                        <th className="p-4">Сервис</th>
                        <th className="p-4">Ключ</th>
                        <th className="p-4">Статус</th>
                        <th className="p-4">Дата создания</th>
                        <th className="p-4 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {apiKeys.map(k => (
                        <tr key={k.id}>
                          <td className="p-4 font-semibold">{k.service}</td>
                          <td className="p-4 font-mono-claude text-[var(--color-text-tertiary)]">••••••••{k.id.slice(0, 4)}</td>
                          <td className="p-4">
                            <Badge label="Активен" status="success" />
                          </td>
                          <td className="p-4">{new Date(k.createdAt).toLocaleDateString()}</td>
                          <td className="p-4 text-right">
                            <Button
                              variant="danger"
                              size="sm"
                              icon={<Trash2 size={14} />}
                              onClick={() => handleDeleteApiKey(k.id)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            )}

            {/* Admin Bots Tab */}
            {adminTab === 'bots' && (
              <div className="max-w-5xl space-y-6">
                <div>
                  <h2 className="text-2xl font-serif-claude font-bold">Ассистенты и Права Доступа</h2>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                    Управление персональными ИИ-ассистентами и их базами знаний Google RAG Store
                  </p>
                </div>

                <Card className="space-y-4">
                  <h3 className="font-semibold text-lg font-serif-claude">Создать нового ассистента</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      placeholder="Название (например: Юрисконсульт)"
                      value={newBotName}
                      onChange={e => setNewBotName(e.target.value)}
                    />
                    <Input
                      placeholder="Краткое описание"
                      value={newBotDesc}
                      onChange={e => setNewBotDesc(e.target.value)}
                    />
                  </div>
                  <textarea
                    placeholder="Системная инструкция (System Prompt)"
                    rows={3}
                    value={newBotPrompt}
                    onChange={e => setNewBotPrompt(e.target.value)}
                    className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-lg p-3 text-sm text-[var(--color-text-primary)]"
                  />
                  <Button variant="primary" onClick={handleCreateBot}>
                    Создать бота & RAG Store
                  </Button>
                </Card>

                <div className="space-y-4">
                  {adminBots.map(bot => (
                    <Card key={bot.id} className="space-y-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-3 flex-1 mr-4">
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                              <BotIcon size={14} className="text-[var(--color-accent-primary)]" />
                              Имя ассистента:
                            </label>
                            <Input
                              defaultValue={bot.name}
                              id={`bot-name-${bot.id}`}
                              className="font-bold text-base font-serif-claude"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                              Описание и назначение ассистента:
                            </label>
                            <Input
                              defaultValue={bot.description || ''}
                              id={`bot-desc-${bot.id}`}
                              placeholder="Описание ассистента (например: Эксперт по маркетингу...)"
                              className="text-xs text-[var(--color-text-primary)]"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={async () => {
                              const nameVal = (document.getElementById(`bot-name-${bot.id}`) as HTMLInputElement)?.value;
                              const descVal = (document.getElementById(`bot-desc-${bot.id}`) as HTMLInputElement)?.value;
                              await fetch(`/api/admin/bots/${bot.id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                body: JSON.stringify({ name: nameVal, description: descVal })
                              });
                              showAlert('Данные ассистента сохранены');
                              fetchAdminBots();
                            }}
                          >
                            Сохранить имя и описание
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            icon={<Trash2 size={14} />}
                            onClick={() => setBotToDelete(bot)}
                          >
                            Удалить
                          </Button>
                        </div>
                      </div>

                      {/* Bot RAG Store File Manager */}
                      <div className="bg-[var(--color-surface)] p-4 rounded-xl border border-[var(--color-border)] space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                            <Folder size={14} className="text-[var(--color-accent-primary)]" />
                            <span>База знаний бота (Google RAG Store):</span>
                          </div>
                          <label className={`inline-flex items-center gap-2 px-3 py-1.5 bg-[var(--color-accent-primary)] text-white text-xs font-medium rounded-lg transition-all ${uploadingBotId === bot.id ? 'opacity-80 cursor-wait' : 'cursor-pointer hover:opacity-90'}`}>
                            {uploadingBotId === bot.id ? (
                              <>
                                <Loader2 size={14} className="animate-spin shrink-0 text-white" />
                                <span>⏳ Загрузка и векторная индексация файла в Google RAG Store...</span>
                              </>
                            ) : (
                              <>
                                <UploadCloud size={14} />
                                <span>Загрузить документ в RAG</span>
                              </>
                            )}
                            <input
                              type="file"
                              className="hidden"
                              disabled={uploadingBotId === bot.id}
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                setUploadingBotId(bot.id);
                                try {
                                  const formData = new FormData();
                                  formData.append('file', f);
                                  const res = await fetch(`/api/admin/bots/${bot.id}/files`, {
                                    method: 'POST',
                                    headers: { Authorization: `Bearer ${token}` },
                                    body: formData
                                  });
                                  if (res.ok) {
                                    showAlert(`Файл "${f.name}" успешно добавлен в базу знаний бота`);
                                    fetchAdminBots();
                                  } else {
                                    showAlert('Ошибка загрузки файла в RAG бота');
                                  }
                                } catch (err: any) {
                                  showAlert('Сетевая ошибка при загрузке файла');
                                } finally {
                                  setUploadingBotId(null);
                                  if (e.target) (e.target as HTMLInputElement).value = '';
                                }
                              }}
                            />
                          </label>
                        </div>
                        <p className="text-[11px] text-[var(--color-text-tertiary)]">
                          Документы, загруженные сюда, формируют общие базовые регламенты для данного бота.
                        </p>
                      </div>

                      {/* Bot Model Selector with Verified Dynamic Registry & Health Check */}
                      <div className="bg-[var(--color-bg)] p-3.5 rounded-xl border border-[var(--color-border)] space-y-2.5">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] block">
                            Модель Gemini для RAG-ответов:
                          </label>
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-full text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400 shadow-xs">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span>
                              Активна: {(bot as any).modelName || 'gemini-2.5-flash'}
                              {modelPingLatencyMap[bot.id] ? ` (${modelPingLatencyMap[bot.id]} мс)` : ''}
                            </span>
                          </div>
                        </div>

                        {!isApiKeyConfigured ? (
                          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-700 dark:text-amber-400 space-y-1">
                            <div className="font-bold flex items-center gap-1.5">
                              <AlertTriangle size={14} />
                              <span>API-ключ не настроен</span>
                            </div>
                            <p>Для выбора моделей и работы ассистента добавьте валидный Google Gemini API-ключ во вкладке <b>«API-ключи»</b>.</p>
                          </div>
                        ) : (
                          <>
                            <select
                              id={`bot-model-${bot.id}`}
                              defaultValue={(bot as any).modelName || 'gemini-2.5-flash'}
                              className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-xl p-2.5 text-xs font-semibold text-[var(--color-accent-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]"
                              onChange={(e) => {
                                const customInput = document.getElementById(`bot-model-custom-${bot.id}`) as HTMLInputElement;
                                if (customInput && e.target.value !== 'custom') {
                                  customInput.value = e.target.value;
                                }
                              }}
                            >
                              {(() => {
                                const currentModel = (bot as any).modelName || 'gemini-2.5-flash';
                                const optionsList = [...dynamicModels];
                                if (optionsList.length === 0) {
                                  optionsList.push(
                                    { name: 'gemini-2.5-flash', label: 'gemini-2.5-flash (⚡ Быстрая и экономичная — Флагман RAG)' },
                                    { name: 'gemini-2.5-pro', label: 'gemini-2.5-pro (🧠 Максимальная точность для сложного анализа)' },
                                    { name: 'gemini-2.0-flash-exp', label: 'gemini-2.0-flash-exp (⚡ Скоростная Flash 2.0)' },
                                    { name: 'gemini-1.5-flash', label: 'gemini-1.5-flash (Стандартная Flash 1.5)' },
                                    { name: 'gemini-1.5-pro', label: 'gemini-1.5-pro (Стандартная Pro 1.5)' }
                                  );
                                }
                                if (!optionsList.some(m => m.name === currentModel)) {
                                  optionsList.unshift({
                                    name: currentModel,
                                    label: `${currentModel} (🟢 Текущая закрепленная модель бота в БД)`
                                  });
                                }
                                return optionsList.map(m => (
                                  <option key={m.name} value={m.name}>{m.label}</option>
                                ));
                              })()}
                              <option value="custom">-- Ввести пользовательское имя модели --</option>
                            </select>

                            <div className="flex gap-2 items-center flex-wrap">
                              <Input
                                id={`bot-model-custom-${bot.id}`}
                                defaultValue={(bot as any).modelName || 'gemini-2.5-flash'}
                                placeholder="Например: gemini-2.5-flash..."
                                className="text-xs flex-1 min-w-[200px]"
                                onChange={(e) => {
                                  const selectEl = document.getElementById(`bot-model-${bot.id}`) as HTMLSelectElement;
                                  if (selectEl) {
                                    selectEl.value = 'custom';
                                  }
                                }}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={verifyingBotId === bot.id}
                                onClick={async () => {
                                  const customVal = (document.getElementById(`bot-model-custom-${bot.id}`) as HTMLInputElement)?.value?.trim();
                                  const selectVal = (document.getElementById(`bot-model-${bot.id}`) as HTMLSelectElement)?.value;
                                  const targetModel = selectVal === 'custom' ? customVal : (selectVal || customVal);
                                  if (!targetModel) return;

                                  setVerifyingBotId(bot.id);
                                  try {
                                    const res = await fetch('/api/admin/bots/verify-model', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                      body: JSON.stringify({ modelName: targetModel })
                                    });
                                    const data = await res.json();
                                    if (data.ok) {
                                      showAlert(`🟢 Google API ПОДТВЕРЖДЕН: "${targetModel}" ответила за ${data.latencyMs} мс`);
                                      setModelPingLatencyMap(prev => ({ ...prev, [bot.id]: data.latencyMs }));
                                      fetchDynamicModels();
                                    } else {
                                      showAlert(`❌ Ошибка Google API: ${data.error}`);
                                    }
                                  } catch (err: any) {
                                    showAlert(`❌ Сбой проверки: ${err?.message || err}`);
                                  } finally {
                                    setVerifyingBotId(null);
                                  }
                                }}
                              >
                                {verifyingBotId === bot.id ? 'Проверка...' : '⚡ Проверить отклик'}
                              </Button>

                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={verifyingBotId === bot.id}
                                onClick={async () => {
                                  const customVal = (document.getElementById(`bot-model-custom-${bot.id}`) as HTMLInputElement)?.value?.trim();
                                  const selectVal = (document.getElementById(`bot-model-${bot.id}`) as HTMLSelectElement)?.value;
                                  const targetModel = selectVal === 'custom' ? customVal : (selectVal || customVal);
                                  if (!targetModel) return;

                                  setVerifyingBotId(bot.id);
                                  try {
                                    // Step 1: Health check verification via Google API
                                    const vRes = await fetch('/api/admin/bots/verify-model', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                      body: JSON.stringify({ modelName: targetModel })
                                    });
                                    const vData = await vRes.json();
                                    if (!vData.ok) {
                                      showAlert(`❌ СОХРАНЕНИЕ БЛОКИРОВАНО: ${vData.error}`);
                                      return;
                                    }

                                    // Step 2: Save to DB only if Google API confirmed 200 OK
                                    await fetch(`/api/admin/bots/${bot.id}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                      body: JSON.stringify({ modelName: targetModel })
                                    });

                                    setModelPingLatencyMap(prev => ({ ...prev, [bot.id]: vData.latencyMs }));
                                    showAlert(`✅ МОДЕЛЬ ПОДТВЕРЖДЕНА И ЗАКРЕПЛЕНА: "${targetModel}" (${vData.latencyMs} мс)`);
                                    fetchAdminBots();
                                    fetchDynamicModels();
                                  } catch (err: any) {
                                    showAlert(`❌ Ошибка верификации: ${err?.message || err}`);
                                  } finally {
                                    setVerifyingBotId(null);
                                  }
                                }}
                              >
                                Закрепить модель
                              </Button>
                            </div>
                            <p className="text-[11px] text-[var(--color-text-tertiary)] font-sans-claude">
                              Перед сохранением выполняется онлайн-проверка Google API. Несуществующие имена автоматически блокируются.
                            </p>
                          </>
                        )}
                      </div>

                      <div className="bg-[var(--color-bg)] p-3 rounded-xl border border-[var(--color-border)] space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold uppercase text-[var(--color-text-tertiary)] block">
                            Системная инструкция (Методология):
                          </label>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Maximize2 size={13} />}
                            onClick={() => {
                              setEditingPromptBot(bot);
                              setEditingPromptText(bot.systemInstruction || '');
                            }}
                            className="text-[var(--color-accent-primary)] hover:bg-[var(--color-surface)]"
                          >
                            📝 Полноразмерный редактор
                          </Button>
                        </div>
                        <textarea
                          defaultValue={bot.systemInstruction}
                          rows={3}
                          id={`bot-prompt-${bot.id}`}
                          className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-xl p-3 text-xs font-sans-claude leading-relaxed"
                          placeholder="Корпоративная методология и регламенты для ИИ..."
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={async () => {
                              const promptVal = (document.getElementById(`bot-prompt-${bot.id}`) as HTMLTextAreaElement)?.value;
                              await fetch(`/api/admin/bots/${bot.id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                body: JSON.stringify({ systemInstruction: promptVal })
                              });
                              showAlert('Системная инструкция бота сохранена');
                              fetchAdminBots();
                            }}
                          >
                            Сохранить промпт
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Admin Limits & Memory Tab */}
            {adminTab === 'limits' && (
              <div className="max-w-4xl space-y-6">
                <div>
                  <h2 className="text-2xl font-serif-claude font-bold">Память и Лимиты системы</h2>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                    Мониторинг объема загруженных документов RAG, хранилищ клиентов и лимитов API
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="space-y-2 p-5">
                    <div className="flex items-center justify-between text-xs text-[var(--color-text-tertiary)] font-semibold uppercase">
                      <span>Использование RAG Store</span>
                      <Folder size={16} className="text-[var(--color-accent-primary)]" />
                    </div>
                    <div className="text-2xl font-bold font-serif-claude">
                      {ragStats ? `${ragStats.usagePercent}%` : '0%'}
                    </div>
                    <ProgressBar value={ragStats ? ragStats.usagePercent : 0} />
                    <p className="text-[11px] text-[var(--color-text-tertiary)]">
                      {ragStats ? `${ragStats.totalSizeMB} MB из ${ragStats.maxSizeMB} MB (${ragStats.totalDocs} файлов)` : 'Загрузка...'}
                    </p>
                  </Card>

                  <Card className="space-y-2 p-5">
                    <div className="flex items-center justify-between text-xs text-[var(--color-text-tertiary)] font-semibold uppercase">
                      <span>Выделено RAG-Хранилищ</span>
                      <Activity size={16} className="text-[var(--color-accent-primary)]" />
                    </div>
                    <div className="text-2xl font-bold font-serif-claude">
                      {ragStats ? ragStats.totalStores : (adminBots.length + adminUsers.length)}
                    </div>
                    <p className="text-[11px] text-[var(--color-text-tertiary)]">
                      {ragStats ? `${ragStats.totalStores} изолированных векторных хранилищ` : 'Google Vector Stores пользователей'}
                    </p>
                  </Card>

                  <Card className="space-y-2 p-5">
                    <div className="flex items-center justify-between text-xs text-[var(--color-text-tertiary)] font-semibold uppercase">
                      <span>Системный Rate Limit API</span>
                      <Sliders size={16} className="text-[var(--color-accent-primary)]" />
                    </div>
                    <div className={`text-2xl font-bold font-serif-claude ${isApiKeyConfigured ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--color-text-tertiary)]'}`}>
                      {isApiKeyConfigured ? (systemSettings ? `${systemSettings.rateLimitPerMinute} RPM` : '20 RPM') : '0 RPM'}
                    </div>
                    <p className="text-[11px] text-[var(--color-text-tertiary)]">
                      {isApiKeyConfigured
                        ? (systemSettings ? `Лимит сервера: ${systemSettings.rateLimitPerDay} запр/день` : 'Лимит запросов к API')
                        : '⚠️ API-ключ не настроен'}
                    </p>
                  </Card>
                </div>

                {/* System Settings Form */}
                <Card className="p-6 space-y-4">
                  <h3 className="text-lg font-serif-claude font-bold">Настройка системных лимитов и памяти</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[var(--color-text-secondary)]">Размер скользящего окна памяти (сообщений):</label>
                      <input
                        type="number"
                        id="setting-sliding-window"
                        defaultValue={systemSettings?.slidingWindowSize || 15}
                        className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded p-2 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[var(--color-text-secondary)]">Порог суммаризации контекста:</label>
                      <input
                        type="number"
                        id="setting-summary-threshold"
                        defaultValue={systemSettings?.summarizationThreshold || 30}
                        className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded p-2 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[var(--color-text-secondary)]">Лимит запросов в минуту (RPM):</label>
                      <input
                        type="number"
                        id="setting-rpm"
                        defaultValue={systemSettings?.rateLimitPerMinute || 20}
                        className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded p-2 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[var(--color-text-secondary)]">Лимит запросов в день (RPD):</label>
                      <input
                        type="number"
                        id="setting-rpd"
                        defaultValue={systemSettings?.rateLimitPerDay || 500}
                        className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded p-2 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-[var(--color-text-secondary)]">Квота RAG-памяти клиента (MB):</label>
                      <input
                        type="number"
                        id="setting-rag-quota"
                        defaultValue={systemSettings?.clientRagQuotaMB || 500}
                        className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded p-2 text-xs"
                      />
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      const slidingWindowSize = parseInt((document.getElementById('setting-sliding-window') as HTMLInputElement)?.value || '15');
                      const summarizationThreshold = parseInt((document.getElementById('setting-summary-threshold') as HTMLInputElement)?.value || '30');
                      const rateLimitPerMinute = parseInt((document.getElementById('setting-rpm') as HTMLInputElement)?.value || '20');
                      const rateLimitPerDay = parseInt((document.getElementById('setting-rpd') as HTMLInputElement)?.value || '500');
                      const clientRagQuotaMB = parseInt((document.getElementById('setting-rag-quota') as HTMLInputElement)?.value || '500');
                      const dualRagPrompt = (document.getElementById('setting-dual-rag-prompt') as HTMLTextAreaElement)?.value || '';

                      await fetch('/api/admin/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ slidingWindowSize, summarizationThreshold, rateLimitPerMinute, rateLimitPerDay, clientRagQuotaMB, dualRagPrompt })
                      });
                      showAlert('Системные лимиты успешно обновлены');
                      fetchSettings();
                    }}
                  >
                    Сохранить лимиты
                  </Button>

                  {/* Dual-RAG Промпт Иерархии */}
                  <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-base font-serif-claude font-semibold">Эталонный промпт Dual-RAG иерархии</h3>
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById('setting-dual-rag-prompt') as HTMLTextAreaElement;
                          if (el) {
                            el.value = `--- [ENTERPRISE DUAL-RAG CONTEXT & DECISION ARCHITECTURE] ---

Ты — высококвалифицированный ИИ-эксперт аналитической платформы KRB SaaS, работающий по технологии Dual-RAG (двухуровневый векторный ретрив).
Тебе одновременно доступны два источника информации. Твоя задача — строго соблюдать их иерархию и правила приоритета:

================================================================
1. 📘 [БАЗА ЗНАНИЙ АССИСТЕНТА] (Системный Векторный Store)
   - НАЗНАЧЕНИЕ: Методологический стандарт, законы, регламенты, формулы расчетной логики и профессиональные инструкции.
   - ПРИОРИТЕТ: АБСОЛЮТНЫЙ ВЫСШИЙ ПРИОРИТЕТ.
   - ПРАВИЛО: Правила из Базы Ассистента являются НЕПРИКОСНОВЕННЫМ ЭТАЛОНОМ. Ты не имеешь права нарушать или игнорировать ни одно правило из этого источника.

2. 📄 [ДОКУМЕНТЫ ПОЛЬЗОВАТЕЛЯ / БИБЛИОТЕКА БИЗНЕСА] (Клиентский Store)
   - НАЗНАЧЕНИЕ: Исходные факты, финансовые показатели, таблицы, договоры и специфические данные компании клиента.
   - ПРИОРИТЕТ: ВТОРИЧНЫЙ (Операнд для обработки).
   - ПРАВИЛО: Данные пользователя являются «сырыми фактами». Они должны анализироваться и оцениваться ИСКЛЮЧИТЕЛЬНО сквозь призму правил из Базы Ассистента.
================================================================

--- [АЛГОРИТМ ОБРАБОТКИ И ПРАВИЛА ПРИНЯТИЯ РЕШЕНИЙ] ---

1. РАЗРЕШЕНИЕ КОНФЛИКТОВ И ПРОТИВОРЕЧИЙ:
   - Если факты или действия из Документов Пользователя ПРОТИВОРЕЧАТ методологии из Базы Ассистента — ты ОБЯЗАН в самом начале ответа явно выделить этот конфликт!
   - Шаблон предупреждения: «⚠️ Внимание: В ваших документах обнаружено отклонение от методологического стандарта [Название стандарта]. [Описание несоответствия]».

2. ОБРАБОТКА НЕДОСТАТКА ДАННЫХ (ANTI-HALLUCINATION PROTOCOL):
   - Запрещено додумывать факты, экстраполировать цифры или придумывать несозданные пункты договоров.
   - Если вопрос пользователя касается данных его бизнеса, но в [ДОКУМЕНТАХ ПОЛЬЗОВАТЕЛЯ] нет этих сведений — прямо сообщи: «В вашей Библиотеке бизнеса не найдены данные по [теме]. Для точного анализа загрузите документ, содержащий [необходимые сведения]».

3. СТРУКТУРА И ФОРМАТИРОВАНИЕ ОТВЕТА:
   - Ответ должен быть четким, структурированным и профессиональным (markdown, списки, таблицы).
   - Ссылка на первоисточники: при цитировании методологии или фактов явно указывай, на какой источник (Методология или Файл клиента) ты опираешься.
   - Итоговый вывод должен содержать конкретные рекомендации по исправлению ошибок бизнеса на основе правил Ассистента.`;
                          }
                        }}
                        className="text-xs text-[var(--color-accent-primary)] hover:underline font-semibold"
                      >
                        Восстановить базовый промпт
                      </button>
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] mb-3">
                      Системная инструкция, автоматически подмешиваемая к ассистентам при одновременном наличии базы знаний бота и документов пользователя.
                    </p>
                    <textarea
                      id="setting-dual-rag-prompt"
                      defaultValue={
                        systemSettings?.dualRagPrompt ||
                        `--- [ENTERPRISE DUAL-RAG CONTEXT & DECISION ARCHITECTURE] ---

Ты — высококвалифицированный ИИ-эксперт аналитической платформы KRB SaaS, работающий по технологии Dual-RAG (двухуровневый векторный ретрив).
Тебе одновременно доступны два источника информации. Твоя задача — строго соблюдать их иерархию и правила приоритета:

================================================================
1. 📘 [БАЗА ЗНАНИЙ АССИСТЕНТА] (Системный Векторный Store)
   - НАЗНАЧЕНИЕ: Методологический стандарт, законы, регламенты, формулы расчетной логики и профессиональные инструкции.
   - ПРИОРИТЕТ: АБСОЛЮТНЫЙ ВЫСШИЙ ПРИОРИТЕТ.
   - ПРАВИЛО: Правила из Базы Ассистента являются НЕПРИКОСНОВЕННЫМ ЭТАЛОНОМ. Ты не имеешь права нарушать или игнорировать ни одно правило из этого источника.

2. 📄 [ДОКУМЕНТЫ ПОЛЬЗОВАТЕЛЯ / БИБЛИОТЕКА БИЗНЕСА] (Клиентский Store)
   - НАЗНАЧЕНИЕ: Исходные факты, финансовые показатели, таблицы, договоры и специфические данные компании клиента.
   - ПРИОРИТЕТ: ВТОРИЧНЫЙ (Операнд для обработки).
   - ПРАВИЛО: Данные пользователя являются «сырыми фактами». Они должны анализироваться и оцениваться ИСКЛЮЧИТЕЛЬНО сквозь призму правил из Базы Ассистента.
================================================================

--- [АЛГОРИТМ ОБРАБОТКИ И ПРАВИЛА ПРИНЯТИЯ РЕШЕНИЙ] ---

1. РАЗРЕШЕНИЕ КОНФЛИКТОВ И ПРОТИВОРЕЧИЙ:
   - Если факты или действия из Документов Пользователя ПРОТИВОРЕЧАТ методологии из Базы Ассистента — ты ОБЯЗАН в самом начале ответа явно выделить этот конфликт!
   - Шаблон предупреждения: «⚠️ Внимание: В ваших документах обнаружено отклонение от методологического стандарта [Название стандарта]. [Описание несоответствия]».

2. ОБРАБОТКА НЕДОСТАТКА ДАННЫХ (ANTI-HALLUCINATION PROTOCOL):
   - Запрещено додумывать факты, экстраполировать цифры или придумывать несозданные пункты договоров.
   - Если вопрос пользователя касается данных его бизнеса, но в [ДОКУМЕНТАХ ПОЛЬЗОВАТЕЛЯ] нет этих сведений — прямо сообщи: «В вашей Библиотеке бизнеса не найдены данные по [теме]. Для точного анализа загрузите документ, содержащий [необходимые сведения]».

3. СТРУКТУРА И ФОРМАТИРОВАНИЕ ОТВЕТА:
   - Ответ должен быть четким, структурированным и профессиональным (markdown, списки, таблицы).
   - Ссылка на первоисточники: при цитировании методологии или фактов явно указывай, на какой источник (Методология или Файл клиента) ты опираешься.
   - Итоговый вывод должен содержать конкретные рекомендации по исправлению ошибок бизнеса на основе правил Ассистента.`
                      }
                      placeholder="Введите кастомный промпт Dual-RAG иерархии..."
                      rows={12}
                      className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-sm text-[var(--color-text-primary)] font-mono-claude focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)] resize-y"
                    />
                  </div>
                </Card>
              </div>
            )}

            {/* Admin Users Management Tab */}
            {adminTab === 'users' && (
              <div className="max-w-5xl space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-[var(--color-border)]">
                  <div>
                    <h2 className="text-2xl font-serif-claude font-bold">Управление Пользователями & RAG Изоляцией</h2>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                      Создание учеток, распределение ролей и автоматическое выделение изолированных Google Vector Stores
                    </p>
                  </div>
                  <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setShowAddUserModal(true)}>
                    + Создать пользователя
                  </Button>
                </div>

                <Card padding="none" className="overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[var(--color-surface-strong)] text-[var(--color-text-secondary)] uppercase text-[11px] font-semibold tracking-wider">
                      <tr>
                        <th className="p-4">Пользователь (Email)</th>
                        <th className="p-4">Роль</th>
                        <th className="p-4">Дата регистрации</th>
                        <th className="p-4">Персональное RAG Хранилище</th>
                        <th className="p-4 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {adminUsers.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-xs text-[var(--color-text-tertiary)]">
                            Загрузка списка пользователей...
                          </td>
                        </tr>
                      ) : (
                        adminUsers.map(user => (
                          <tr key={user.id} className="hover:bg-[var(--color-surface-strong)]/50 transition-colors">
                            <td className="p-4 font-medium text-[var(--color-text-primary)]">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-[var(--color-surface-strong)] flex items-center justify-center font-bold text-xs text-[var(--color-accent-primary)] border border-[var(--color-border)]">
                                  {user.email.slice(0, 2).toUpperCase()}
                                </div>
                                <span>{user.email}</span>
                              </div>
                            </td>
                            <td className="p-4">
                              <Badge
                                label={user.role === 'ADMIN' ? 'Администратор' : 'Клиент'}
                                status={user.role === 'ADMIN' ? 'warning' : 'success'}
                              />
                            </td>
                            <td className="p-4 text-xs text-[var(--color-text-tertiary)] font-mono">
                              {new Date(user.createdAt).toLocaleDateString()}
                            </td>
                            <td className="p-4">
                              {user.userStore?.fileSearchStoreName ? (
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-mono">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                  <span>{user.userStore.fileSearchStoreName}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-[var(--color-text-tertiary)] italic">Инициализируется при входе</span>
                              )}
                            </td>
                            <td className="p-4 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                icon={<Trash2 size={14} />}
                                onClick={() => handleDeleteUser(user.id, user.email)}
                              >
                                Удалить
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </Card>

                {/* Add User Modal */}
                {showAddUserModal && (
                  <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <Card className="max-w-md w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
                      <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)]">
                        <h3 className="text-lg font-serif-claude font-bold">Создать нового пользователя</h3>
                        <Button variant="ghost" size="sm" onClick={() => setShowAddUserModal(false)}>✕</Button>
                      </div>

                      <form onSubmit={handleCreateUser} className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-[var(--color-text-secondary)]">Email адрес:</label>
                          <input
                            type="email"
                            required
                            placeholder="client_new@krb.ai"
                            value={newUserEmail}
                            onChange={e => setNewUserEmail(e.target.value)}
                            className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-xl px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-[var(--color-text-secondary)]">Пароль:</label>
                          <input
                            type="password"
                            required
                            placeholder="••••••••"
                            value={newUserPassword}
                            onChange={e => setNewUserPassword(e.target.value)}
                            className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-xl px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-[var(--color-text-secondary)]">Роль в системе:</label>
                          <select
                            value={newUserRole}
                            onChange={e => setNewUserRole(e.target.value as any)}
                            className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-xl px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]"
                          >
                            <option value="CLIENT">Клиент (Доступ к чату и своей библиотеке)</option>
                            <option value="ADMIN">Администратор (Полный доступ к системе)</option>
                          </select>
                        </div>

                        <div className="p-3 bg-[var(--color-surface-strong)] rounded-xl border border-[var(--color-border)] text-xs text-[var(--color-text-tertiary)] space-y-1">
                          <div className="font-semibold text-[var(--color-text-secondary)]">🛡️ Автоматическая RAG-изоляция:</div>
                          <div>При создании учета бэкенд мгновенно выделит отдельное изолированное хранилище Google Vector Store для коммерческих документов.</div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                          <Button variant="secondary" onClick={() => setShowAddUserModal(false)}>Отмена</Button>
                          <Button variant="primary" type="submit" disabled={isCreatingUser}>
                            {isCreatingUser ? 'Создание...' : 'Создать учетную запись'}
                          </Button>
                        </div>
                      </form>
                    </Card>
                  </div>
                )}
              </div>
            )}

            {/* Admin Gemini Diagnostics Tab */}
            {adminTab === 'diagnostics' && (
              <div className="max-w-5xl space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-serif-claude font-bold">Диагностика Gemini & Telemetry</h2>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                      Журнал производительности генерации ответов и времени отклика (Latency)
                    </p>
                  </div>
                  {isApiKeyConfigured ? (
                    <Badge label="Интеграция готова" status="success" />
                  ) : (
                    <Badge label="Интеграция не настроена" status="warning" />
                  )}
                </div>

                <Card padding="none" className="overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[var(--color-surface-strong)] text-[var(--color-text-secondary)] uppercase text-xs">
                      <tr>
                        <th className="p-4">Время</th>
                        <th className="p-4">Модель Gemini</th>
                        <th className="p-4">Latency (мс)</th>
                        <th className="p-4">RAG Store</th>
                        <th className="p-4">Статус</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)] text-xs font-mono-claude">
                      {diagnosticsLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-[var(--color-text-tertiary)] font-sans-claude">
                            Журнал телеметрии пуст. Отправьте запрос боту в чате для фиксации первой метрики.
                          </td>
                        </tr>
                      ) : (
                        diagnosticsLogs.map(log => (
                          <tr key={log.id}>
                            <td className="p-4 text-[var(--color-text-tertiary)]">
                              {new Date(log.createdAt).toLocaleTimeString()}
                            </td>
                            <td className="p-4 font-semibold text-[var(--color-accent-primary)] font-mono">
                              {log.modelName || 'gemini-2.5-flash'}
                            </td>
                            <td className="p-4 font-mono text-[var(--color-text-primary)]">
                              {log.responseTime ? `${log.responseTime} мс` : '-'}
                            </td>
                            <td className="p-4">
                              <Badge 
                                label={log.fileSearchUsed ? 'Dual-RAG Active' : 'Базовый контект'} 
                                status={log.fileSearchUsed ? 'success' : 'neutral'} 
                              />
                            </td>
                            <td className="p-4">
                              <Badge 
                                label={log.status || 'SUCCESS'} 
                                status={log.status === 'SUCCESS' ? 'success' : 'error'} 
                              />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </Card>
              </div>
            )}

            {/* Admin Logs Tab */}
            {adminTab === 'logs' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--color-border)]">
                  <div>
                    <h2 className="text-xl font-serif-claude font-bold">Системные Логи (system.log)</h2>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                      Сквозное логирование событий сервера и действий пользователей в реальном времени
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Log Level Select Dropdown */}
                    <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                      <span>Уровень:</span>
                      <select
                        id="log-level-select"
                        value={selectedLogLevel}
                        onChange={(e) => {
                          const val = e.target.value as 'ALL' | 'INFO' | 'ERROR' | 'DEBUG';
                          setSelectedLogLevel(val);
                          logClientAction('INFO', `Фильтр логов изменен на [${val}]`);
                        }}
                        className="bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]"
                      >
                        <option value="ALL">Все логи (ALL)</option>
                        <option value="INFO">Инфо (INFO)</option>
                        <option value="ERROR">Ошибки (ERROR)</option>
                        <option value="DEBUG">Отладка (DEBUG)</option>
                      </select>
                    </div>

                    {/* Auto-Refresh Toggle */}
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface-strong)] border border-[var(--color-border)] px-3 py-1.5 rounded-lg select-none">
                      <input
                        type="checkbox"
                        id="log-auto-refresh-toggle"
                        checked={isAutoRefreshLogs}
                        onChange={(e) => setIsAutoRefreshLogs(e.target.checked)}
                        className="rounded border-[var(--color-border)] text-[var(--color-accent-primary)] focus:ring-0 cursor-pointer"
                      />
                      <span>Автообновление (3с)</span>
                    </label>

                    <Button variant="secondary" size="sm" onClick={fetchSystemLogs}>Обновить</Button>
                    <Button variant="danger" size="sm" onClick={deleteSystemLogs}>Очистить логи</Button>
                  </div>
                </div>

                <div className="bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-xl p-4 h-[450px] overflow-y-auto font-mono-claude text-xs space-y-1.5">
                  {[...systemLogs].reverse().map(log => (
                    <div key={log.id} className="hover:bg-[var(--color-bg)] p-2 rounded flex flex-col gap-1 border-b border-[var(--color-border)]/40 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--color-text-tertiary)] shrink-0 font-mono text-[11px]">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        <Badge label={log.level} status={log.level === 'ERROR' ? 'error' : log.level === 'DEBUG' ? 'warning' : 'neutral'} />
                        <span className="break-all text-[var(--color-text-primary)] font-medium text-xs">{log.message}</span>
                      </div>
                      {log.level === 'ERROR' && log.meta && (
                        <details className="ml-16 mt-1 group">
                          <summary className="cursor-pointer text-[11px] font-semibold text-red-600 dark:text-red-400 hover:underline inline-flex items-center gap-1 select-none">
                            <span>🔍 Показать подробные детали ошибки (Diagnostics)</span>
                          </summary>
                          <div className="mt-1.5 p-3 rounded-xl bg-slate-950 text-slate-100 text-xs font-mono break-all space-y-1 shadow-lg border border-slate-700">
                            <div className="font-bold text-red-400 uppercase tracking-wider text-[10px]">Детали ошибки / Stack Trace:</div>
                            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed max-h-48 overflow-y-auto text-slate-200">{typeof log.meta === 'string' ? log.meta : JSON.stringify(log.meta, null, 2)}</pre>
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>
        </div>

      ) : (

        /* CLIENT VIEW (Chat & Business Library) */
        <div className="flex-1 flex overflow-hidden">
          {clientTab === 'chat' ? (
            
            /* CLAUDE STYLE AI CHAT SCREEN */
            <div className="flex-1 flex flex-col bg-[var(--color-bg)] max-w-4xl mx-auto w-full px-4 py-6">
              
              {chatError && (
                <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl space-y-2 text-sm text-red-600 dark:text-red-400 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertTriangle size={18} className="shrink-0 text-red-500" />
                      <span>{chatError}</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { setChatError(null); setChatErrorDetails(null); }}>Закрыть</Button>
                  </div>
                  {chatErrorDetails && (userRole === 'ADMIN' || isAdminRoute) && (
                    <div className="p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-xs font-mono text-red-300 space-y-1">
                      <div className="font-bold flex items-center gap-1 text-red-400">
                        <span>🔧 Детали ошибки для Администратора:</span>
                      </div>
                      <div className="break-all text-[11px] font-sans-claude">{chatErrorDetails}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Top Bot Selector & Clear History */}
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-[var(--color-border)]">
                <DropdownSelect
                  label="Ассистент:"
                  options={bots}
                  value={selectedBot?.id || ''}
                  onChange={(id) => {
                    const b = bots.find(bot => bot.id === id);
                    if (b) setSelectedBot(b);
                  }}
                />

                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  onClick={handleClearHistory}
                >
                  Очистить чат
                </Button>
              </div>

              {/* Messages Container */}
              <div className="flex-1 overflow-y-auto space-y-6 pr-2">
                {messages.length === 0 ? (
                  
                  /* Empty State Large Serif Greeting */
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-6 py-12">
                    <div className="p-4 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-accent-primary)] shadow-sm">
                      <Sparkles size={36} />
                    </div>
                    <div>
                      <h2 className="text-4xl font-serif-claude font-medium tracking-tight">
                        Afternoon, Mikhail
                      </h2>
                      <p className="text-sm text-[var(--color-text-secondary)] mt-2 max-w-md">
                        Чем я могу помочь вам сегодня? Выберите готовый вопрос или загрузите документы в Библиотеку бизнеса.
                      </p>
                    </div>

                    {/* Action Pills */}
                    <div className="flex flex-wrap justify-center gap-3 max-w-lg">
                      <button
                        onClick={() => setInputMessage('Подготовь проект соглашения о конфиденциальности (NDA)')}
                        className="px-4 py-2 bg-[var(--color-surface)] hover:bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-full text-xs font-medium transition-all"
                      >
                        📄 Подготовить проект NDA
                      </button>
                      <button
                        onClick={() => setInputMessage('Проведи аудит регламентов из базы знаний RAG')}
                        className="px-4 py-2 bg-[var(--color-surface)] hover:bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-full text-xs font-medium transition-all"
                      >
                        🔍 Аудит регламентов RAG
                      </button>
                    </div>
                  </div>

                ) : (

                  /* Active Chat Stream */
                  messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {msg.role === 'user' ? (
                        
                        /* User Message (Compact Gray Capsule on Right) */
                        <div className="max-w-[75%] space-y-1 text-right">
                          <div className="bg-[var(--color-surface-strong)] border border-[var(--color-border)] px-4 py-3 rounded-2xl rounded-tr-sm text-sm text-[var(--color-text-primary)] shadow-sm text-left">
                            {msg.content}
                          </div>
                          {msg.createdAt && (
                            <span className="text-[10px] text-[var(--color-text-tertiary)] px-1">
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>

                      ) : (

                        /* Assistant Message (Unboxed Clear Text on Left) */
                        <div className="max-w-[85%] space-y-2 text-left">
                          <div className="flex items-center justify-between text-xs text-[var(--color-text-tertiary)] font-serif-claude">
                            <div className="flex items-center gap-2">
                              <Sparkles size={14} className="text-[var(--color-accent-primary)]" />
                              <span>{selectedBot?.name || 'Ассистент'}</span>
                            </div>
                            {msg.createdAt && (
                              <span className="text-[10px] font-sans-claude text-[var(--color-text-tertiary)]">
                                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                          <div className="w-full">
                            {msg.content && msg.content.trim() !== '' ? (
                              <PerplexityMarkdownRenderer content={msg.content} />
                            ) : (
                              msg.groundingMetadata ? (
                                <p className="text-sm font-sans-claude italic text-[var(--color-text-secondary)]">
                                  Ответ сформирован на основе материалов из вашей Библиотеки бизнеса.
                                </p>
                              ) : null
                            )}
                          </div>

                          {/* Grounding Sources Card — show ONLY when model has actual citation supports */}
                          {(() => {
                            if (!msg.groundingMetadata) return null;
                            try {
                              const parsed = typeof msg.groundingMetadata === 'string' ? JSON.parse(msg.groundingMetadata) : msg.groundingMetadata;
                              
                              // TZ §4: Show sources ONLY when groundingSupports is non-empty
                              // (model actually cited a specific text fragment, not just "found nearby vectors")
                              const supports = parsed?.groundingSupports || [];
                              if (supports.length === 0) return null;

                              // Get chunks referenced by actual supports
                              const chunks = parsed?.groundingChunks || [];
                              const referencedIndices = new Set<number>(
                                supports.flatMap((s: any) => s.groundingChunkIndices || [])
                              );
                              const referencedChunks = chunks.filter((_: any, i: number) => referencedIndices.has(i));
                              
                              // Extract active file names from state (Google Store is source of truth)
                              const activeFileNames = new Set((files || []).map((f: any) => f.displayName || f.name));

                              // Filter: exclude internal bot files, keep only those in client's active library
                              const clientChunks = referencedChunks.filter((c: any) => {
                                const title = c.retrievedContext?.title || '';
                                if (title.includes('Описание КРБ') || title.includes('system') || title.includes('bot')) {
                                  return false;
                                }
                                return activeFileNames.size === 0 || activeFileNames.has(title);
                              });

                              if (clientChunks.length === 0) return null;

                              return (
                                <div className="mt-3 pt-3 border-t border-[var(--color-border)]/50 space-y-2">
                                  <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)] font-sans-claude font-medium">
                                    <Search size={13} className="text-[var(--color-accent-primary)]" />
                                    <span>Источники знания:</span>
                                  </div>
                                  <div className="flex flex-wrap gap-2 items-center">
                                    {(() => {
                                      const groupedMap = new Map<string, number>();
                                      clientChunks.forEach((c: any) => {
                                        const rawTitle = c.retrievedContext?.title || 'Документ RAG';
                                        groupedMap.set(rawTitle, (groupedMap.get(rawTitle) || 0) + 1);
                                      });
                                      return Array.from(groupedMap.entries()).map(([title, count], idx) => (
                                        <div key={idx} className="inline-flex items-center gap-1.5 px-3 py-1 bg-[var(--color-surface-strong)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full text-xs font-sans-claude text-[var(--color-text-primary)] shadow-xs transition-all">
                                          <span className="font-medium truncate max-w-[240px]" title={title}>
                                            {title}
                                          </span>
                                          <span className="text-[10px] font-mono text-[var(--color-accent-primary)] bg-[var(--color-bg)] px-1.5 py-0.5 rounded-full border border-[var(--color-border)]">
                                            {count > 1 ? `${count} цитат` : `+${idx + 1}`}
                                          </span>
                                        </div>
                                      ));
                                    })()}
                                  </div>
                                </div>
                              );
                            } catch (e) {
                              return null;
                            }
                          })()}
                        </div>
                      )}
                    </div>
                  ))
                )}

                {isSending && (
                  <div className="flex items-center gap-3 text-sm text-[var(--color-text-tertiary)] font-serif-claude animate-pulse">
                    <Sparkles size={16} className="text-[var(--color-accent-primary)] animate-spin" />
                    <span>Ассистент размышляет над ответом...</span>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input Bar */}
              <form onSubmit={handleSendMessage} className="mt-4 pt-3 border-t border-[var(--color-border)]">
                {chatError && (
                  <div className="mb-2 p-2 rounded-lg bg-[var(--color-error)]/10 text-[var(--color-error)] text-xs">
                    {chatError}
                  </div>
                )}
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={e => setInputMessage(e.target.value)}
                    placeholder="Напишите ваш запрос или вопрос по документам..."
                    className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-2xl pl-4 pr-12 py-3 text-sm focus:outline-none focus:border-[var(--color-accent-primary)]"
                  />
                  <button
                    type="submit"
                    disabled={!inputMessage.trim() || isSending}
                    className="absolute right-2 p-2 bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-secondary)] disabled:opacity-40 text-white rounded-xl transition-all"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </form>

            </div>

          ) : (

            /* BUSINESS LIBRARY RAG SCREEN */
            <div className="flex-1 flex bg-[var(--color-bg)] overflow-hidden">
              
              {/* Folder Sidebar */}
              <aside className="w-64 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4 shrink-0">
                <div className="flex items-center justify-between">
                  <h3 className="font-serif-claude font-bold text-lg">Папки бизнеса</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<FolderPlus size={16} />}
                    onClick={() => setShowFolderModal(true)}
                    aria-label="Создать папку"
                  />
                </div>

                <div className="space-y-1">
                  {folders.map(folder => (
                    <div
                      key={folder}
                      onClick={() => setSelectedFolder(folder)}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm cursor-pointer transition-colors ${
                        selectedFolder === folder
                          ? 'bg-[var(--color-accent-primary)] text-white font-medium'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Folder size={16} />
                        <span className="truncate">{folder}</span>
                      </div>
                      {folder !== 'Все файлы' && (
                        <button
                          onClick={(e) => handleDeleteFolder(folder, e)}
                          className="hover:text-red-300 p-1"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-[var(--color-border)]">
                  {(() => {
                    const filteredFiles = selectedFolder === 'Все файлы' ? files : files.filter(f => getFileFolder(f) === selectedFolder);
                    const totalBytes = filteredFiles.reduce((acc, f) => acc + (parseInt(f.sizeBytes, 10) || 0), 0);
                    const quotaMB = systemSettings?.clientRagQuotaMB || 500;
                    const maxBytes = quotaMB * 1024 * 1024;
                    const percent = Math.min(100, Math.round((totalBytes / maxBytes) * 100)) || (filteredFiles.length > 0 ? 1 : 0);
                    const usedMB = (totalBytes / (1024 * 1024)).toFixed(1);
                    return (
                      <div className="space-y-1">
                        <ProgressBar
                          value={percent}
                          label="Использование RAG Store"
                          showPercentage
                        />
                        <p className="text-[11px] text-[var(--color-text-tertiary)]">
                          {usedMB} MB из {quotaMB} MB ({filteredFiles.length} файлов)
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </aside>

              {/* Files Table Area */}
              <main className="flex-1 p-6 overflow-y-auto space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-serif-claude font-bold">
                      {selectedFolder}
                    </h2>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                      Файлы и контекст, индексируемые Google Gemini Vector Store
                    </p>
                  </div>

                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-secondary)] text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm">
                    <UploadCloud size={16} />
                    <span>Загрузить документ</span>
                    <input
                      type="file"
                      className="hidden"
                      onChange={handleFileUpload}
                      disabled={isUploading}
                    />
                  </label>
                </div>

                {/* Interactive Drop Zone Area */}
                <input
                  id="drag-drop-file-input"
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                />
                {/* Active Upload Status Bar */}
                {isUploading ? (
                  <div className="bg-[var(--color-surface-strong)] border-2 border-[var(--color-accent-primary)]/50 rounded-2xl p-6 space-y-3 transition-all shadow-md">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Loader2 className="animate-spin text-[var(--color-accent-primary)] shrink-0" size={22} />
                        <div>
                          <h4 className="font-serif-claude font-medium text-base text-[var(--color-text-primary)]">
                            Идет векторная индексация файла...
                          </h4>
                          <p className="text-xs font-sans-claude text-[var(--color-text-secondary)] font-medium">
                            {uploadingFileName || 'Загрузка в Google Gemini Vector Store...'}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold text-[var(--color-accent-primary)] bg-[var(--color-bg)] px-2.5 py-1 rounded-full border border-[var(--color-border)]">
                        {uploadProgress}%
                      </span>
                    </div>
                    <ProgressBar value={uploadProgress} />
                    <p className="text-[11px] text-[var(--color-text-tertiary)] italic">
                      ⏳ Пожалуйста, подождите. Файл обрабатывается и привязывается к векторному хранилищу RAG.
                    </p>
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        const droppedFile = e.dataTransfer.files[0];
                        const fakeEvent = {
                          target: { files: [droppedFile] }
                        } as unknown as React.ChangeEvent<HTMLInputElement>;
                        handleFileUpload(fakeEvent);
                      }
                    }}
                    className="border-2 border-dashed border-[var(--color-border)] hover:border-[var(--color-accent-primary)] rounded-2xl p-8 text-center bg-[var(--color-surface)]/50 hover:bg-[var(--color-surface-strong)] space-y-2 transition-all cursor-pointer group"
                    onClick={() => {
                      const fileInput = document.getElementById('drag-drop-file-input') as HTMLInputElement;
                      if (fileInput) fileInput.click();
                    }}
                  >
                    <UploadCloud size={32} className="mx-auto text-[var(--color-accent-primary)] group-hover:scale-110 transition-transform" />
                    <h4 className="font-serif-claude font-medium text-base text-[var(--color-text-primary)]">
                      Перетащите сюда файлы для загрузки
                    </h4>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      Поддерживаются PDF, DOCX, TXT, MD файлы (Макс. 50 MB)
                    </p>
                  </div>
                )}

                {/* Active Deleting Status Bar */}
                {deletingFileName && (
                  <div className="bg-[var(--color-error)]/10 border-2 border-[var(--color-error)]/40 rounded-2xl p-4 flex items-center justify-between animate-pulse shadow-sm">
                    <div className="flex items-center gap-3">
                      <Loader2 className="animate-spin text-[var(--color-error)] shrink-0" size={20} />
                      <div>
                        <h5 className="font-serif-claude font-medium text-sm text-[var(--color-text-primary)]">
                          Удаление файла из Google RAG Store...
                        </h5>
                        <p className="text-xs font-sans-claude text-[var(--color-text-secondary)] font-medium">
                          Удаляется: <span className="font-bold text-[var(--color-text-primary)]">{deletingFileName}</span>
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-bold text-[var(--color-error)] bg-[var(--color-bg)] px-2.5 py-1 rounded-full border border-[var(--color-border)]">
                      ⏳ Удаление...
                    </span>
                  </div>
                )}

                {/* Files Table */}
                <Card padding="none" className="overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[var(--color-surface-strong)] text-[var(--color-text-secondary)] uppercase text-xs">
                      <tr>
                        <th className="p-4">Имя файла</th>
                        <th className="p-4">Текущая папка</th>
                        <th className="p-4">Статус Google RAG</th>
                        <th className="p-4">Перенос в папку</th>
                        <th className="p-4">Дата</th>
                        <th className="p-4 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {(() => {
                        const filteredFiles = selectedFolder === 'Все файлы' ? files : files.filter(f => getFileFolder(f) === selectedFolder);
                        if (filteredFiles.length === 0) {
                          return (
                            <tr>
                              <td colSpan={6} className="p-8 text-center text-xs text-[var(--color-text-tertiary)]">
                                В папке "{selectedFolder}" пока нет файлов.
                              </td>
                            </tr>
                          );
                        }
                        return filteredFiles.map(file => {
                          const stateLabel = file.state || 'ACTIVE';
                          const statusColor = stateLabel === 'PROCESSING' || stateLabel === 'INDEXING' ? 'warning' : stateLabel === 'FAILED' ? 'error' : 'success';
                          
                          let rawDisplayName = file.displayName || file.name;
                          if (rawDisplayName.includes('Ð') || /[\u00C0-\u00FF]/.test(rawDisplayName)) {
                            try {
                              const bytes = Uint8Array.from(rawDisplayName.split('').map(c => c.charCodeAt(0)));
                              const decoded = new TextDecoder('utf-8').decode(bytes);
                              if (/[а-яА-ЯёЁ]/.test(decoded)) rawDisplayName = decoded;
                            } catch (e) {}
                          }

                          const isItemDeleting = deletingFileName === rawDisplayName || deletingFileName === file.name;

                          return (
                            <tr key={file.name} className={isItemDeleting ? 'opacity-40 pointer-events-none bg-[var(--color-error)]/5' : ''}>
                              <td className="p-4 font-medium font-sans-claude flex items-center gap-2">
                                <FileText size={16} className="text-[var(--color-accent-primary)] shrink-0" />
                                <span className="truncate max-w-xs">{rawDisplayName}</span>
                              </td>
                              <td className="p-4">
                                <Badge label={getFileFolder(file)} status="neutral" />
                              </td>
                              <td className="p-4">
                                <Badge label={stateLabel === 'ACTIVE' ? 'Готов к RAG' : stateLabel} status={statusColor} />
                              </td>
                              <td className="p-4">
                                <div className="flex items-center gap-1.5">
                                  <FolderInput size={14} className="text-[var(--color-accent-primary)] shrink-0" />
                                  <select
                                    value={getFileFolder(file)}
                                    onChange={(e) => handleMoveFile(file.name, e.target.value)}
                                    className="bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-lg px-2.5 py-1 text-xs font-sans-claude text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)] cursor-pointer"
                                    title="Выбрать новую папку для переноса"
                                  >
                                    {folders.map(f => (
                                      <option key={f} value={f}>📁 {f}</option>
                                    ))}
                                  </select>
                                </div>
                              </td>
                              <td className="p-4 text-xs text-[var(--color-text-tertiary)]">
                                {file.createTime ? new Date(file.createTime).toLocaleDateString() : 'Только что'}
                              </td>
                              <td className="p-4 text-right">
                                <Button
                                  variant="danger"
                                  size="sm"
                                  icon={<Trash2 size={14} />}
                                  onClick={() => handleDeleteFile(file.name, rawDisplayName)}
                                />
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </Card>
              </main>
            </div>
          )}
        </div>
      )}

      {/* Folder Modal Dialog */}
      <Modal
        isOpen={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        title="Создать новую папку"
      >
        <div className="space-y-4">
          <Input
            placeholder="Название папки (например: Аналитика 2026)"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowFolderModal(false)}>Отмена</Button>
            <Button variant="primary" onClick={handleCreateFolder}>Создать</Button>
          </div>
        </div>
      </Modal>

      {/* Large Modal Bot System Instruction Editor */}
      {editingPromptBot && (
        <Modal
          isOpen={true}
          onClose={() => setEditingPromptBot(null)}
          title={`Редактирование системной инструкции: ${editingPromptBot.name}`}
        >
          <div className="space-y-4 max-w-3xl w-full">
            <p className="text-xs text-[var(--color-text-secondary)] font-sans-claude">
              Укажите корпоративную методологию, правила и ограничения для ассистента. В технологии Dual-RAG эти системные правила имеют высший приоритет над клиентскими файлами.
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-[var(--color-text-tertiary)]">
                <span>Область ввода методологии (System Prompt)</span>
                <span>Символов: {editingPromptText.length}</span>
              </div>
              <textarea
                value={editingPromptText}
                onChange={e => setEditingPromptText(e.target.value)}
                rows={16}
                placeholder="Вставьте корпоративный регламент, законы или инструкции для бота..."
                className="w-full bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-2xl p-4 text-xs font-sans-claude leading-relaxed focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)] shadow-inner"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setEditingPromptBot(null)}>
                Отмена
              </Button>
              <Button
                variant="primary"
                disabled={isSavingPrompt}
                onClick={async () => {
                  setIsSavingPrompt(true);
                  try {
                    await fetch(`/api/admin/bots/${editingPromptBot.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ systemInstruction: editingPromptText })
                    });
                    showAlert(`Системная инструкция для "${editingPromptBot.name}" успешно обновлена`);
                    setEditingPromptBot(null);
                    fetchAdminBots();
                  } catch (err) {
                    showAlert('Ошибка сохранения инструкции');
                  } finally {
                    setIsSavingPrompt(false);
                  }
                }}
              >
                {isSavingPrompt ? 'Сохранение...' : 'Сохранить инструкцию'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Universal Confirm / Alert Modal Dialog */}
      {dialog && (
        <Modal
          isOpen={true}
          onClose={() => setDialog(null)}
          title={dialog.type === 'confirm' ? 'Подтверждение действия' : 'Уведомление'}
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {dialog.message}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              {dialog.type === 'confirm' && (
                <Button variant="secondary" onClick={() => setDialog(null)}>
                  Отмена
                </Button>
              )}
              <Button
                variant={dialog.type === 'confirm' ? 'danger' : 'primary'}
                onClick={() => {
                  const cb = dialog?.onConfirm;
                  setDialog(null);
                  if (cb) cb();
                }}
              >
                {dialog.type === 'confirm' ? 'Удалить' : 'OK'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('AppErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6 font-sans-claude">
          <div className="max-w-md w-full p-8 rounded-2xl bg-slate-800 border border-slate-700 space-y-4 text-center shadow-2xl">
            <div className="inline-flex p-3 rounded-full bg-red-500/20 text-red-400">
              <AlertTriangle size={32} />
            </div>
            <h2 className="text-xl font-bold font-serif-claude">Произошла ошибка интерфейса</h2>
            <p className="text-xs text-slate-400">
              Обнаружен непредвиденный сбой сеанса. Нажмите кнопку ниже для автоматического сброса кэша и восстановления доступа.
            </p>
            <div className="p-3 rounded-xl bg-slate-950 text-left text-[11px] font-mono text-red-300 break-all max-h-32 overflow-y-auto border border-slate-700">
              {String(this.state.error?.message || this.state.error || 'Unknown Client Exception')}
            </div>
            <button
              className="w-full py-2.5 px-4 bg-[var(--color-accent-primary)] hover:opacity-90 text-white font-medium rounded-xl text-sm transition-all"
              onClick={() => {
                localStorage.clear();
                window.location.href = '/';
              }}
            >
              Сбросить сессию и Войти снова
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  if (window.location.pathname === '/design-system-demo') {
    return (
      <ThemeProvider>
        <DemoPage />
      </ThemeProvider>
    );
  }

  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
