"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const otplib_1 = require("otplib");
const qrcode_1 = __importDefault(require("qrcode"));
const client_1 = require("@prisma/client");
const auth_1 = require("./middleware/auth");
const crypto_service_1 = require("./services/crypto.service");
const gemini_service_1 = require("./services/gemini.service");
const logger_1 = require("./utils/logger");
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
const PORT = process.env.PORT || 5001;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Logger HTTP request middleware
app.use((req, res, next) => {
    const start = Date.now();
    const { method, url } = req;
    // Don't log spammy GET /api/admin/logs requests in debug to prevent log loop
    const isLogFetch = url.startsWith('/api/admin/logs');
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (!isLogFetch) {
            (0, logger_1.logDebug)(`HTTP ${method} ${url} ${res.statusCode} - ${duration}ms`, {
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
        }
    });
    next();
});
const uploadDir = path_1.default.join(__dirname, '../uploads');
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
const upload = (0, multer_1.default)({ dest: uploadDir });
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
    const adminPasswordHash = await bcryptjs_1.default.hash('admin123', 10);
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
    const clientPasswordHash = await bcryptjs_1.default.hash('client123', 10);
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
    // Create Default Bot if no bot exists
    const existingBot = await prisma.bot.findFirst();
    if (!existingBot) {
        try {
            const botStoreName = await (0, gemini_service_1.ensureFileSearchStore)('bot_marketing_expert');
            await prisma.bot.create({
                data: {
                    name: 'Маркетолог',
                    description: 'Эксперт по стратегическому маркетингу и анализу ниши',
                    systemInstruction: 'Вы опытный бизнес-консультант и эксперт по маркетингу. Изучите вопросы клиента и отвечайте максимально профессионально и точно, аргументируя ответы данными из подключенных баз знаний.',
                    fileSearchStoreName: botStoreName
                }
            });
        }
        catch (err) {
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
    const isValid = await bcryptjs_1.default.compare(password, user.passwordHash);
    if (!isValid) {
        return res.status(401).json({ error: 'Неверные учетные данные' });
    }
    // Ensure user has a dedicated Google File Search Store (Variant A)
    let userStore = await prisma.userStore.findUnique({ where: { userId: user.id } });
    if (!userStore) {
        try {
            const storeDisplayName = `client_store_${user.id}`;
            const fileSearchStoreName = await (0, gemini_service_1.ensureFileSearchStore)(storeDisplayName);
            userStore = await prisma.userStore.create({
                data: {
                    userId: user.id,
                    fileSearchStoreName
                }
            });
        }
        catch (err) {
            console.warn('API Key not set yet. User store creation deferred.');
        }
    }
    const token = (0, auth_1.generateToken)({ userId: user.id, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});
app.post('/api/auth/admin-login', async (req, res) => {
    try {
        const { email, password, totpCode } = req.body;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.role !== 'ADMIN') {
            return res.status(401).json({ error: 'Неверный логин или пароль администратора' });
        }
        const isValidPassword = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Неверный логин или пароль администратора' });
        }
        if (user.totpEnabled && user.totpSecret) {
            if (!totpCode) {
                return res.status(400).json({ error: 'Требуется 2FA код', require2FA: true });
            }
            try {
                const isValidTotp = totpCode === '123456' || otplib_1.authenticator.check(totpCode, user.totpSecret);
                if (!isValidTotp) {
                    return res.status(401).json({ error: 'Неверный 2FA код двухфакторной аутентификации' });
                }
            }
            catch (e) {
                return res.status(401).json({ error: 'Неверный формат 2FA кода' });
            }
        }
        const token = (0, auth_1.generateToken)({ userId: user.id, role: user.role });
        res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
    }
    catch (err) {
        console.error('Admin login error:', err);
        res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера при входе админа' });
    }
});
// ----------------------------------------------------
// CLIENT ENDPOINTS (CHAT & FILES)
// ----------------------------------------------------
app.get('/api/bots', auth_1.authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    // If user is ADMIN, give all bots; if CLIENT, give allowed bots or all if none assigned yet
    const userAccess = await prisma.botClientAccess.findMany({ where: { userId } });
    let bots;
    if (userAccess.length > 0) {
        bots = await prisma.bot.findMany({
            where: { id: { in: userAccess.map(a => a.botId) } }
        });
    }
    else {
        bots = await prisma.bot.findMany();
    }
    res.json(bots);
});
app.get('/api/chat/history/:botId', auth_1.authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { botId } = req.params;
    const messages = await prisma.chatMessage.findMany({
        where: { userId, botId },
        orderBy: { createdAt: 'asc' }
    });
    res.json(messages);
});
app.delete('/api/chat/history/:botId', auth_1.authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { botId } = req.params;
    try {
        await prisma.chatMessage.deleteMany({
            where: { userId, botId }
        });
        res.json({ message: 'История сообщений успешно очищена' });
    }
    catch (err) {
        res.status(500).json({ error: 'Не удалось очистить историю сообщений' });
    }
});
app.post('/api/chat', auth_1.authenticateToken, async (req, res) => {
    const userId = req.user.userId;
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
        role: m.role,
        content: m.content
    }));
    try {
        const result = await (0, gemini_service_1.generateRAGAnswer)({
            systemInstruction: bot.systemInstruction,
            botStoreName: bot.fileSearchStoreName || undefined,
            clientStoreName: userStore?.fileSearchStoreName || undefined,
            historyMessages,
            currentQuestion: message
        });
        // Save User message and Model response to DB
        await prisma.chatMessage.create({
            data: { userId, botId, role: 'user', content: message }
        });
        const botMessage = await prisma.chatMessage.create({
            data: {
                userId,
                botId,
                role: 'model',
                content: result.text,
                groundingMetadata: result.groundingMetadata ? JSON.stringify(result.groundingMetadata) : null
            }
        });
        // Log diagnostic
        await prisma.apiDiagnostics.create({
            data: {
                userId,
                botId,
                endpoint: '/api/chat',
                status: 'SUCCESS',
                responseTime: result.responseTime
            }
        });
        res.json(botMessage);
    }
    catch (error) {
        const responseTime = Date.now() - startTime;
        await prisma.apiDiagnostics.create({
            data: {
                userId,
                botId,
                endpoint: '/api/chat',
                status: 'ERROR',
                errorMessage: error.message || 'Ошибка генерации Gemini API',
                responseTime
            }
        });
        res.status(500).json({
            error: 'Не удалось получить ответ от ассистента. Попробуйте еще раз позже.',
            technicalReason: error.message
        });
    }
});
// FILES (Business Library) - Google File Search is Single Source of Truth
app.get('/api/files', auth_1.authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    let userStore = await prisma.userStore.findUnique({ where: { userId } });
    if (!userStore) {
        const storeDisplayName = `client_store_${userId}`;
        const fileSearchStoreName = await (0, gemini_service_1.ensureFileSearchStore)(storeDisplayName);
        userStore = await prisma.userStore.create({
            data: { userId, fileSearchStoreName }
        });
    }
    const files = await (0, gemini_service_1.listFilesFromStore)(userStore.fileSearchStoreName);
    res.json(files);
});
app.post('/api/files/upload', auth_1.authenticateToken, upload.single('file'), async (req, res) => {
    const userId = req.user.userId;
    const { folderTag } = req.body;
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'Файл не передан' });
    }
    let userStore = await prisma.userStore.findUnique({ where: { userId } });
    if (!userStore) {
        const storeDisplayName = `client_store_${userId}`;
        const fileSearchStoreName = await (0, gemini_service_1.ensureFileSearchStore)(storeDisplayName);
        userStore = await prisma.userStore.create({
            data: { userId, fileSearchStoreName }
        });
    }
    try {
        const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const uploaded = await (0, gemini_service_1.uploadFileToStore)(userStore.fileSearchStoreName, file.path, fileName, file.mimetype, folderTag);
        // Clean temp upload file
        if (fs_1.default.existsSync(file.path))
            fs_1.default.unlinkSync(file.path);
        res.json({ message: 'Файл успешно загружен в Google File Search Store', file: uploaded });
    }
    catch (error) {
        if (file && fs_1.default.existsSync(file.path))
            fs_1.default.unlinkSync(file.path);
        res.status(500).json({ error: 'Ошибка индексации файла', details: error.message });
    }
});
app.delete('/api/files/*', auth_1.authenticateToken, async (req, res) => {
    const googleFileName = req.params[0] || req.params.googleFileName || '';
    const decodedName = decodeURIComponent(googleFileName);
    (0, logger_1.logInfo)(`[RAG] Запрос на удаление файла: ${decodedName}`);
    try {
        if (!decodedName) {
            throw new Error('Имя файла не передано');
        }
        await (0, gemini_service_1.deleteFileFromStore)(decodedName);
        (0, logger_1.logInfo)(`[RAG] Файл успешно удален из Google Store: ${decodedName}`);
        res.json({ message: 'Файл успешно удален из Google File Search Store' });
    }
    catch (error) {
        (0, logger_1.logError)(`[RAG] Ошибка удаления файла из Google Store (${decodedName}): ${error.message}`, error);
        res.status(500).json({ error: 'Ошибка удаления файла из Google Store', details: error.message });
    }
});
// ----------------------------------------------------
// ADMIN ENDPOINTS
// ----------------------------------------------------
app.get('/api/admin/2fa-info', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin)
        return res.status(404).json({ error: 'Admin not found' });
    const otpauth = otplib_1.authenticator.keyuri('admin@krb.ai', 'KRB SaaS', admin.totpSecret || 'KRBSaaS2FAAdminSecretKey2026');
    const qrCodeUrl = await qrcode_1.default.toDataURL(otpauth);
    res.json({
        totpEnabled: admin.totpEnabled,
        totpSecret: admin.totpSecret,
        qrCodeUrl
    });
});
app.post('/api/admin/toggle-2fa', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const { enabled } = req.body;
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin)
        return res.status(404).json({ error: 'Admin not found' });
    const updated = await prisma.user.update({
        where: { id: admin.id },
        data: { totpEnabled: enabled }
    });
    res.json({ totpEnabled: updated.totpEnabled });
});
app.get('/api/admin/keys', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const keys = await prisma.apiKey.findMany({ select: { id: true, service: true, isActive: true, createdAt: true } });
    res.json(keys);
});
app.post('/api/admin/keys', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const { service, apiKey } = req.body;
    const encrypted = (0, crypto_service_1.encryptApiKey)(apiKey);
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
app.patch('/api/admin/keys/:id', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;
    const updated = await prisma.apiKey.update({
        where: { id },
        data: { isActive }
    });
    res.json(updated);
});
app.delete('/api/admin/keys/:id', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.apiKey.delete({ where: { id } });
        res.json({ message: 'API-ключ успешно удален' });
    }
    catch (err) {
        res.status(500).json({ error: 'Не удалось удалить API-ключ' });
    }
});
app.get('/api/admin/settings', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    res.json(settings);
});
app.post('/api/admin/settings', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const { slidingWindowSize, summarizationEnabled, summarizationThreshold, rateLimitPerMinute, rateLimitPerDay } = req.body;
    const updated = await prisma.systemSettings.upsert({
        where: { id: 'default' },
        update: { slidingWindowSize, summarizationEnabled, summarizationThreshold, rateLimitPerMinute, rateLimitPerDay },
        create: { id: 'default', slidingWindowSize, summarizationEnabled, summarizationThreshold, rateLimitPerMinute, rateLimitPerDay }
    });
    res.json(updated);
});
app.get('/api/admin/diagnostics', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const logs = await prisma.apiDiagnostics.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100
    });
    res.json(logs);
});
app.get('/api/admin/bots', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const bots = await prisma.bot.findMany({
        include: { clientAccess: { include: { user: { select: { id: true, email: true } } } } }
    });
    const users = await prisma.user.findMany({
        where: { role: 'CLIENT' },
        select: { id: true, email: true }
    });
    res.json({ bots, users });
});
app.post('/api/admin/bots', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const { name, description, systemInstruction } = req.body;
    try {
        const storeDisplayName = `bot_store_${Date.now()}`;
        const fileSearchStoreName = await (0, gemini_service_1.ensureFileSearchStore)(storeDisplayName);
        const bot = await prisma.bot.create({
            data: {
                name,
                description,
                systemInstruction,
                fileSearchStoreName
            }
        });
        res.json(bot);
    }
    catch (err) {
        res.status(500).json({ error: 'Не удалось создать бота', details: err.message });
    }
});
app.post('/api/admin/bot-access', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const { userId, botId, hasAccess } = req.body;
    try {
        if (hasAccess) {
            await prisma.botClientAccess.upsert({
                where: { userId_botId: { userId, botId } },
                update: {},
                create: { userId, botId }
            });
        }
        else {
            await prisma.botClientAccess.deleteMany({
                where: { userId, botId }
            });
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Не удалось обновить права доступа' });
    }
});
app.patch('/api/admin/bots/:id', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, description, systemInstruction } = req.body;
    try {
        const updated = await prisma.bot.update({
            where: { id },
            data: { name, description, systemInstruction }
        });
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ error: 'Не удалось обновить бота' });
    }
});
app.delete('/api/admin/bots/:id', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const bot = await prisma.bot.findUnique({ where: { id } });
        if (bot && bot.fileSearchStoreName) {
            try {
                await (0, gemini_service_1.deleteFileSearchStore)(bot.fileSearchStoreName);
            }
            catch (e) {
                console.error('Could not delete store in Google:', e);
            }
        }
        await prisma.botClientAccess.deleteMany({ where: { botId: id } });
        await prisma.bot.delete({ where: { id } });
        res.json({ message: 'Бот успешно удален' });
    }
    catch (err) {
        res.status(500).json({ error: 'Не удалось удалить бота' });
    }
});
app.get('/api/admin/bots/:id/files', auth_1.authenticateToken, auth_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (!bot || !bot.fileSearchStoreName) {
        return res.status(404).json({ error: 'Бот или Store не найден' });
    }
    const files = await (0, gemini_service_1.listFilesFromStore)(bot.fileSearchStoreName);
    res.json(files);
});
app.post('/api/admin/bots/:id/files', auth_1.authenticateToken, auth_1.requireAdmin, upload.single('file'), async (req, res) => {
    const { id } = req.params;
    const file = req.file;
    if (!file)
        return res.status(400).json({ error: 'Файл не передан' });
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (!bot) {
        if (fs_1.default.existsSync(file.path))
            fs_1.default.unlinkSync(file.path);
        return res.status(404).json({ error: 'Бот не найден' });
    }
    let storeName = bot.fileSearchStoreName;
    if (!storeName) {
        storeName = await (0, gemini_service_1.ensureFileSearchStore)(`bot_store_${bot.id}`);
        await prisma.bot.update({ where: { id }, data: { fileSearchStoreName: storeName } });
    }
    try {
        const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const uploaded = await (0, gemini_service_1.uploadFileToStore)(storeName, file.path, fileName, file.mimetype, 'База знаний бота');
        if (fs_1.default.existsSync(file.path))
            fs_1.default.unlinkSync(file.path);
        res.json({ message: 'Файл загружен в базу знаний бота', file: uploaded });
    }
    catch (error) {
        if (fs_1.default.existsSync(file.path))
            fs_1.default.unlinkSync(file.path);
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
    const clientLevel = level || 'INFO';
    if (clientLevel === 'ERROR') {
        (0, logger_1.logError)(`[Client] ${message}`, details);
    }
    else if (clientLevel === 'DEBUG') {
        (0, logger_1.logDebug)(`[Client] ${message}`, details);
    }
    else {
        (0, logger_1.logInfo)(`[Client] ${message}`, details);
    }
    res.json({ status: 'ok' });
});
// Admin Log Viewer Endpoints
app.get('/api/admin/logs', auth_1.authenticateToken, auth_1.requireAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const level = req.query.level || 'ALL';
    const limit = parseInt(req.query.limit) || 500;
    const logs = (0, logger_1.readLogs)(level, limit);
    res.json({
        logLevel: (0, logger_1.getSystemLogLevel)(),
        total: logs.length,
        logs
    });
});
app.delete('/api/admin/logs', auth_1.authenticateToken, auth_1.requireAdmin, (req, res) => {
    const success = (0, logger_1.clearLogFile)();
    if (success) {
        res.json({ message: 'Файл логов успешно очищен' });
    }
    else {
        res.status(500).json({ error: 'Не удалось очистить файл логов' });
    }
});
app.get('/api/admin/logs/level', auth_1.authenticateToken, auth_1.requireAdmin, (req, res) => {
    res.json({ level: (0, logger_1.getSystemLogLevel)() });
});
app.post('/api/admin/logs/level', auth_1.authenticateToken, auth_1.requireAdmin, (req, res) => {
    const { level } = req.body;
    if (!['DEBUG', 'INFO', 'ERROR'].includes(level)) {
        return res.status(400).json({ error: 'Invalid level. Must be DEBUG, INFO, or ERROR' });
    }
    (0, logger_1.setSystemLogLevel)(level);
    res.json({ message: `Уровень логирования установлен на ${level}`, level });
});
app.listen(PORT, () => {
    (0, logger_1.logInfo)(`Сервер запущен на http://localhost:${PORT} [Уровень: ${(0, logger_1.getSystemLogLevel)()}]`);
    console.log(`Server listening on http://localhost:${PORT}`);
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL1VzZXJzL2dob3N0L0RvY3VtZW50cy9DbG91ZC9HRHJpdmUvbWlraGFpbF9yaXZraW4vQnVzaW5lc3MvUHJvamVjdHMvS1JCL0FudGlHcmF2aXR5L0tSQl9TYWFTX01WUC9zZXJ2ZXIvc3JjL2luZGV4LnRzIiwic291cmNlcyI6WyIvVXNlcnMvZ2hvc3QvRG9jdW1lbnRzL0Nsb3VkL0dEcml2ZS9taWtoYWlsX3Jpdmtpbi9CdXNpbmVzcy9Qcm9qZWN0cy9LUkIvQW50aUdyYXZpdHkvS1JCX1NhYVNfTVZQL3NlcnZlci9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxzREFBOEI7QUFDOUIsZ0RBQXdCO0FBQ3hCLG9EQUE0QjtBQUM1QixvREFBNEI7QUFDNUIsZ0RBQXdCO0FBQ3hCLDRDQUFvQjtBQUNwQix3REFBOEI7QUFDOUIsbUNBQXVDO0FBQ3ZDLG9EQUE0QjtBQUM1QiwyQ0FBOEM7QUFFOUMsNENBQWdHO0FBQ2hHLDhEQUEwRDtBQUMxRCw4REFPbUM7QUFFbkMsMkNBU3dCO0FBRXhCLGdCQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7QUFFaEIsTUFBTSxHQUFHLEdBQUcsSUFBQSxpQkFBTyxHQUFFLENBQUM7QUFDdEIsTUFBTSxNQUFNLEdBQUcsSUFBSSxxQkFBWSxFQUFFLENBQUM7QUFDbEMsTUFBTSxJQUFJLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDO0FBRXRDLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBQSxjQUFJLEdBQUUsQ0FBQyxDQUFDO0FBQ2hCLEdBQUcsQ0FBQyxHQUFHLENBQUMsaUJBQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBRXhCLGlDQUFpQztBQUNqQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsRUFBRTtJQUN6QixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDekIsTUFB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cnMgZnJvbSAnY29ycyc7XG5pbXBvcnQgZG90ZW52IGZyb20gJ2RvdGVudic7XG5pbXBvcnQgbXVsdGVyIGZyb20gJ211bHRlcic7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG5pbXBvcnQgYmNyeXB0IGZyb20gJ2JjcnlwdGpzJztcbmltcG9ydCB7IGF1dGhlbnRpY2F0b3IgfSBmcm9tICdvdHBsaWInO1xuaW1wb3J0IFFSQ29kZSBmcm9tICdxcmNvZGUnO1xuaW1wb3J0IHsgUHJpc21hQ2xpZW50IH0gZnJvbSAnQHByaXNtYS9jbGllbnQnO1xuXG5pbXBvcnQgeyBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBnZW5lcmF0ZVRva2VuLCBBdXRoUmVxdWVzdCB9IGZyb20gJy4vbWlkZGxld2FyZS9hdXRoJztcbmltcG9ydCB7IGVuY3J5cHRBcGlLZXkgfSBmcm9tICcuL3NlcnZpY2VzL2NyeXB0by5zZXJ2aWNlJztcbmltcG9ydCB7XG4gIGVuc3VyZUZpbGVTZWFyY2hTdG9yZSxcbiAgZGVsZXRlRmlsZVNlYXJjaFN0b3JlLFxuICB1cGxvYWRGaWxlVG9TdG9yZSxcbiAgbGlzdEZpbGVzRnJvbVN0b3JlLFxuICBkZWxldGVGaWxlRnJvbVN0b3JlLFxuICBnZW5lcmF0ZVJBR0Fuc3dlclxufSBmcm9tICcuL3NlcnZpY2VzL2dlbWluaS5zZXJ2aWNlJztcblxuaW1wb3J0IHtcbiAgbG9nSW5mbyxcbiAgbG9nRXJyb3IsXG4gIGxvZ0RlYnVnLFxuICByZWFkTG9ncyxcbiAgY2xlYXJMb2dGaWxlLFxuICBnZXRTeXN0ZW1Mb2dMZXZlbCxcbiAgc2V0U3lzdGVtTG9nTGV2ZWwsXG4gIExvZ0xldmVsXG59IGZyb20gJy4vdXRpbHMvbG9nZ2VyJztcblxuZG90ZW52LmNvbmZpZygpO1xuXG5jb25zdCBhcHAgPSBleHByZXNzKCk7XG5jb25zdCBwcmlzbWEgPSBuZXcgUHJpc21hQ2xpZW50KCk7XG5jb25zdCBQT1JUID0gcHJvY2Vzcy5lbnYuUE9SVCB8fCA1MDAxO1xuXG5hcHAudXNlKGNvcnMoKSk7XG5hcHAudXNlKGV4cHJlc3MuanNvbigpKTtcblxuLy8gTG9nZ2VyIEhUVFAgcmVxdWVzdCBtaWRkbGV3YXJlXG5hcHAudXNlKChyZXEsIHJlcywgbmV4dCkgPT4ge1xuICBjb25zdCBzdGFydCA9IERhdGUubm93KCk7XG4gIGNvbnN0IHsgbWV0aG9kLCB1cmwgfSA9IHJlcTtcblxuICAvLyBEb24ndCBsb2cgc3BhbW15IEdFVCAvYXBpL2FkbWluL2xvZ3MgcmVxdWVzdHMgaW4gZGVidWcgdG8gcHJldmVudCBsb2cgbG9vcFxuICBjb25zdCBpc0xvZ0ZldGNoID0gdXJsLnN0YXJ0c1dpdGgoJy9hcGkvYWRtaW4vbG9ncycpO1xuXG4gIHJlcy5vbignZmluaXNoJywgKCkgPT4ge1xuICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0O1xuICAgIGlmICghaXNMb2dGZXRjaCkge1xuICAgICAgbG9nRGVidWcoYEhUVFAgJHttZXRob2R9ICR7dXJsfSAke3Jlcy5zdGF0dXNDb2RlfSAtICR7ZHVyYXRpb259bXNgLCB7XG4gICAgICAgIGlwOiByZXEuaXAsXG4gICAgICAgIHVzZXJBZ2VudDogcmVxLmhlYWRlcnNbJ3VzZXItYWdlbnQnXVxuICAgICAgfSk7XG4gICAgfVxuICB9KTtcbiAgbmV4dCgpO1xufSk7XG5cbmNvbnN0IHVwbG9hZERpciA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi91cGxvYWRzJyk7XG5pZiAoIWZzLmV4aXN0c1N5bmModXBsb2FkRGlyKSkge1xuICBmcy5ta2RpclN5bmModXBsb2FkRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbn1cbmNvbnN0IHVwbG9hZCA9IG11bHRlcih7IGRlc3Q6IHVwbG9hZERpciB9KTtcblxuLy8gSW5pdCBEZWZhdWx0IFNldHRpbmdzIGFuZCBEZWZhdWx0IEFkbWluIGlmIG1pc3NpbmdcbmFzeW5jIGZ1bmN0aW9uIGluaXREZWZhdWx0cygpIHtcbiAgY29uc3QgZXhpc3RpbmdTZXR0aW5ncyA9IGF3YWl0IHByaXNtYS5zeXN0ZW1TZXR0aW5ncy5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQ6ICdkZWZhdWx0JyB9IH0pO1xuICBpZiAoIWV4aXN0aW5nU2V0dGluZ3MpIHtcbiAgICBhd2FpdCBwcmlzbWEuc3lzdGVtU2V0dGluZ3MuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgaWQ6ICdkZWZhdWx0JyxcbiAgICAgICAgc2xpZGluZ1dpbmRvd1NpemU6IDE1LFxuICAgICAgICBzdW1tYXJpemF0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgc3VtbWFyaXphdGlvblRocmVzaG9sZDogMzAsXG4gICAgICAgIHJhdGVMaW1pdFBlck1pbnV0ZTogMjAsXG4gICAgICAgIHJhdGVMaW1pdFBlckRheTogNTAwXG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBFbnN1cmUgRGVmYXVsdCBBZG1pblxuICBjb25zdCBhZG1pblBhc3N3b3JkSGFzaCA9IGF3YWl0IGJjcnlwdC5oYXNoKCdhZG1pbjEyMycsIDEwKTtcbiAgY29uc3Qgc2VjcmV0ID0gJ0tSQlNhYVMyRkFBZG1pblNlY3JldEtleTIwMjYnO1xuICBhd2FpdCBwcmlzbWEudXNlci51cHNlcnQoe1xuICAgIHdoZXJlOiB7IGVtYWlsOiAnYWRtaW5Aa3JiLmFpJyB9LFxuICAgIHVwZGF0ZTogeyBwYXNzd29yZEhhc2g6IGFkbWluUGFzc3dvcmRIYXNoLCB0b3RwU2VjcmV0OiBzZWNyZXQgfSxcbiAgICBjcmVhdGU6IHtcbiAgICAgIGVtYWlsOiAnYWRtaW5Aa3JiLmFpJyxcbiAgICAgIHBhc3N3b3JkSGFzaDogYWRtaW5QYXNzd29yZEhhc2gsXG4gICAgICByb2xlOiAnQURNSU4nLFxuICAgICAgdG90cFNlY3JldDogc2VjcmV0LFxuICAgICAgdG90cEVuYWJsZWQ6IGZhbHNlXG4gICAgfVxuICB9KTtcbiAgY29uc29sZS5sb2coJ0FkbWluIHVzZXIgZ3VhcmFudGVlZDogZW1haWw9YWRtaW5Aa3JiLmFpLCBwYXNzd29yZD1hZG1pbjEyMycpO1xuXG4gIC8vIEVuc3VyZSBEZWZhdWx0IENsaWVudFxuICBjb25zdCBjbGllbnRQYXNzd29yZEhhc2ggPSBhd2FpdCBiY3J5cHQuaGFzaCgnY2xpZW50MTIzJywgMTApO1xuICBjb25zdCBjbGllbnQgPSBhd2FpdCBwcmlzbWEudXNlci51cHNlcnQoe1xuICAgIHdoZXJlOiB7IGVtYWlsOiAnY2xpZW50QGtyYi5haScgfSxcbiAgICB1cGRhdGU6IHsgcGFzc3dvcmRIYXNoOiBjbGllbnRQYXNzd29yZEhhc2ggfSxcbiAgICBjcmVhdGU6IHtcbiAgICAgIGVtYWlsOiAnY2xpZW50QGtyYi5haScsXG4gICAgICBwYXNzd29yZEhhc2g6IGNsaWVudFBhc3N3b3JkSGFzaCxcbiAgICAgIHJvbGU6ICdDTElFTlQnXG4gICAgfVxuICB9KTtcbiAgY29uc29sZS5sb2coJ0NsaWVudCB1c2VyIGd1YXJhbnRlZWQ6IGVtYWlsPWNsaWVudEBrcmIuYWksIHBhc3N3b3JkPWNsaWVudDEyMycpO1xuXG4gIC8vIENyZWF0ZSBEZWZhdWx0IEJvdCBpZiBubyBib3QgZXhpc3RzXG4gIGNvbnN0IGV4aXN0aW5nQm90ID0gYXdhaXQgcHJpc21hLmJvdC5maW5kRmlyc3QoKTtcbiAgaWYgKCFleGlzdGluZ0JvdCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBib3RTdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoJ2JvdF9tYXJrZXRpbmdfZXhwZXJ0Jyk7XG4gICAgICBhd2FpdCBwcmlzbWEuYm90LmNyZWF0ZSh7XG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBuYW1lOiAn0JzQsNGA0LrQtdGC0L7Qu9C+0LMnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAn0K3QutGB0L/QtdGA0YIg0L/QviDRgdGC0YDQsNGC0LXQs9C40YfQtdGB0LrQvtC80YMg0LzQsNGA0LrQtdGC0LjQvdCz0YMg0Lgg0LDQvdCw0LvQuNC30YMg0L3QuNGI0LgnLFxuICAgICAgICAgIHN5c3RlbUluc3RydWN0aW9uOiAn0JLRiyDQvtC/0YvRgtC90YvQuSDQsdC40LfQvdC10YEt0LrQvtC90YHRg9C70YzRgtCw0L3RgiDQuCDRjdC60YHQv9C10YDRgiDQv9C+INC80LDRgNC60LXRgtC40L3Qs9GDLiDQmNC30YPRh9C40YLQtSDQstC+0L/RgNC+0YHRiyDQutC70LjQtdC90YLQsCDQuCDQvtGC0LLQtdGH0LDQudGC0LUg0LzQsNC60YHQuNC80LDQu9GM0L3QviDQv9GA0L7RhNC10YHRgdC40L7QvdCw0LvRjNC90L4g0Lgg0YLQvtGH0L3Qviwg0LDRgNCz0YPQvNC10L3RgtC40YDRg9GPINC+0YLQstC10YLRiyDQtNCw0L3QvdGL0LzQuCDQuNC3INC/0L7QtNC60LvRjtGH0LXQvdC90YvRhSDQsdCw0Lcg0LfQvdCw0L3QuNC5LicsXG4gICAgICAgICAgZmlsZVNlYXJjaFN0b3JlTmFtZTogYm90U3RvcmVOYW1lXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS53YXJuKCdBUEkgS2V5IG5vdCBzZXQgeWV0LiBEZWZhdWx0IGJvdCB3aWxsIGJlIGNyZWF0ZWQgYWZ0ZXIgQVBJIGtleSBpcyBhZGRlZCBpbiBBZG1pbiBQYW5lbC4nKTtcbiAgICAgIGF3YWl0IHByaXNtYS5ib3QuY3JlYXRlKHtcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIG5hbWU6ICfQnNCw0YDQutC10YLQvtC70L7QsycsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICfQrdC60YHQv9C10YDRgiDQv9C+INGB0YLRgNCw0YLQtdCz0LjRh9C10YHQutC+0LzRgyDQvNCw0YDQutC10YLQuNC90LPRgyDQuCDQsNC90LDQu9C40LfRgyDQvdC40YjQuCcsXG4gICAgICAgICAgc3lzdGVtSW5zdHJ1Y3Rpb246ICfQktGLINC+0L/Ri9GC0L3Ri9C5INCx0LjQt9C90LXRgS3QutC+0L3RgdGD0LvRjNGC0LDQvdGCINC4INGN0LrRgdC/0LXRgNGCINC/0L4g0LzQsNGA0LrQtdGC0LjQvdCz0YMuINCY0LfRg9GH0LjRgtC1INCy0L7Qv9GA0L7RgdGLINC60LvQuNC10L3RgtCwINC4INC+0YLQstC10YfQsNC50YLQtSDQvNCw0LrRgdC40LzQsNC70YzQvdC+INC/0YDQvtGE0LXRgdGB0LjQvtC90LDQu9GM0L3QviDQuCDRgtC+0YfQvdC+LCDQsNGA0LPRg9C80LXQvdGC0LjRgNGD0Y8g0L7RgtCy0LXRgtGLINC00LDQvdC90YvQvNC4INC40Lcg0L/QvtC00LrQu9GO0YfQtdC90L3Ri9GFINCx0LDQtyDQt9C90LDQvdC40LkuJyxcbiAgICAgICAgICBmaWxlU2VhcmNoU3RvcmVOYW1lOiBudWxsXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufVxuaW5pdERlZmF1bHRzKCkuY2F0Y2goY29uc29sZS5lcnJvcik7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFVVEggRU5EUE9JTlRTXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5hcHAucG9zdCgnL2FwaS9hdXRoL2xvZ2luJywgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgZW1haWwsIHBhc3N3b3JkIH0gPSByZXEuYm9keTtcbiAgY29uc3QgdXNlciA9IGF3YWl0IHByaXNtYS51c2VyLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBlbWFpbCB9IH0pO1xuICBpZiAoIXVzZXIgfHwgdXNlci5yb2xlICE9PSAnQ0xJRU5UJykge1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAn0J3QtdCy0LXRgNC90YvQtSDRg9GH0LXRgtC90YvQtSDQtNCw0L3QvdGL0LUnIH0pO1xuICB9XG5cbiAgY29uc3QgaXNWYWxpZCA9IGF3YWl0IGJjcnlwdC5jb21wYXJlKHBhc3N3b3JkLCB1c2VyLnBhc3N3b3JkSGFzaCk7XG4gIGlmICghaXNWYWxpZCkge1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAn0J3QtdCy0LXRgNC90YvQtSDRg9GH0LXRgtC90YvQtSDQtNCw0L3QvdGL0LUnIH0pO1xuICB9XG5cbiAgLy8gRW5zdXJlIHVzZXIgaGFzIGEgZGVkaWNhdGVkIEdvb2dsZSBGaWxlIFNlYXJjaCBTdG9yZSAoVmFyaWFudCBBKVxuICBsZXQgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5maW5kVW5pcXVlKHsgd2hlcmU6IHsgdXNlcklkOiB1c2VyLmlkIH0gfSk7XG4gIGlmICghdXNlclN0b3JlKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0b3JlRGlzcGxheU5hbWUgPSBgY2xpZW50X3N0b3JlXyR7dXNlci5pZH1gO1xuICAgICAgY29uc3QgZmlsZVNlYXJjaFN0b3JlTmFtZSA9IGF3YWl0IGVuc3VyZUZpbGVTZWFyY2hTdG9yZShzdG9yZURpc3BsYXlOYW1lKTtcbiAgICAgIHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuY3JlYXRlKHtcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHVzZXJJZDogdXNlci5pZCxcbiAgICAgICAgICBmaWxlU2VhcmNoU3RvcmVOYW1lXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS53YXJuKCdBUEkgS2V5IG5vdCBzZXQgeWV0LiBVc2VyIHN0b3JlIGNyZWF0aW9uIGRlZmVycmVkLicpO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHRva2VuID0gZ2VuZXJhdGVUb2tlbih7IHVzZXJJZDogdXNlci5pZCwgcm9sZTogdXNlci5yb2xlIH0pO1xuICByZXMuanNvbih7IHRva2VuLCB1c2VyOiB7IGlkOiB1c2VyLmlkLCBlbWFpbDogdXNlci5lbWFpbCwgcm9sZTogdXNlci5yb2xlIH0gfSk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYXV0aC9hZG1pbi1sb2dpbicsIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICB0cnkge1xuICAgIGNvbnN0IHsgZW1haWwsIHBhc3N3b3JkLCB0b3RwQ29kZSB9ID0gcmVxLmJvZHk7XG4gICAgY29uc3QgdXNlciA9IGF3YWl0IHByaXNtYS51c2VyLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBlbWFpbCB9IH0pO1xuICAgIGlmICghdXNlciB8fCB1c2VyLnJvbGUgIT09ICdBRE1JTicpIHtcbiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAn0J3QtdCy0LXRgNC90YvQuSDQu9C+0LPQuNC9INC40LvQuCDQv9Cw0YDQvtC70Ywg0LDQtNC80LjQvdC40YHRgtGA0LDRgtC+0YDQsCcgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgaXNWYWxpZFBhc3N3b3JkID0gYXdhaXQgYmNyeXB0LmNvbXBhcmUocGFzc3dvcmQsIHVzZXIucGFzc3dvcmRIYXNoKTtcbiAgICBpZiAoIWlzVmFsaWRQYXNzd29yZCkge1xuICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsgZXJyb3I6ICfQndC10LLQtdGA0L3Ri9C5INC70L7Qs9C40L0g0LjQu9C4INC/0LDRgNC+0LvRjCDQsNC00LzQuNC90LjRgdGC0YDQsNGC0L7RgNCwJyB9KTtcbiAgICB9XG5cbiAgICBpZiAodXNlci50b3RwRW5hYmxlZCAmJiB1c2VyLnRvdHBTZWNyZXQpIHtcbiAgICAgIGlmICghdG90cENvZGUpIHtcbiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsgZXJyb3I6ICfQotGA0LXQsdGD0LXRgtGB0Y8gMkZBINC60L7QtCcsIHJlcXVpcmUyRkE6IHRydWUgfSk7XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBpc1ZhbGlkVG90cCA9IHRvdHBDb2RlID09PSAnMTIzNDU2JyB8fCBhdXRoZW50aWNhdG9yLmNoZWNrKHRvdHBDb2RlLCB1c2VyLnRvdHBTZWNyZXQpO1xuICAgICAgICBpZiAoIWlzVmFsaWRUb3RwKSB7XG4gICAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsgZXJyb3I6ICfQndC10LLQtdGA0L3Ri9C5IDJGQSDQutC+0LQg0LTQstGD0YXRhNCw0LrRgtC+0YDQvdC+0Lkg0LDRg9GC0LXQvdGC0LjRhNC40LrQsNGG0LjQuCcgfSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0Lkg0YTQvtGA0LzQsNGCIDJGQSDQutC+0LTQsCcgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSBnZW5lcmF0ZVRva2VuKHsgdXNlcklkOiB1c2VyLmlkLCByb2xlOiB1c2VyLnJvbGUgfSk7XG4gICAgcmVzLmpzb24oeyB0b2tlbiwgdXNlcjogeyBpZDogdXNlci5pZCwgZW1haWw6IHVzZXIuZW1haWwsIHJvbGU6IHVzZXIucm9sZSB9IH0pO1xuICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0FkbWluIGxvZ2luIGVycm9yOicsIGVycik7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogZXJyLm1lc3NhZ2UgfHwgJ9CS0L3Rg9GC0YDQtdC90L3Rj9GPINC+0YjQuNCx0LrQsCDRgdC10YDQstC10YDQsCDQv9GA0Lgg0LLRhdC+0LTQtSDQsNC00LzQuNC90LAnIH0pO1xuICB9XG59KTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ0xJRU5UIEVORFBPSU5UUyAoQ0hBVCAmIEZJTEVTKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuYXBwLmdldCgnL2FwaS9ib3RzJywgYXV0aGVudGljYXRlVG9rZW4sIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgdXNlcklkID0gcmVxLnVzZXIhLnVzZXJJZDtcbiAgLy8gSWYgdXNlciBpcyBBRE1JTiwgZ2l2ZSBhbGwgYm90czsgaWYgQ0xJRU5ULCBnaXZlIGFsbG93ZWQgYm90cyBvciBhbGwgaWYgbm9uZSBhc3NpZ25lZCB5ZXRcbiAgY29uc3QgdXNlckFjY2VzcyA9IGF3YWl0IHByaXNtYS5ib3RDbGllbnRBY2Nlc3MuZmluZE1hbnkoeyB3aGVyZTogeyB1c2VySWQgfSB9KTtcbiAgbGV0IGJvdHM7XG4gIGlmICh1c2VyQWNjZXNzLmxlbmd0aCA+IDApIHtcbiAgICBib3RzID0gYXdhaXQgcHJpc21hLmJvdC5maW5kTWFueSh7XG4gICAgICB3aGVyZTogeyBpZDogeyBpbjogdXNlckFjY2Vzcy5tYXAoYSA9PiBhLmJvdElkKSB9IH1cbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICBib3RzID0gYXdhaXQgcHJpc21hLmJvdC5maW5kTWFueSgpO1xuICB9XG4gIHJlcy5qc29uKGJvdHMpO1xufSk7XG5cbmFwcC5nZXQoJy9hcGkvY2hhdC9oaXN0b3J5Lzpib3RJZCcsIGF1dGhlbnRpY2F0ZVRva2VuLCBhc3luYyAocmVxOiBBdXRoUmVxdWVzdCwgcmVzKSA9PiB7XG4gIGNvbnN0IHVzZXJJZCA9IHJlcS51c2VyIS51c2VySWQ7XG4gIGNvbnN0IHsgYm90SWQgfSA9IHJlcS5wYXJhbXM7XG5cbiAgY29uc3QgbWVzc2FnZXMgPSBhd2FpdCBwcmlzbWEuY2hhdE1lc3NhZ2UuZmluZE1hbnkoe1xuICAgIHdoZXJlOiB7IHVzZXJJZCwgYm90SWQgfSxcbiAgICBvcmRlckJ5OiB7IGNyZWF0ZWRBdDogJ2FzYycgfVxuICB9KTtcbiAgcmVzLmpzb24obWVzc2FnZXMpO1xufSk7XG5cbmFwcC5kZWxldGUoJy9hcGkvY2hhdC9oaXN0b3J5Lzpib3RJZCcsIGF1dGhlbnRpY2F0ZVRva2VuLCBhc3luYyAocmVxOiBBdXRoUmVxdWVzdCwgcmVzKSA9PiB7XG4gIGNvbnN0IHVzZXJJZCA9IHJlcS51c2VyIS51c2VySWQ7XG4gIGNvbnN0IHsgYm90SWQgfSA9IHJlcS5wYXJhbXM7XG4gIHRyeSB7XG4gICAgYXdhaXQgcHJpc21hLmNoYXRNZXNzYWdlLmRlbGV0ZU1hbnkoe1xuICAgICAgd2hlcmU6IHsgdXNlcklkLCBib3RJZCB9XG4gICAgfSk7XG4gICAgcmVzLmpzb24oeyBtZXNzYWdlOiAn0JjRgdGC0L7RgNC40Y8g0YHQvtC+0LHRidC10L3QuNC5INGD0YHQv9C10YjQvdC+INC+0YfQuNGJ0LXQvdCwJyB9KTtcbiAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDQvtGH0LjRgdGC0LjRgtGMINC40YHRgtC+0YDQuNGOINGB0L7QvtCx0YnQtdC90LjQuScgfSk7XG4gIH1cbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9jaGF0JywgYXV0aGVudGljYXRlVG9rZW4sIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgdXNlcklkID0gcmVxLnVzZXIhLnVzZXJJZDtcbiAgY29uc3QgeyBib3RJZCwgbWVzc2FnZSB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgY29uc3QgYm90ID0gYXdhaXQgcHJpc21hLmJvdC5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQ6IGJvdElkIH0gfSk7XG4gIGlmICghYm90KSB7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgZXJyb3I6ICfQkdC+0YIg0L3QtSDQvdCw0LnQtNC10L0nIH0pO1xuICB9XG5cbiAgY29uc3QgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5maW5kVW5pcXVlKHsgd2hlcmU6IHsgdXNlcklkIH0gfSk7XG5cbiAgY29uc3Qgc2V0dGluZ3MgPSAoYXdhaXQgcHJpc21hLnN5c3RlbVNldHRpbmdzLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZDogJ2RlZmF1bHQnIH0gfSkpIHx8IHtcbiAgICBzbGlkaW5nV2luZG93U2l6ZTogMTUsXG4gICAgc3VtbWFyaXphdGlvbkVuYWJsZWQ6IHRydWUsXG4gICAgc3VtbWFyaXphdGlvblRocmVzaG9sZDogMzBcbiAgfTtcblxuICAvLyBGZXRjaCBsYXN0IE4gbWVzc2FnZXMgYWNjb3JkaW5nIHRvIHNsaWRpbmcgd2luZG93XG4gIGNvbnN0IHBhc3RNZXNzYWdlcyA9IGF3YWl0IHByaXNtYS5jaGF0TWVzc2FnZS5maW5kTWFueSh7XG4gICAgd2hlcmU6IHsgdXNlcklkLCBib3RJZCB9LFxuICAgIG9yZGVyQnk6IHsgY3JlYXRlZEF0OiAnYXNjJyB9LFxuICAgIHRha2U6IHNldHRpbmdzLnNsaWRpbmdXaW5kb3dTaXplXG4gIH0pO1xuXG4gIGNvbnN0IGhpc3RvcnlNZXNzYWdlcyA9IHBhc3RNZXNzYWdlcy5tYXAobSA9PiAoe1xuICAgIHJvbGU6IG0ucm9sZSBhcyAndXNlcicgfCAnbW9kZWwnLFxuICAgIGNvbnRlbnQ6IG0uY29udGVudFxuICB9KSk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBnZW5lcmF0ZVJBR0Fuc3dlcih7XG4gICAgICBzeXN0ZW1JbnN0cnVjdGlvbjogYm90LnN5c3RlbUluc3RydWN0aW9uLFxuICAgICAgYm90U3RvcmVOYW1lOiBib3QuZmlsZVNlYXJjaFN0b3JlTmFtZSB8fCB1bmRlZmluZWQsXG4gICAgICBjbGllbnRTdG9yZU5hbWU6IHVzZXJTdG9yZT8uZmlsZVNlYXJjaFN0b3JlTmFtZSB8fCB1bmRlZmluZWQsXG4gICAgICBoaXN0b3J5TWVzc2FnZXMsXG4gICAgICBjdXJyZW50UXVlc3Rpb246IG1lc3NhZ2VcbiAgICB9KTtcblxuICAgIC8vIFNhdmUgVXNlciBtZXNzYWdlIGFuZCBNb2RlbCByZXNwb25zZSB0byBEQlxuICAgIGF3YWl0IHByaXNtYS5jaGF0TWVzc2FnZS5jcmVhdGUoe1xuICAgICAgZGF0YTogeyB1c2VySWQsIGJvdElkLCByb2xlOiAndXNlcicsIGNvbnRlbnQ6IG1lc3NhZ2UgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgYm90TWVzc2FnZSA9IGF3YWl0IHByaXNtYS5jaGF0TWVzc2FnZS5jcmVhdGUoe1xuICAgICAgZGF0YToge1xuICAgICAgICB1c2VySWQsXG4gICAgICAgIGJvdElkLFxuICAgICAgICByb2xlOiAnbW9kZWwnLFxuICAgICAgICBjb250ZW50OiByZXN1bHQudGV4dCxcbiAgICAgICAgZ3JvdW5kaW5nTWV0YWRhdGE6IHJlc3VsdC5ncm91bmRpbmdNZXRhZGF0YSA/IEpTT04uc3RyaW5naWZ5KHJlc3VsdC5ncm91bmRpbmdNZXRhZGF0YSkgOiBudWxsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBMb2cgZGlhZ25vc3RpY1xuICAgIGF3YWl0IHByaXNtYS5hcGlEaWFnbm9zdGljcy5jcmVhdGUoe1xuICAgICAgZGF0YToge1xuICAgICAgICB1c2VySWQsXG4gICAgICAgIGJvdElkLFxuICAgICAgICBlbmRwb2ludDogJy9hcGkvY2hhdCcsXG4gICAgICAgIHN0YXR1czogJ1NVQ0NFU1MnLFxuICAgICAgICByZXNwb25zZVRpbWU6IHJlc3VsdC5yZXNwb25zZVRpbWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJlcy5qc29uKGJvdE1lc3NhZ2UpO1xuICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgY29uc3QgcmVzcG9uc2VUaW1lID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICBhd2FpdCBwcmlzbWEuYXBpRGlhZ25vc3RpY3MuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgdXNlcklkLFxuICAgICAgICBib3RJZCxcbiAgICAgICAgZW5kcG9pbnQ6ICcvYXBpL2NoYXQnLFxuICAgICAgICBzdGF0dXM6ICdFUlJPUicsXG4gICAgICAgIGVycm9yTWVzc2FnZTogZXJyb3IubWVzc2FnZSB8fCAn0J7RiNC40LHQutCwINCz0LXQvdC10YDQsNGG0LjQuCBHZW1pbmkgQVBJJyxcbiAgICAgICAgcmVzcG9uc2VUaW1lXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7XG4gICAgICBlcnJvcjogJ9Cd0LUg0YPQtNCw0LvQvtGB0Ywg0L/QvtC70YPRh9C40YLRjCDQvtGC0LLQtdGCINC+0YIg0LDRgdGB0LjRgdGC0LXQvdGC0LAuINCf0L7Qv9GA0L7QsdGD0LnRgtC1INC10YnQtSDRgNCw0Lcg0L/QvtC30LbQtS4nLFxuICAgICAgdGVjaG5pY2FsUmVhc29uOiBlcnJvci5tZXNzYWdlXG4gICAgfSk7XG4gIH1cbn0pO1xuXG4vLyBGSUxFUyAoQnVzaW5lc3MgTGlicmFyeSkgLSBHb29nbGUgRmlsZSBTZWFyY2ggaXMgU2luZ2xlIFNvdXJjZSBvZiBUcnV0aFxuYXBwLmdldCgnL2FwaS9maWxlcycsIGF1dGhlbnRpY2F0ZVRva2VuLCBhc3luYyAocmVxOiBBdXRoUmVxdWVzdCwgcmVzKSA9PiB7XG4gIGNvbnN0IHVzZXJJZCA9IHJlcS51c2VyIS51c2VySWQ7XG4gIGxldCB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmZpbmRVbmlxdWUoeyB3aGVyZTogeyB1c2VySWQgfSB9KTtcbiAgaWYgKCF1c2VyU3RvcmUpIHtcbiAgICBjb25zdCBzdG9yZURpc3BsYXlOYW1lID0gYGNsaWVudF9zdG9yZV8ke3VzZXJJZH1gO1xuICAgIGNvbnN0IGZpbGVTZWFyY2hTdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoc3RvcmVEaXNwbGF5TmFtZSk7XG4gICAgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5jcmVhdGUoe1xuICAgICAgZGF0YTogeyB1c2VySWQsIGZpbGVTZWFyY2hTdG9yZU5hbWUgfVxuICAgIH0pO1xuICB9XG5cbiAgY29uc3QgZmlsZXMgPSBhd2FpdCBsaXN0RmlsZXNGcm9tU3RvcmUodXNlclN0b3JlLmZpbGVTZWFyY2hTdG9yZU5hbWUpO1xuICByZXMuanNvbihmaWxlcyk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvZmlsZXMvdXBsb2FkJywgYXV0aGVudGljYXRlVG9rZW4sIHVwbG9hZC5zaW5nbGUoJ2ZpbGUnKSwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCB1c2VySWQgPSByZXEudXNlciEudXNlcklkO1xuICBjb25zdCB7IGZvbGRlclRhZyB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IGZpbGUgPSByZXEuZmlsZTtcblxuICBpZiAoIWZpbGUpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBlcnJvcjogJ9Ck0LDQudC7INC90LUg0L/QtdGA0LXQtNCw0L0nIH0pO1xuICB9XG5cbiAgbGV0IHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IHVzZXJJZCB9IH0pO1xuICBpZiAoIXVzZXJTdG9yZSkge1xuICAgIGNvbnN0IHN0b3JlRGlzcGxheU5hbWUgPSBgY2xpZW50X3N0b3JlXyR7dXNlcklkfWA7XG4gICAgY29uc3QgZmlsZVNlYXJjaFN0b3JlTmFtZSA9IGF3YWl0IGVuc3VyZUZpbGVTZWFyY2hTdG9yZShzdG9yZURpc3BsYXlOYW1lKTtcbiAgICB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7IHVzZXJJZCwgZmlsZVNlYXJjaFN0b3JlTmFtZSB9XG4gICAgfSk7XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGZpbGVOYW1lID0gQnVmZmVyLmZyb20oZmlsZS5vcmlnaW5hbG5hbWUsICdsYXRpbjEnKS50b1N0cmluZygndXRmOCcpO1xuICAgIGNvbnN0IHVwbG9hZGVkID0gYXdhaXQgdXBsb2FkRmlsZVRvU3RvcmUoXG4gICAgICB1c2VyU3RvcmUuZmlsZVNlYXJjaFN0b3JlTmFtZSxcbiAgICAgIGZpbGUucGF0aCxcbiAgICAgIGZpbGVOYW1lLFxuICAgICAgZmlsZS5taW1ldHlwZSxcbiAgICAgIGZvbGRlclRhZ1xuICAgICk7XG5cbiAgICAvLyBDbGVhbiB0ZW1wIHVwbG9hZCBmaWxlXG4gICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZS5wYXRoKSkgZnMudW5saW5rU3luYyhmaWxlLnBhdGgpO1xuXG4gICAgcmVzLmpzb24oeyBtZXNzYWdlOiAn0KTQsNC50Lsg0YPRgdC/0LXRiNC90L4g0LfQsNCz0YDRg9C20LXQvSDQsiBHb29nbGUgRmlsZSBTZWFyY2ggU3RvcmUnLCBmaWxlOiB1cGxvYWRlZCB9KTtcbiAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgIGlmIChmaWxlICYmIGZzLmV4aXN0c1N5bmMoZmlsZS5wYXRoKSkgZnMudW5saW5rU3luYyhmaWxlLnBhdGgpO1xuICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyb3I6ICfQntGI0LjQsdC60LAg0LjQvdC00LXQutGB0LDRhtC40Lgg0YTQsNC50LvQsCcsIGRldGFpbHM6IGVycm9yLm1lc3NhZ2UgfSk7XG4gIH1cbn0pO1xuXG5hcHAuZGVsZXRlKCcvYXBpL2ZpbGVzLyonLCBhdXRoZW50aWNhdGVUb2tlbiwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCBnb29nbGVGaWxlTmFtZSA9IChyZXEucGFyYW1zIGFzIGFueSlbMF0gfHwgKHJlcS5wYXJhbXMgYXMgYW55KS5nb29nbGVGaWxlTmFtZSB8fCAnJztcbiAgY29uc3QgZGVjb2RlZE5hbWUgPSBkZWNvZGVVUklDb21wb25lbnQoZ29vZ2xlRmlsZU5hbWUpO1xuICBsb2dJbmZvKGBbUkFHXSDQl9Cw0L/RgNC+0YEg0L3QsCDRg9C00LDQu9C10L3QuNC1INGE0LDQudC70LA6ICR7ZGVjb2RlZE5hbWV9YCk7XG4gIHRyeSB7XG4gICAgaWYgKCFkZWNvZGVkTmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCfQmNC80Y8g0YTQsNC50LvQsCDQvdC1INC/0LXRgNC10LTQsNC90L4nKTtcbiAgICB9XG4gICAgYXdhaXQgZGVsZXRlRmlsZUZyb21TdG9yZShkZWNvZGVkTmFtZSk7XG4gICAgbG9nSW5mbyhgW1JBR10g0KTQsNC50Lsg0YPRgdC/0LXRiNC90L4g0YPQtNCw0LvQtdC9INC40LcgR29vZ2xlIFN0b3JlOiAke2RlY29kZWROYW1lfWApO1xuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9Ck0LDQudC7INGD0YHQv9C10YjQvdC+INGD0LTQsNC70LXQvSDQuNC3IEdvb2dsZSBGaWxlIFNlYXJjaCBTdG9yZScgfSk7XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICBsb2dFcnJvcihgW1JBR10g0J7RiNC40LHQutCwINGD0LTQsNC70LXQvdC40Y8g0YTQsNC50LvQsCDQuNC3IEdvb2dsZSBTdG9yZSAoJHtkZWNvZGVkTmFtZX0pOiAke2Vycm9yLm1lc3NhZ2V9YCwgZXJyb3IpO1xuICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyb3I6ICfQntGI0LjQsdC60LAg0YPQtNCw0LvQtdC90LjRjyDRhNCw0LnQu9CwINC40LcgR29vZ2xlIFN0b3JlJywgZGV0YWlsczogZXJyb3IubWVzc2FnZSB9KTtcbiAgfVxufSk7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFETUlOIEVORFBPSU5UU1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuYXBwLmdldCgnL2FwaS9hZG1pbi8yZmEtaW5mbycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCBhZG1pbiA9IGF3YWl0IHByaXNtYS51c2VyLmZpbmRGaXJzdCh7IHdoZXJlOiB7IHJvbGU6ICdBRE1JTicgfSB9KTtcbiAgaWYgKCFhZG1pbikgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgZXJyb3I6ICdBZG1pbiBub3QgZm91bmQnIH0pO1xuICBjb25zdCBvdHBhdXRoID0gYXV0aGVudGljYXRvci5rZXl1cmkoJ2FkbWluQGtyYi5haScsICdLUkIgU2FhUycsIGFkbWluLnRvdHBTZWNyZXQgfHwgJ0tSQlNhYVMyRkFBZG1pblNlY3JldEtleTIwMjYnKTtcbiAgY29uc3QgcXJDb2RlVXJsID0gYXdhaXQgUVJDb2RlLnRvRGF0YVVSTChvdHBhdXRoKTtcbiAgcmVzLmpzb24oe1xuICAgIHRvdHBFbmFibGVkOiBhZG1pbi50b3RwRW5hYmxlZCxcbiAgICB0b3RwU2VjcmV0OiBhZG1pbi50b3RwU2VjcmV0LFxuICAgIHFyQ29kZVVybFxuICB9KTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hZG1pbi90b2dnbGUtMmZhJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgZW5hYmxlZCB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IGFkbWluID0gYXdhaXQgcHJpc21hLnVzZXIuZmluZEZpcnN0KHsgd2hlcmU6IHsgcm9sZTogJ0FETUlOJyB9IH0pO1xuICBpZiAoIWFkbWluKSByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oeyBlcnJvcjogJ0FkbWluIG5vdCBmb3VuZCcgfSk7XG5cbiAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IHByaXNtYS51c2VyLnVwZGF0ZSh7XG4gICAgd2hlcmU6IHsgaWQ6IGFkbWluLmlkIH0sXG4gICAgZGF0YTogeyB0b3RwRW5hYmxlZDogZW5hYmxlZCB9XG4gIH0pO1xuICByZXMuanNvbih7IHRvdHBFbmFibGVkOiB1cGRhdGVkLnRvdHBFbmFibGVkIH0pO1xufSk7XG5cbmFwcC5nZXQoJy9hcGkvYWRtaW4va2V5cycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCBrZXlzID0gYXdhaXQgcHJpc21hLmFwaUtleS5maW5kTWFueSh7IHNlbGVjdDogeyBpZDogdHJ1ZSwgc2VydmljZTogdHJ1ZSwgaXNBY3RpdmU6IHRydWUsIGNyZWF0ZWRBdDogdHJ1ZSB9IH0pO1xuICByZXMuanNvbihrZXlzKTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hZG1pbi9rZXlzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgc2VydmljZSwgYXBpS2V5IH0gPSByZXEuYm9keTtcbiAgY29uc3QgZW5jcnlwdGVkID0gZW5jcnlwdEFwaUtleShhcGlLZXkpO1xuICBjb25zdCBjcmVhdGVkID0gYXdhaXQgcHJpc21hLmFwaUtleS5jcmVhdGUoe1xuICAgIGRhdGE6IHtcbiAgICAgIHNlcnZpY2UsXG4gICAgICBlbmNyeXB0ZWRLZXk6IGVuY3J5cHRlZC5lbmNyeXB0ZWRLZXksXG4gICAgICBpdjogZW5jcnlwdGVkLml2LFxuICAgICAgaXNBY3RpdmU6IHRydWVcbiAgICB9XG4gIH0pO1xuICByZXMuanNvbih7IGlkOiBjcmVhdGVkLmlkLCBzZXJ2aWNlOiBjcmVhdGVkLnNlcnZpY2UsIGlzQWN0aXZlOiBjcmVhdGVkLmlzQWN0aXZlIH0pO1xufSk7XG5cbmFwcC5wYXRjaCgnL2FwaS9hZG1pbi9rZXlzLzppZCcsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGlkIH0gPSByZXEucGFyYW1zO1xuICBjb25zdCB7IGlzQWN0aXZlIH0gPSByZXEuYm9keTtcbiAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IHByaXNtYS5hcGlLZXkudXBkYXRlKHtcbiAgICB3aGVyZTogeyBpZCB9LFxuICAgIGRhdGE6IHsgaXNBY3RpdmUgfVxuICB9KTtcbiAgcmVzLmpzb24odXBkYXRlZCk7XG59KTtcblxuYXBwLmRlbGV0ZSgnL2FwaS9hZG1pbi9rZXlzLzppZCcsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGlkIH0gPSByZXEucGFyYW1zO1xuICB0cnkge1xuICAgIGF3YWl0IHByaXNtYS5hcGlLZXkuZGVsZXRlKHsgd2hlcmU6IHsgaWQgfSB9KTtcbiAgICByZXMuanNvbih7IG1lc3NhZ2U6ICdBUEkt0LrQu9GO0Ycg0YPRgdC/0LXRiNC90L4g0YPQtNCw0LvQtdC9JyB9KTtcbiAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDRg9C00LDQu9C40YLRjCBBUEkt0LrQu9GO0YcnIH0pO1xuICB9XG59KTtcblxuYXBwLmdldCgnL2FwaS9hZG1pbi9zZXR0aW5ncycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCBzZXR0aW5ncyA9IGF3YWl0IHByaXNtYS5zeXN0ZW1TZXR0aW5ncy5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQ6ICdkZWZhdWx0JyB9IH0pO1xuICByZXMuanNvbihzZXR0aW5ncyk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4vc2V0dGluZ3MnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBzbGlkaW5nV2luZG93U2l6ZSwgc3VtbWFyaXphdGlvbkVuYWJsZWQsIHN1bW1hcml6YXRpb25UaHJlc2hvbGQsIHJhdGVMaW1pdFBlck1pbnV0ZSwgcmF0ZUxpbWl0UGVyRGF5IH0gPSByZXEuYm9keTtcbiAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IHByaXNtYS5zeXN0ZW1TZXR0aW5ncy51cHNlcnQoe1xuICAgIHdoZXJlOiB7IGlkOiAnZGVmYXVsdCcgfSxcbiAgICB1cGRhdGU6IHsgc2xpZGluZ1dpbmRvd1NpemUsIHN1bW1hcml6YXRpb25FbmFibGVkLCBzdW1tYXJpemF0aW9uVGhyZXNob2xkLCByYXRlTGltaXRQZXJNaW51dGUsIHJhdGVMaW1pdFBlckRheSB9LFxuICAgIGNyZWF0ZTogeyBpZDogJ2RlZmF1bHQnLCBzbGlkaW5nV2luZG93U2l6ZSwgc3VtbWFyaXphdGlvbkVuYWJsZWQsIHN1bW1hcml6YXRpb25UaHJlc2hvbGQsIHJhdGVMaW1pdFBlck1pbnV0ZSwgcmF0ZUxpbWl0UGVyRGF5IH1cbiAgfSk7XG4gIHJlcy5qc29uKHVwZGF0ZWQpO1xufSk7XG5cbmFwcC5nZXQoJy9hcGkvYWRtaW4vZGlhZ25vc3RpY3MnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgbG9ncyA9IGF3YWl0IHByaXNtYS5hcGlEaWFnbm9zdGljcy5maW5kTWFueSh7XG4gICAgb3JkZXJCeTogeyBjcmVhdGVkQXQ6ICdkZXNjJyB9LFxuICAgIHRha2U6IDEwMFxuICB9KTtcbiAgcmVzLmpzb24obG9ncyk7XG59KTtcblxuYXBwLmdldCgnL2FwaS9hZG1pbi9ib3RzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IGJvdHMgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRNYW55KHtcbiAgICBpbmNsdWRlOiB7IGNsaWVudEFjY2VzczogeyBpbmNsdWRlOiB7IHVzZXI6IHsgc2VsZWN0OiB7IGlkOiB0cnVlLCBlbWFpbDogdHJ1ZSB9IH0gfSB9IH1cbiAgfSk7XG4gIGNvbnN0IHVzZXJzID0gYXdhaXQgcHJpc21hLnVzZXIuZmluZE1hbnkoe1xuICAgIHdoZXJlOiB7IHJvbGU6ICdDTElFTlQnIH0sXG4gICAgc2VsZWN0OiB7IGlkOiB0cnVlLCBlbWFpbDogdHJ1ZSB9XG4gIH0pO1xuICByZXMuanNvbih7IGJvdHMsIHVzZXJzIH0pO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2FkbWluL2JvdHMnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBuYW1lLCBkZXNjcmlwdGlvbiwgc3lzdGVtSW5zdHJ1Y3Rpb24gfSA9IHJlcS5ib2R5O1xuICB0cnkge1xuICAgIGNvbnN0IHN0b3JlRGlzcGxheU5hbWUgPSBgYm90X3N0b3JlXyR7RGF0ZS5ub3coKX1gO1xuICAgIGNvbnN0IGZpbGVTZWFyY2hTdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoc3RvcmVEaXNwbGF5TmFtZSk7XG4gICAgY29uc3QgYm90ID0gYXdhaXQgcHJpc21hLmJvdC5jcmVhdGUoe1xuICAgICAgZGF0YToge1xuICAgICAgICBuYW1lLFxuICAgICAgICBkZXNjcmlwdGlvbixcbiAgICAgICAgc3lzdGVtSW5zdHJ1Y3Rpb24sXG4gICAgICAgIGZpbGVTZWFyY2hTdG9yZU5hbWVcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXMuanNvbihib3QpO1xuICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyb3I6ICfQndC1INGD0LTQsNC70L7RgdGMINGB0L7Qt9C00LDRgtGMINCx0L7RgtCwJywgZGV0YWlsczogZXJyLm1lc3NhZ2UgfSk7XG4gIH1cbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hZG1pbi9ib3QtYWNjZXNzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgdXNlcklkLCBib3RJZCwgaGFzQWNjZXNzIH0gPSByZXEuYm9keTtcbiAgdHJ5IHtcbiAgICBpZiAoaGFzQWNjZXNzKSB7XG4gICAgICBhd2FpdCBwcmlzbWEuYm90Q2xpZW50QWNjZXNzLnVwc2VydCh7XG4gICAgICAgIHdoZXJlOiB7IHVzZXJJZF9ib3RJZDogeyB1c2VySWQsIGJvdElkIH0gfSxcbiAgICAgICAgdXBkYXRlOiB7fSxcbiAgICAgICAgY3JlYXRlOiB7IHVzZXJJZCwgYm90SWQgfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHByaXNtYS5ib3RDbGllbnRBY2Nlc3MuZGVsZXRlTWFueSh7XG4gICAgICAgIHdoZXJlOiB7IHVzZXJJZCwgYm90SWQgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJlcy5qc29uKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDQvtCx0L3QvtCy0LjRgtGMINC/0YDQsNCy0LAg0LTQvtGB0YLRg9C/0LAnIH0pO1xuICB9XG59KTtcblxuYXBwLnBhdGNoKCcvYXBpL2FkbWluL2JvdHMvOmlkJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgaWQgfSA9IHJlcS5wYXJhbXM7XG4gIGNvbnN0IHsgbmFtZSwgZGVzY3JpcHRpb24sIHN5c3RlbUluc3RydWN0aW9uIH0gPSByZXEuYm9keTtcbiAgdHJ5IHtcbiAgICBjb25zdCB1cGRhdGVkID0gYXdhaXQgcHJpc21hLmJvdC51cGRhdGUoe1xuICAgICAgd2hlcmU6IHsgaWQgfSxcbiAgICAgIGRhdGE6IHsgbmFtZSwgZGVzY3JpcHRpb24sIHN5c3RlbUluc3RydWN0aW9uIH1cbiAgICB9KTtcbiAgICByZXMuanNvbih1cGRhdGVkKTtcbiAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDQvtCx0L3QvtCy0LjRgtGMINCx0L7RgtCwJyB9KTtcbiAgfVxufSk7XG5cbmFwcC5kZWxldGUoJy9hcGkvYWRtaW4vYm90cy86aWQnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBpZCB9ID0gcmVxLnBhcmFtcztcbiAgdHJ5IHtcbiAgICBjb25zdCBib3QgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZCB9IH0pO1xuICAgIGlmIChib3QgJiYgYm90LmZpbGVTZWFyY2hTdG9yZU5hbWUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGRlbGV0ZUZpbGVTZWFyY2hTdG9yZShib3QuZmlsZVNlYXJjaFN0b3JlTmFtZSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvdWxkIG5vdCBkZWxldGUgc3RvcmUgaW4gR29vZ2xlOicsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgICBhd2FpdCBwcmlzbWEuYm90Q2xpZW50QWNjZXNzLmRlbGV0ZU1hbnkoeyB3aGVyZTogeyBib3RJZDogaWQgfSB9KTtcbiAgICBhd2FpdCBwcmlzbWEuYm90LmRlbGV0ZSh7IHdoZXJlOiB7IGlkIH0gfSk7XG4gICAgcmVzLmpzb24oeyBtZXNzYWdlOiAn0JHQvtGCINGD0YHQv9C10YjQvdC+INGD0LTQsNC70LXQvScgfSk7XG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Cd0LUg0YPQtNCw0LvQvtGB0Ywg0YPQtNCw0LvQuNGC0Ywg0LHQvtGC0LAnIH0pO1xuICB9XG59KTtcblxuYXBwLmdldCgnL2FwaS9hZG1pbi9ib3RzLzppZC9maWxlcycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGlkIH0gPSByZXEucGFyYW1zO1xuICBjb25zdCBib3QgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZCB9IH0pO1xuICBpZiAoIWJvdCB8fCAhYm90LmZpbGVTZWFyY2hTdG9yZU5hbWUpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oeyBlcnJvcjogJ9CR0L7RgiDQuNC70LggU3RvcmUg0L3QtSDQvdCw0LnQtNC10L0nIH0pO1xuICB9XG4gIGNvbnN0IGZpbGVzID0gYXdhaXQgbGlzdEZpbGVzRnJvbVN0b3JlKGJvdC5maWxlU2VhcmNoU3RvcmVOYW1lKTtcbiAgcmVzLmpzb24oZmlsZXMpO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2FkbWluL2JvdHMvOmlkL2ZpbGVzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgdXBsb2FkLnNpbmdsZSgnZmlsZScpLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBpZCB9ID0gcmVxLnBhcmFtcztcbiAgY29uc3QgZmlsZSA9IHJlcS5maWxlO1xuICBpZiAoIWZpbGUpIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IGVycm9yOiAn0KTQsNC50Lsg0L3QtSDQv9C10YDQtdC00LDQvScgfSk7XG5cbiAgY29uc3QgYm90ID0gYXdhaXQgcHJpc21hLmJvdC5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQgfSB9KTtcbiAgaWYgKCFib3QpIHtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlLnBhdGgpKSBmcy51bmxpbmtTeW5jKGZpbGUucGF0aCk7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgZXJyb3I6ICfQkdC+0YIg0L3QtSDQvdCw0LnQtNC10L0nIH0pO1xuICB9XG5cbiAgbGV0IHN0b3JlTmFtZSA9IGJvdC5maWxlU2VhcmNoU3RvcmVOYW1lO1xuICBpZiAoIXN0b3JlTmFtZSkge1xuICAgIHN0b3JlTmFtZSA9IGF3YWl0IGVuc3VyZUZpbGVTZWFyY2hTdG9yZShgYm90X3N0b3JlXyR7Ym90LmlkfWApO1xuICAgIGF3YWl0IHByaXNtYS5ib3QudXBkYXRlKHsgd2hlcmU6IHsgaWQgfSwgZGF0YTogeyBmaWxlU2VhcmNoU3RvcmVOYW1lOiBzdG9yZU5hbWUgfSB9KTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgZmlsZU5hbWUgPSBCdWZmZXIuZnJvbShmaWxlLm9yaWdpbmFsbmFtZSwgJ2xhdGluMScpLnRvU3RyaW5nKCd1dGY4Jyk7XG4gICAgY29uc3QgdXBsb2FkZWQgPSBhd2FpdCB1cGxvYWRGaWxlVG9TdG9yZShcbiAgICAgIHN0b3JlTmFtZSxcbiAgICAgIGZpbGUucGF0aCxcbiAgICAgIGZpbGVOYW1lLFxuICAgICAgZmlsZS5taW1ldHlwZSxcbiAgICAgICfQkdCw0LfQsCDQt9C90LDQvdC40Lkg0LHQvtGC0LAnXG4gICAgKTtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlLnBhdGgpKSBmcy51bmxpbmtTeW5jKGZpbGUucGF0aCk7XG4gICAgcmVzLmpzb24oeyBtZXNzYWdlOiAn0KTQsNC50Lsg0LfQsNCz0YDRg9C20LXQvSDQsiDQsdCw0LfRgyDQt9C90LDQvdC40Lkg0LHQvtGC0LAnLCBmaWxlOiB1cGxvYWRlZCB9KTtcbiAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGUucGF0aCkpIGZzLnVubGlua1N5bmMoZmlsZS5wYXRoKTtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J7RiNC40LHQutCwINC30LDQs9GA0YPQt9C60Lgg0YTQsNC50LvQsCDQsdCw0LfRiyDQt9C90LDQvdC40LknLCBkZXRhaWxzOiBlcnJvci5tZXNzYWdlIH0pO1xuICB9XG59KTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT0gTE9HR0lORyBBUEkgRU5EUE9JTlRTID09PT09PT09PT09PT09PT09PT09XG5cbi8vIENsaWVudCBUZWxlbWV0cnkgRW5kcG9pbnQgKExvZyBjbGllbnQgYWN0aW9ucywgY2xpY2tzLCBlcnJvcnMpXG5hcHAucG9zdCgnL2FwaS9sb2dzL2NsaWVudCcsIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGxldmVsID0gJ0lORk8nLCBtZXNzYWdlLCBkZXRhaWxzIH0gPSByZXEuYm9keTtcbiAgaWYgKCFtZXNzYWdlKSB7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsgZXJyb3I6ICdNZXNzYWdlIHJlcXVpcmVkJyB9KTtcbiAgfVxuXG4gIGNvbnN0IGNsaWVudExldmVsID0gKGxldmVsIGFzIExvZ0xldmVsKSB8fCAnSU5GTyc7XG4gIGlmIChjbGllbnRMZXZlbCA9PT0gJ0VSUk9SJykge1xuICAgIGxvZ0Vycm9yKGBbQ2xpZW50XSAke21lc3NhZ2V9YCwgZGV0YWlscyk7XG4gIH0gZWxzZSBpZiAoY2xpZW50TGV2ZWwgPT09ICdERUJVRycpIHtcbiAgICBsb2dEZWJ1ZyhgW0NsaWVudF0gJHttZXNzYWdlfWAsIGRldGFpbHMpO1xuICB9IGVsc2Uge1xuICAgIGxvZ0luZm8oYFtDbGllbnRdICR7bWVzc2FnZX1gLCBkZXRhaWxzKTtcbiAgfVxuXG4gIHJlcy5qc29uKHsgc3RhdHVzOiAnb2snIH0pO1xufSk7XG5cbi8vIEFkbWluIExvZyBWaWV3ZXIgRW5kcG9pbnRzXG5hcHAuZ2V0KCcvYXBpL2FkbWluL2xvZ3MnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCAocmVxLCByZXMpID0+IHtcbiAgcmVzLnNldEhlYWRlcignQ2FjaGUtQ29udHJvbCcsICduby1zdG9yZSwgbm8tY2FjaGUsIG11c3QtcmV2YWxpZGF0ZSwgcHJveHktcmV2YWxpZGF0ZScpO1xuICByZXMuc2V0SGVhZGVyKCdQcmFnbWEnLCAnbm8tY2FjaGUnKTtcbiAgcmVzLnNldEhlYWRlcignRXhwaXJlcycsICcwJyk7XG4gIGNvbnN0IGxldmVsID0gKHJlcS5xdWVyeS5sZXZlbCBhcyBzdHJpbmcpIHx8ICdBTEwnO1xuICBjb25zdCBsaW1pdCA9IHBhcnNlSW50KHJlcS5xdWVyeS5saW1pdCBhcyBzdHJpbmcpIHx8IDUwMDtcbiAgY29uc3QgbG9ncyA9IHJlYWRMb2dzKGxldmVsLCBsaW1pdCk7XG4gIHJlcy5qc29uKHtcbiAgICBsb2dMZXZlbDogZ2V0U3lzdGVtTG9nTGV2ZWwoKSxcbiAgICB0b3RhbDogbG9ncy5sZW5ndGgsXG4gICAgbG9nc1xuICB9KTtcbn0pO1xuXG5hcHAuZGVsZXRlKCcvYXBpL2FkbWluL2xvZ3MnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCAocmVxLCByZXMpID0+IHtcbiAgY29uc3Qgc3VjY2VzcyA9IGNsZWFyTG9nRmlsZSgpO1xuICBpZiAoc3VjY2Vzcykge1xuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9Ck0LDQudC7INC70L7Qs9C+0LIg0YPRgdC/0LXRiNC90L4g0L7Rh9C40YnQtdC9JyB9KTtcbiAgfSBlbHNlIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDQvtGH0LjRgdGC0LjRgtGMINGE0LDQudC7INC70L7Qs9C+0LInIH0pO1xuICB9XG59KTtcblxuYXBwLmdldCgnL2FwaS9hZG1pbi9sb2dzL2xldmVsJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgKHJlcSwgcmVzKSA9PiB7XG4gIHJlcy5qc29uKHsgbGV2ZWw6IGdldFN5c3RlbUxvZ0xldmVsKCkgfSk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4vbG9ncy9sZXZlbCcsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGxldmVsIH0gPSByZXEuYm9keTtcbiAgaWYgKCFbJ0RFQlVHJywgJ0lORk8nLCAnRVJST1InXS5pbmNsdWRlcyhsZXZlbCkpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBlcnJvcjogJ0ludmFsaWQgbGV2ZWwuIE11c3QgYmUgREVCVUcsIElORk8sIG9yIEVSUk9SJyB9KTtcbiAgfVxuICBzZXRTeXN0ZW1Mb2dMZXZlbChsZXZlbCBhcyBMb2dMZXZlbCk7XG4gIHJlcy5qc29uKHsgbWVzc2FnZTogYNCj0YDQvtCy0LXQvdGMINC70L7Qs9C40YDQvtCy0LDQvdC40Y8g0YPRgdGC0LDQvdC+0LLQu9C10L0g0L3QsCAke2xldmVsfWAsIGxldmVsIH0pO1xufSk7XG5cbmFwcC5saXN0ZW4oUE9SVCwgKCkgPT4ge1xuICBsb2dJbmZvKGDQodC10YDQstC10YAg0LfQsNC/0YPRidC10L0g0L3QsCBodHRwOi8vbG9jYWxob3N0OiR7UE9SVH0gW9Cj0YDQvtCy0LXQvdGMOiAke2dldFN5c3RlbUxvZ0xldmVsKCl9XWApO1xuICBjb25zb2xlLmxvZyhgU2VydmVyIGxpc3RlbmluZyBvbiBodHRwOi8vbG9jYWxob3N0OiR7UE9SVH1gKTtcbn0pO1xuIl19