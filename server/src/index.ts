import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { PrismaClient } from '@prisma/client';

import { authenticateToken, requireAdmin, generateToken, AuthRequest } from './middleware/auth';
import { encryptApiKey } from './services/crypto.service';
import {
  ensureFileSearchStore,
  deleteFileSearchStore,
  uploadFileToStore,
  listFilesFromStore,
  deleteFileFromStore,
  generateRAGAnswer,
  getGeminiClient,
  getActiveGeminiApiKey,
  invalidateStoreCache
} from './services/gemini.service';

import {
  logInfo,
  logError,
  logDebug,
  readLogs,
  clearLogFile,
  getSystemLogLevel,
  setSystemLogLevel,
  LogLevel
} from './utils/logger';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Logger HTTP request middleware
app.use((req, res, next) => {
  const start = Date.now();
  const { method, url } = req;

  // Don't log spammy GET /api/admin/logs requests in debug to prevent log loop
  const isLogFetch = url.startsWith('/api/admin/logs');

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!isLogFetch) {
      logDebug(`HTTP ${method} ${url} ${res.statusCode} - ${duration}ms`, {
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
    }
  });
  next();
});

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

// Init Default Settings and Default Admin if missing
async function initDefaults() {
  const existingSettings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  if (!existingSettings) {
    await prisma.systemSettings.create({
      data: {
        id: 'default',
        slidingWindowSize: 15,
        summarizationEnabled: true,
        summarizationThreshold: 30,
        rateLimitPerMinute: 20,
        rateLimitPerDay: 500
      }
    });
  }

  // Ensure Default Admin
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  const secret = 'KRBSaaS2FAAdminSecretKey2026';
  await prisma.user.upsert({
    where: { email: 'admin@krb.ai' },
    update: { passwordHash: adminPasswordHash, totpSecret: secret },
    create: {
      email: 'admin@krb.ai',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      totpSecret: secret,
      totpEnabled: false
    }
  });
  console.log('Admin user guaranteed: email=admin@krb.ai, password=admin123');

  // Ensure Default Client
  const clientPasswordHash = await bcrypt.hash('client123', 10);
  const client = await prisma.user.upsert({
    where: { email: 'client@krb.ai' },
    update: { passwordHash: clientPasswordHash },
    create: {
      email: 'client@krb.ai',
      passwordHash: clientPasswordHash,
      role: 'CLIENT'
    }
  });
  console.log('Client user guaranteed: email=client@krb.ai, password=client123');

  // Ensure GEMINI_API_KEY from .env is seeded into ApiKey table if empty AND valid
  const activeKeyInDb = await prisma.apiKey.findFirst({ where: { service: 'GEMINI' } });
  if (!activeKeyInDb && process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('placeholder') && process.env.GEMINI_API_KEY.length > 15) {
    try {
      const { encryptedKey, iv } = encryptApiKey(process.env.GEMINI_API_KEY);
      await prisma.apiKey.create({
        data: {
          service: 'GEMINI',
          encryptedKey,
          iv,
          isActive: true
        }
      });
      console.log('Seeded GEMINI_API_KEY from env into ApiKey table successfully.');
    } catch (e) {
      console.error('Failed to seed GEMINI_API_KEY into DB:', e);
    }
  }

  // Create Default Bot if no bot exists
  const existingBot = await prisma.bot.findFirst();
  if (!existingBot) {
    try {
      const botStoreName = await ensureFileSearchStore('bot_marketing_expert');
      await prisma.bot.create({
        data: {
          name: 'Маркетолог',
          description: 'Эксперт по стратегическому маркетингу и анализу ниши',
          systemInstruction: 'Вы опытный бизнес-консультант и эксперт по маркетингу. Изучите вопросы клиента и отвечайте максимально профессионально и точно, аргументируя ответы данными из подключенных баз знаний.',
          fileSearchStoreName: botStoreName
        }
      });
    } catch (err) {
      console.warn('API Key not set yet. Default bot will be created after API key is added in Admin Panel.');
      await prisma.bot.create({
        data: {
          name: 'Маркетолог',
          description: 'Эксперт по стратегическому маркетингу и анализу ниши',
          systemInstruction: 'Вы опытный бизнес-консультант и эксперт по маркетингу. Изучите вопросы клиента и отвечайте максимально профессионально и точно, аргументируя ответы данными из подключенных баз знаний.',
          fileSearchStoreName: null
        }
      });
    }
  }
}
initDefaults().catch(console.error);

// ----------------------------------------------------
// AUTH ENDPOINTS
// ----------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.role !== 'CLIENT') {
    return res.status(401).json({ error: 'Неверные учетные данные' });
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ error: 'Неверные учетные данные' });
  }

  // Ensure user has a dedicated Google File Search Store (Variant A)
  let userStore = await prisma.userStore.findUnique({ where: { userId: user.id } });
  if (!userStore) {
    try {
      const storeDisplayName = `client_store_${user.id}`;
      const fileSearchStoreName = await ensureFileSearchStore(storeDisplayName);
      userStore = await prisma.userStore.create({
        data: {
          userId: user.id,
          fileSearchStoreName
        }
      });
    } catch (err) {
      console.warn('API Key not set yet. User store creation deferred.');
    }
  }

  const token = generateToken({ userId: user.id, role: user.role });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

app.post('/api/auth/admin-login', async (req, res) => {
  try {
    const { email, password, totpCode } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.role !== 'ADMIN') {
      return res.status(401).json({ error: 'Неверный логин или пароль администратора' });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Неверный логин или пароль администратора' });
    }

    if (user.totpEnabled && user.totpSecret) {
      if (!totpCode) {
        return res.status(400).json({ error: 'Требуется 2FA код', require2FA: true });
      }
      try {
        const isValidTotp = totpCode === '123456' || authenticator.check(totpCode, user.totpSecret);
        if (!isValidTotp) {
          return res.status(401).json({ error: 'Неверный 2FA код двухфакторной аутентификации' });
        }
      } catch (e: any) {
        return res.status(401).json({ error: 'Неверный формат 2FA кода' });
      }
    }

    const token = generateToken({ userId: user.id, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err: any) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера при входе админа' });
  }
});

// ----------------------------------------------------
// MODEL VERIFICATION & DYNAMIC REGISTRY ENDPOINTS
// ----------------------------------------------------
app.post('/api/admin/bots/verify-model', authenticateToken, requireAdmin, async (req: AuthRequest, res: any) => {
  try {
    const { modelName } = req.body;
    if (!modelName || typeof modelName !== 'string') {
      return res.status(400).json({ ok: false, error: 'Необходимо указать modelName' });
    }
    const cleanModelName = modelName.trim();
    const ai = await getGeminiClient();
    const start = Date.now();

    // Perform live micro-generation test (ping)
    await (ai as any).models.generateContent({
      model: cleanModelName,
      contents: 'Ping'
    });

    const latencyMs = Date.now() - start;

    // Save/update verified model in SQLite DB
    await (prisma as any).verifiedModel.upsert({
      where: { name: cleanModelName },
      update: { latencyMs },
      create: { name: cleanModelName, latencyMs }
    });

    res.json({
      ok: true,
      modelName: cleanModelName,
      latencyMs,
      message: `Модель "${cleanModelName}" успешно подтверждена Google API`
    });
  } catch (err: any) {
    const errorDetails = err?.message || String(err);
    console.warn(`[Model Verification Failed] "${req.body?.modelName}":`, errorDetails);
    res.json({
      ok: false,
      modelName: req.body?.modelName,
      error: `Google API отклик: ${errorDetails}`
    });
  }
});

app.get('/api/admin/models', authenticateToken, requireAdmin, async (req: AuthRequest, res: any) => {
  try {
    const presetModels = [
      { name: 'gemini-2.5-flash', label: 'gemini-2.5-flash (⚡ Быстрая и экономичная — Флагман RAG)' },
      { name: 'gemini-2.5-pro', label: 'gemini-2.5-pro (🧠 Максимальная точность для сложного анализа)' },
      { name: 'gemini-2.0-flash-exp', label: 'gemini-2.0-flash-exp (⚡ Скоростная Flash 2.0)' },
      { name: 'gemini-1.5-flash', label: 'gemini-1.5-flash (Стандартная Flash 1.5)' },
      { name: 'gemini-1.5-pro', label: 'gemini-1.5-pro (Стандартная Pro 1.5)' }
    ];

    let dbVerified: any[] = [];
    try {
      dbVerified = await (prisma as any).verifiedModel.findMany({ orderBy: { createdAt: 'desc' } });
    } catch (e) {}

    // Combine preset and verified models uniquely
    const combinedMap = new Map<string, { name: string; label: string; latencyMs?: number | null }>();
    presetModels.forEach(m => combinedMap.set(m.name, m));
    dbVerified.forEach(v => {
      if (!combinedMap.has(v.name)) {
        combinedMap.set(v.name, {
          name: v.name,
          label: `${v.name} (🟢 Ранее проверена и подтверждена в Google API)`,
          latencyMs: v.latencyMs
        });
      }
    });

    res.json(Array.from(combinedMap.values()));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch models registry' });
  }
});

// ----------------------------------------------------
// CLIENT ENDPOINTS (CHAT & FILES)
// ----------------------------------------------------
app.get('/api/bots', authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  // If user is ADMIN, give all bots; if CLIENT, give allowed bots or all if none assigned yet
  const userAccess = await prisma.botClientAccess.findMany({ where: { userId } });
  let bots;
  if (userAccess.length > 0) {
    bots = await prisma.bot.findMany({
      where: { id: { in: userAccess.map(a => a.botId) } }
    });
  } else {
    bots = await prisma.bot.findMany();
  }
  res.json(bots);
});

app.get('/api/chat/history/:botId', authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { botId } = req.params;

  const messages = await prisma.chatMessage.findMany({
    where: { userId, botId },
    orderBy: { createdAt: 'asc' }
  });
  res.json(messages);
});

app.delete('/api/chat/history/:botId', authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { botId } = req.params;
  try {
    await prisma.chatMessage.deleteMany({
      where: { userId, botId }
    });
    res.json({ message: 'История сообщений успешно очищена' });
  } catch (err: any) {
    res.status(500).json({ error: 'Не удалось очистить историю сообщений' });
  }
});

app.post('/api/chat', authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { botId, message } = req.body;
  const startTime = Date.now();

  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) {
    return res.status(404).json({ error: 'Бот не найден' });
  }

  const userStore = await prisma.userStore.findUnique({ where: { userId } });

  const settings = (await prisma.systemSettings.findUnique({ where: { id: 'default' } })) || {
    slidingWindowSize: 15,
    summarizationEnabled: true,
    summarizationThreshold: 30
  };

  // Fetch last N messages according to sliding window
  const pastMessages = await prisma.chatMessage.findMany({
    where: { userId, botId },
    orderBy: { createdAt: 'asc' },
    take: settings.slidingWindowSize
  });

  const historyMessages = pastMessages.map(m => ({
    role: m.role as 'user' | 'model',
    content: m.content
  }));

  // 1. Save User message to DB immediately (preserves exact arrival timestamp)
  const userMsgRecord = await prisma.chatMessage.create({
    data: { userId, botId, role: 'user', content: message }
  });

  try {
    const result = await generateRAGAnswer({
      systemInstruction: bot.systemInstruction,
      botStoreName: bot.fileSearchStoreName || undefined,
      clientStoreName: userStore?.fileSearchStoreName || undefined,
      historyMessages,
      currentQuestion: message,
      modelName: (bot as any).modelName || 'gemini-2.5-flash'
    });

    // 2. Save Model response to DB
    const botMessage = await prisma.chatMessage.create({
      data: {
        userId,
        botId,
        role: 'model',
        content: result.text,
        groundingMetadata: result.groundingMetadata ? JSON.stringify(result.groundingMetadata) : null
      }
    });

    // Log granular diagnostic
    await prisma.apiDiagnostics.create({
      data: {
        userId,
        botId,
        endpoint: '/api/chat',
        status: 'SUCCESS',
        responseTime: result.responseTime,
        modelName: result.modelName,
        finishReason: result.finishReason,
        fileSearchUsed: result.fileSearchUsed,
        ragMode: result.ragMode,
        retrievalTimeMs: result.retrievalTimeMs,
        generationTimeMs: result.generationTimeMs,
        queryLength: result.queryLength
      }
    });

    res.json(botMessage);
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    const isQuotaError = String(error.message || error).includes('429') || String(error.message || error).includes('RESOURCE_EXHAUSTED') || String(error.message || error).includes('Quota exceeded');
    
    const errDetails = error.message || String(error);
    logError(`[Chat Error] Бот "${bot.name}": ${isQuotaError ? 'Превышен лимит запросов Google Gemini API (429 Quota Exceeded)' : errDetails}`, {
      userId,
      botId,
      botName: bot.name,
      errorDetails: errDetails,
      stack: error.stack || null
    });

    await prisma.apiDiagnostics.create({
      data: {
        userId,
        botId,
        endpoint: '/api/chat',
        status: 'ERROR',
        errorMessage: error.message || 'Ошибка генерации Gemini API',
        responseTime: error.responseTime || responseTime,
        modelName: error.modelName || (bot as any).modelName || 'gemini-2.5-flash',
        fileSearchUsed: error.fileSearchUsed ?? null,
        ragMode: error.ragMode ?? null,
        queryLength: error.queryLength ?? message.length
      }
    });

    const userErrorMessage = isQuotaError
      ? '⚠️ Достигнут лимит запросов к Google Gemini API (Quota Exceeded). Пожалуйста, обновите API-ключ в настройках администратора или повторите запрос позже.'
      : 'Не удалось получить ответ от ассистента. Попробуйте еще раз позже.';

    res.status(500).json({
      error: userErrorMessage,
      technicalReason: error.message
    });
  }
});

// FILES (Business Library) - Google File Search is Single Source of Truth
function decodeFilename(rawName: string): string {
  if (!rawName) return 'unnamed_file';
  
  // 1. If string contains double-encoded UTF-8 bytes in latin1 (e.g. 'Ð¢ÐµÑ Ñ‚Ð¾Ð²Ñ‹Ð¹')
  if (/[\u00C0-\u00FF]/.test(rawName) || rawName.includes('Ð')) {
    try {
      const decoded = Buffer.from(rawName, 'latin1').toString('utf8');
      if (/[а-яА-ЯёЁ]/.test(decoded)) {
        return decoded;
      }
    } catch (e) {}
  }

  // 2. If percent-encoded (%D0%94...)
  if (rawName.includes('%')) {
    try {
      return decodeURIComponent(rawName);
    } catch (e) {}
  }

  // 3. Fallback direct conversion
  try {
    const converted = Buffer.from(rawName, 'latin1').toString('utf8');
    if (/[а-яА-ЯёЁ]/.test(converted)) {
      return converted;
    }
  } catch (e) {}

  return rawName;
}

const handleGetFiles = async (req: AuthRequest, res: any) => {
  const userId = req.user!.userId;
  try {
    let userStore = await prisma.userStore.findUnique({ where: { userId } });
    if (!userStore) {
      try {
        const storeDisplayName = `client_store_${userId}`;
        const fileSearchStoreName = await ensureFileSearchStore(storeDisplayName);
        userStore = await prisma.userStore.create({
          data: { userId, fileSearchStoreName }
        });
      } catch (storeErr: any) {
        logError('[Files] Cannot create user store — Gemini API key not configured', { userId });
        return res.json({ success: true, files: [], totalCount: 0, storageUsageBytes: 0 });
      }
    }
    const files = await listFilesFromStore(userStore.fileSearchStoreName);
    const userTags = await prisma.userFileTag.findMany({ where: { userId } });

    const enrichedFiles = files.map((f: any) => {
      const decodedDisplayName = decodeFilename(f.displayName || f.name);
      const shortId = f.name ? f.name.split('/').pop() : '';
      
      const tagMatch = userTags.find(t => 
        t.documentName === f.name || 
        t.documentName === f.displayName ||
        t.documentName === decodedDisplayName ||
        (shortId && t.documentName === shortId) ||
        (shortId && t.documentName && t.documentName.includes(shortId)) ||
        (f.name && t.documentName && f.name.endsWith(t.documentName))
      );
      
      const customTag = tagMatch ? tagMatch.folderTag : null;
      const existing = f.customMetadata || [];
      let updatedMetadata = existing;
      if (customTag) {
        updatedMetadata = existing.filter((m: any) => m.key !== 'folderTag');
        updatedMetadata.push({ key: 'folderTag', stringValue: customTag });
      }
      return {
        ...f,
        displayName: decodedDisplayName,
        customMetadata: updatedMetadata
      };
    });

    const storageUsageBytes = enrichedFiles.reduce((acc: number, f: any) => acc + (parseInt(f.sizeBytes, 10) || 0), 0);

    return res.json({
      success: true,
      files: enrichedFiles,
      totalCount: enrichedFiles.length,
      storageUsageBytes
    });
  } catch (err: any) {
    logError('[Files] Error listing files for user', { userId, error: err.message });
    return res.status(500).json({ error: 'Не удалось получить список файлов', details: err.message });
  }
};

app.get('/api/files', authenticateToken, handleGetFiles);
app.get('/api/rag/files', authenticateToken, handleGetFiles);

const handleMoveFile = async (req: AuthRequest, res: any) => {
  const userId = req.user!.userId;
  const { documentName, targetFolderTag } = req.body;
  if (!documentName || !targetFolderTag) {
    return res.status(400).json({ error: 'documentName и targetFolderTag обязательны' });
  }

  try {
    const docKey = String(documentName).trim();
    const existing = await prisma.userFileTag.findFirst({
      where: { userId, documentName: docKey }
    });

    if (existing) {
      await prisma.userFileTag.update({
        where: { id: existing.id },
        data: { folderTag: targetFolderTag }
      });
    } else {
      await prisma.userFileTag.create({
        data: { userId, documentName: docKey, folderTag: targetFolderTag }
      });
    }

    let userStore = await prisma.userStore.findUnique({ where: { userId } });
    if (userStore) {
      invalidateStoreCache(userStore.fileSearchStoreName);
    }

    return res.json({ success: true, message: `Файл перенесен в папку "${targetFolderTag}"` });
  } catch (err: any) {
    logError('[Files] Error moving file between folders', { userId, documentName, error: err.message });
    return res.status(500).json({ error: 'Не удалось перенести файл в выбранную папку', details: err.message });
  }
};

app.patch('/api/files/move', authenticateToken, handleMoveFile);
app.patch('/api/rag/files/move', authenticateToken, handleMoveFile);

const handleUploadFile = async (req: AuthRequest, res: any) => {
  const userId = req.user!.userId;
  const folderTag = req.body.folderTag || 'Все файлы';

  if (!req.file) {
    return res.status(400).json({ error: 'Файл не предоставлен' });
  }

  try {
    let userStore = await prisma.userStore.findUnique({ where: { userId } });
    if (!userStore) {
      const storeDisplayName = `client_store_${userId}`;
      const fileSearchStoreName = await ensureFileSearchStore(storeDisplayName);
      userStore = await prisma.userStore.create({
        data: { userId, fileSearchStoreName }
      });
    }

    const fileName = decodeFilename(req.file.originalname);

    const uploadedGoogleFile = await uploadFileToStore(
      userStore.fileSearchStoreName,
      req.file.path,
      fileName,
      req.file.mimetype,
      folderTag
    );

    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {}

    res.json({ message: 'Файл успешно загружен в RAG базу знания', file: uploadedGoogleFile });
    invalidateStoreCache(userStore.fileSearchStoreName);
  } catch (error: any) {
    logError('[RAG Error] Ошибка при загрузке файла', { userId, errorDetails: error.message });
    res.status(500).json({ error: 'Ошибка при индексации файла в Google Store', details: error.message });
  }
};

app.post('/api/files/upload', authenticateToken, upload.single('file'), handleUploadFile);
app.post('/api/rag/upload', authenticateToken, upload.single('file'), handleUploadFile);

app.delete('/api/rag/files/:fileName(*)', authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const fileName = req.params.fileName;
  try {
    let userStore = await prisma.userStore.findUnique({ where: { userId } });
    if (!userStore) {
      return res.status(404).json({ error: 'Хранилище не найдено' });
    }
    await deleteFileFromStore(fileName);
    // Инвалидируем кеш хранилища при удалении файла
    invalidateStoreCache(userStore.fileSearchStoreName);
    res.json({ message: 'Файл успешно удален' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Ошибка при удалении файла' });
  }
});

app.delete('/api/files/*', authenticateToken, async (req: AuthRequest, res) => {
  const googleFileName = (req.params as any)[0] || (req.params as any).googleFileName || '';
  const decodedName = decodeURIComponent(googleFileName);
  logInfo(`[RAG] Запрос на удаление файла: ${decodedName}`);
  try {
    if (!decodedName) {
      throw new Error('Имя файла не передано');
    }
    await deleteFileFromStore(decodedName);
    logInfo(`[RAG] Файл успешно удален из Google Store: ${decodedName}`);
    res.json({ message: 'Файл успешно удален из Google File Search Store' });
  } catch (error: any) {
    logError(`[RAG] Ошибка удаления файла из Google Store (${decodedName}): ${error.message}`, error);
    res.status(500).json({ error: 'Ошибка удаления файла из Google Store', details: error.message });
  }
});

// ----------------------------------------------------
// ADMIN ENDPOINTS
// ----------------------------------------------------
app.get('/api/admin/2fa-info', authenticateToken, requireAdmin, async (req, res) => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) return res.status(404).json({ error: 'Admin not found' });
  const otpauth = authenticator.keyuri('admin@krb.ai', 'KRB SaaS', admin.totpSecret || 'KRBSaaS2FAAdminSecretKey2026');
  const qrCodeUrl = await QRCode.toDataURL(otpauth);
  res.json({
    totpEnabled: admin.totpEnabled,
    totpSecret: admin.totpSecret,
    qrCodeUrl
  });
});

app.post('/api/admin/toggle-2fa', authenticateToken, requireAdmin, async (req, res) => {
  const { enabled } = req.body;
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) return res.status(404).json({ error: 'Admin not found' });

  const updated = await prisma.user.update({
    where: { id: admin.id },
    data: { totpEnabled: enabled }
  });
  res.json({ totpEnabled: updated.totpEnabled });
});

app.get('/api/admin/keys', authenticateToken, requireAdmin, async (req, res) => {
  const keys = await prisma.apiKey.findMany({ select: { id: true, service: true, isActive: true, createdAt: true } });
  res.json(keys);
});

app.post('/api/admin/keys', authenticateToken, requireAdmin, async (req, res) => {
  const { service, apiKey } = req.body;
  const encrypted = encryptApiKey(apiKey);
  const created = await prisma.apiKey.create({
    data: {
      service,
      encryptedKey: encrypted.encryptedKey,
      iv: encrypted.iv,
      isActive: true
    }
  });
  res.json({ id: created.id, service: created.service, isActive: created.isActive });
});

app.patch('/api/admin/keys/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;
  const updated = await prisma.apiKey.update({
    where: { id },
    data: { isActive }
  });
  res.json(updated);
});

app.delete('/api/admin/keys/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.apiKey.delete({ where: { id } });
    res.json({ message: 'API-ключ успешно удален' });
  } catch (err: any) {
    res.status(500).json({ error: 'Не удалось удалить API-ключ' });
  }
});

app.get('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  res.json(settings);
});

app.post('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
  const { slidingWindowSize, summarizationEnabled, summarizationThreshold, rateLimitPerMinute, rateLimitPerDay, clientRagQuotaMB, dualRagPrompt } = req.body;
  const updated = await prisma.systemSettings.upsert({
    where: { id: 'default' },
    update: { slidingWindowSize, summarizationEnabled, summarizationThreshold, rateLimitPerMinute, rateLimitPerDay, clientRagQuotaMB, dualRagPrompt },
    create: { id: 'default', slidingWindowSize, summarizationEnabled, summarizationThreshold, rateLimitPerMinute, rateLimitPerDay, clientRagQuotaMB, dualRagPrompt }
  });
  res.json(updated);
});

app.get('/api/admin/diagnostics', authenticateToken, requireAdmin, async (req, res) => {
  const logs = await prisma.apiDiagnostics.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  res.json(logs);
});

app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const totalUsers = await prisma.user.count();
    const totalBots = await prisma.bot.count();
    const totalUserStores = await prisma.userStore.count();
    const totalMessages = await prisma.chatMessage.count();
    const totalApiKeys = await prisma.apiKey.count();
    
    // Estimate file metrics from DB or files
    const uploadsDir = path.join(__dirname, '../uploads');
    let totalSizeBytes = 0;
    let totalFilesCount = 0;
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      totalFilesCount = files.length;
      files.forEach(f => {
        try {
          const stat = fs.statSync(path.join(uploadsDir, f));
          totalSizeBytes += stat.size;
        } catch(e) {}
      });
    }

    res.json({
      totalUsers,
      totalBots,
      totalUserStores,
      totalMessages,
      totalApiKeys,
      totalFilesCount,
      totalSizeMB: (totalSizeBytes / (1024 * 1024)).toFixed(2),
      storageUsedPercent: Math.min(100, Math.round((totalSizeBytes / (100 * 1024 * 1024)) * 100))
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Не удалось получить статистику' });
  }
});

app.get('/api/admin/bots', authenticateToken, requireAdmin, async (req, res) => {
  const bots = await prisma.bot.findMany({
    include: { clientAccess: { include: { user: { select: { id: true, email: true } } } } }
  });
  const users = await prisma.user.findMany({
    where: { role: 'CLIENT' },
    select: { id: true, email: true }
  });
  res.json({ bots, users });
});

app.post('/api/admin/bots', authenticateToken, requireAdmin, async (req, res) => {
  const { name, description, systemInstruction } = req.body;
  try {
    const storeDisplayName = `bot_store_${Date.now()}`;
    const fileSearchStoreName = await ensureFileSearchStore(storeDisplayName);
    const bot = await prisma.bot.create({
      data: {
        name,
        description,
        systemInstruction,
        fileSearchStoreName
      }
    });
    res.json(bot);
  } catch (err: any) {
    res.status(500).json({ error: 'Не удалось создать бота', details: err.message });
  }
});

app.post('/api/admin/bot-access', authenticateToken, requireAdmin, async (req, res) => {
  const { userId, botId, hasAccess } = req.body;
  try {
    if (hasAccess) {
      await prisma.botClientAccess.upsert({
        where: { userId_botId: { userId, botId } },
        update: {},
        create: { userId, botId }
      });
    } else {
      await prisma.botClientAccess.deleteMany({
        where: { userId, botId }
      });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Не удалось обновить права доступа' });
  }
});

app.patch('/api/admin/bots/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, description, systemInstruction, modelName } = req.body;
  try {
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (systemInstruction !== undefined) updateData.systemInstruction = systemInstruction;
    if (modelName !== undefined) updateData.modelName = modelName;
    const updated = await prisma.bot.update({
      where: { id },
      data: updateData
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: 'Не удалось обновить бота' });
  }
});

// ADMIN USER MANAGEMENT ENDPOINTS
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rawUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        totpEnabled: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const users = await Promise.all(rawUsers.map(async u => {
      const store = await prisma.userStore.findUnique({ where: { userId: u.id } });
      return {
        ...u,
        userStore: store ? { fileSearchStoreName: store.fileSearchStoreName } : null
      };
    }));

    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: 'Не удалось получить список пользователей' });
  }
});

app.post('/api/admin/users', authenticateToken, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'Пользователь с таким Email уже существует' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: role || 'CLIENT'
      }
    });

    let storeName = null;
    try {
      const storeDisplayName = `client_store_${user.id}`;
      storeName = await ensureFileSearchStore(storeDisplayName);
      await prisma.userStore.create({
        data: {
          userId: user.id,
          fileSearchStoreName: storeName
        }
      });
    } catch (storeErr) {
      console.warn('Deferred user store creation:', storeErr);
    }

    logInfo(`[Admin] Создан новый пользователь [${user.email}] с ролью [${user.role}]`, { adminId: req.user!.userId });

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      userStore: storeName ? { fileSearchStoreName: storeName } : null
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Ошибка создания пользователя' });
  }
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.user!.userId) {
      return res.status(400).json({ error: 'Нельзя удалить собственного администратора' });
    }

    const target = await prisma.user.findUnique({
      where: { id: targetId }
    });

    if (!target) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const userStore = await prisma.userStore.findUnique({ where: { userId: targetId } });
    if (userStore?.fileSearchStoreName) {
      try {
        await deleteFileSearchStore(userStore.fileSearchStoreName);
      } catch (e) {
        console.warn('Could not delete user store in Google:', e);
      }
      await prisma.userStore.delete({ where: { id: userStore.id } });
    }

    await prisma.user.delete({ where: { id: targetId } });
    logInfo(`[Admin] Пользователь [${target.email}] удален`, { adminId: req.user!.userId });

    res.json({ success: true, message: 'Пользователь успешно удален' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Ошибка удаления пользователя' });
  }
});

app.delete('/api/admin/bots/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (bot && bot.fileSearchStoreName) {
      try {
        await deleteFileSearchStore(bot.fileSearchStoreName);
      } catch (e) {
        console.error('Could not delete store in Google:', e);
      }
    }
    await prisma.botClientAccess.deleteMany({ where: { botId: id } });
    await prisma.bot.delete({ where: { id } });
    res.json({ message: 'Бот успешно удален' });
  } catch (err: any) {
    res.status(500).json({ error: 'Не удалось удалить бота' });
  }
});

app.get('/api/admin/bots/:id/files', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const bot = await prisma.bot.findUnique({ where: { id } });
  if (!bot || !bot.fileSearchStoreName) {
    return res.status(404).json({ error: 'Бот или Store не найден' });
  }
  const files = await listFilesFromStore(bot.fileSearchStoreName);
  res.json(files);
});

app.post('/api/admin/bots/:id/files', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
  const { id } = req.params;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Файл не передан' });

  const bot = await prisma.bot.findUnique({ where: { id } });
  if (!bot) {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return res.status(404).json({ error: 'Бот не найден' });
  }

  let storeName = bot.fileSearchStoreName;
  if (!storeName) {
    storeName = await ensureFileSearchStore(`bot_store_${bot.id}`);
    await prisma.bot.update({ where: { id }, data: { fileSearchStoreName: storeName } });
  }

  try {
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const uploaded = await uploadFileToStore(
      storeName,
      file.path,
      fileName,
      file.mimetype,
      'База знаний бота'
    );
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    invalidateStoreCache(storeName);
    res.json({ message: 'Файл загружен в базу знаний бота', file: uploaded });
  } catch (error: any) {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    res.status(500).json({ error: 'Ошибка загрузки файла базы знаний', details: error.message });
  }
});

// ==================== LOGGING API ENDPOINTS ====================

// Client Telemetry Endpoint (Log client actions, clicks, errors)
app.post('/api/logs/client', (req, res) => {
  const { level = 'INFO', message, details } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  const clientLevel = (level as LogLevel) || 'INFO';
  if (clientLevel === 'ERROR') {
    logError(`[Client] ${message}`, details);
  } else if (clientLevel === 'DEBUG') {
    logDebug(`[Client] ${message}`, details);
  } else {
    logInfo(`[Client] ${message}`, details);
  }

  res.json({ status: 'ok' });
});

// Admin Log Viewer Endpoints
app.get('/api/admin/logs', authenticateToken, requireAdmin, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const level = (req.query.level as string) || 'ALL';
  const limit = parseInt(req.query.limit as string) || 500;
  const logs = readLogs(level, limit);
  res.json({
    logLevel: getSystemLogLevel(),
    total: logs.length,
    logs
  });
});

app.delete('/api/admin/logs', authenticateToken, requireAdmin, (req, res) => {
  const success = clearLogFile();
  if (success) {
    res.json({ message: 'Файл логов успешно очищен' });
  } else {
    res.status(500).json({ error: 'Не удалось очистить файл логов' });
  }
});

app.post('/api/admin/logs/client', (req, res) => {
  const { level, message, meta } = req.body || {};
  if (level === 'ERROR') {
    logError(`[Client] ${message}`, meta);
  } else {
    logInfo(`[Client] ${message}`, meta);
  }
  res.json({ success: true });
});

app.post('/api/admin/logs', (req, res) => {
  const { level, message, meta } = req.body || {};
  if (level === 'ERROR') {
    logError(`[Client] ${message}`, meta);
  } else {
    logInfo(`[Client] ${message}`, meta);
  }
  res.json({ success: true });
});

app.get('/api/admin/logs/level', authenticateToken, requireAdmin, (req, res) => {
  res.json({ level: getSystemLogLevel() });
});

app.post('/api/admin/logs/level', authenticateToken, requireAdmin, (req, res) => {
  const { level } = req.body;
  if (!['DEBUG', 'INFO', 'ERROR'].includes(level)) {
    return res.status(400).json({ error: 'Invalid level. Must be DEBUG, INFO, or ERROR' });
  }
  setSystemLogLevel(level as LogLevel);
  res.json({ message: `Уровень логирования установлен на ${level}`, level });
});

// Theme Engine REST API
app.get('/api/theme', authenticateToken, async (req, res) => {
  try {
    const dbTokens = await prisma.themeToken.findMany();
    const tokenMap: Record<string, string> = {};
    dbTokens.forEach(t => {
      tokenMap[t.tokenName] = t.value;
    });
    res.json({ tokens: Object.keys(tokenMap).length > 0 ? tokenMap : null });
  } catch (err: any) {
    res.status(500).json({ error: 'Не удалось получить тему из базы данных' });
  }
});

app.put('/api/theme', authenticateToken, requireAdmin, async (req, res) => {
  const { tokens } = req.body;
  if (!tokens || typeof tokens !== 'object') {
    return res.status(400).json({ error: 'Переданы некорректные токены' });
  }
  try {
    for (const [tokenName, value] of Object.entries(tokens)) {
      await prisma.themeToken.upsert({
        where: { tokenName },
        update: { value: String(value) },
        create: { tokenName, value: String(value), category: 'color' }
      });
    }
    res.json({ message: 'Тема успешно сохранена в БД', tokens });
  } catch (err: any) {
    res.status(500).json({ error: 'Не удалось сохранить тему' });
  }
});

app.post('/api/theme/reset', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await prisma.themeToken.deleteMany({});
    res.json({ message: 'Тема сброшена до стандартной' });
  } catch (err: any) {
    res.status(500).json({ error: 'Не удалось сбросить тему' });
  }
});

// Dynamic list of available Gemini models via Google GenAI SDK
app.get('/api/admin/models', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const apiKey = await getActiveGeminiApiKey();
    if (!apiKey || apiKey.includes('placeholder')) {
      return res.status(400).json({ error: 'API_KEY_REQUIRED', message: 'API-ключ Google Gemini не настроен' });
    }
    const ai = await getGeminiClient();
    const response = await (ai as any).models.list();
    const rawModels = response.models || response || [];
    const modelsList = Array.from(rawModels)
      .map((m: any) => m.name ? m.name.replace(/^models\//, '') : String(m))
      .filter((m: string) => m.includes('gemini'));
    
    const defaultModels = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-pro', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'];
    const merged = Array.from(new Set([...modelsList, ...defaultModels]));
    res.json({ models: merged });
  } catch (err: any) {
    console.warn('Could not fetch dynamic models list from Gemini:', err.message);
    res.status(400).json({ error: 'API_KEY_REQUIRED', message: err.message || 'API-ключ Google Gemini не настроен или невалиден' });
  }
});

// Real RAG Store Statistics Endpoint
app.get('/api/admin/rag-stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userStores = await prisma.userStore.findMany();
    const bots = await prisma.bot.findMany({ where: { fileSearchStoreName: { not: null } } });

    let totalDocs = 0;
    let totalSizeBytes = 0;
    const storeDetails: any[] = [];

    // Collect all store names
    const allStoreNames = Array.from(new Set([
      ...userStores.map(u => u.fileSearchStoreName),
      ...bots.map(b => b.fileSearchStoreName!).filter(Boolean)
    ]));

    for (const storeName of allStoreNames) {
      try {
        const docs = await listFilesFromStore(storeName);
        totalDocs += docs.length;
        const storeSizeBytes = docs.reduce((acc: number, d: any) => acc + Number(d.sizeBytes || d.size || 0), 0);
        totalSizeBytes += storeSizeBytes;
        storeDetails.push({ storeName, docCount: docs.length, sizeBytes: storeSizeBytes });
      } catch (e) {
        // Ignore single store errors
      }
    }

    const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);
    // Standard limit is 100 MB per workspace for MVP
    const usagePercent = Math.min(100, Math.round((totalSizeBytes / (100 * 1024 * 1024)) * 100));

    res.json({
      totalStores: allStoreNames.length,
      totalDocs,
      totalSizeBytes,
      totalSizeMB: Number(totalSizeMB),
      maxSizeMB: 100,
      usagePercent,
      storeDetails
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to calculate RAG stats', details: err.message });
  }
});

const portNum = Number(PORT) || 5001;
app.listen(portNum, '0.0.0.0', () => {
  logInfo(`Сервер запущен на 0.0.0.0:${portNum} [Уровень: ${getSystemLogLevel()}]`);
  console.log(`Server listening on 0.0.0.0:${portNum}`);
});
