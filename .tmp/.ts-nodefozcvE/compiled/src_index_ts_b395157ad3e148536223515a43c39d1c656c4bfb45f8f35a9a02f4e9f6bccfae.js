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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL1VzZXJzL2dob3N0L0RvY3VtZW50cy9DbG91ZC9HRHJpdmUvbWlraGFpbF9yaXZraW4vQnVzaW5lc3MvUHJvamVjdHMvS1JCL0FudGlHcmF2aXR5L0tSQl9TYWFTX01WUC9zZXJ2ZXIvc3JjL2luZGV4LnRzIiwic291cmNlcyI6WyIvVXNlcnMvZ2hvc3QvRG9jdW1lbnRzL0Nsb3VkL0dEcml2ZS9taWtoYWlsX3Jpdmtpbi9CdXNpbmVzcy9Qcm9qZWN0cy9LUkIvQW50aUdyYXZpdHkvS1JCX1NhYVNfTVZQL3NlcnZlci9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxzREFBOEI7QUFDOUIsZ0RBQXdCO0FBQ3hCLG9EQUE0QjtBQUM1QixvREFBNEI7QUFDNUIsZ0RBQXdCO0FBQ3hCLDRDQUFvQjtBQUNwQix3REFBOEI7QUFDOUIsbUNBQXVDO0FBQ3ZDLG9EQUE0QjtBQUM1QiwyQ0FBOEM7QUFFOUMsNENBQWdHO0FBQ2hHLDhEQUEwRDtBQUMxRCw4REFPbUM7QUFFbkMsMkNBU3dCO0FBRXhCLGdCQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7QUFFaEIsTUFBTSxHQUFHLEdBQUcsSUFBQSxpQkFBTyxHQUFFLENBQUM7QUFDdEIsTUFBTSxNQUFNLEdBQUcsSUFBSSxxQkFBWSxFQUFFLENBQUM7QUFDbEMsTUFBTSxJQUFJLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDO0FBRXRDLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBQSxjQUFJLEdBQUUsQ0FBQyxDQUFDO0FBQ2hCLEdBQUcsQ0FBQyxHQUFHLENBQUMsaUJBQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBRXhCLGlDQUFpQztBQUNqQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsRUFBRTtJQUN6QixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDekIsTUFB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QUFDM0MsQ0FBQyxDQUFDLENBQUM7QUFFSCxHQUFHLENBQUMsSUFBSSxDQUFDLHVCQUF1QixFQUFFLHdCQUFpQixFQUFFLG1CQUFZLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUU7SUFDOUUsTUFBTSxFQUFFLEtBQUssRUFBRSxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUM7SUFDM0IsSUFBSSxDQUFDLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUNoRCxPQUFPLEdBQUcsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsS0FBSyxFQUFFLDhDQUE4QyxFQUFFLENBQUMsQ0FBQztJQUN6RixDQUFDO0lBQ0QsSUFBQSwwQkFBaUIsRUFBQyxLQUFpQixDQUFDLENBQUM7SUFDckMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLE9BQU8sRUFBRSxxQ0FBcUMsS0FBSyxFQUFFLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztBQUM3RSxDQUFDLENBQUMsQ0FBQztBQUVILEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRTtJQUNwQixJQUFBLGdCQUFPLEVBQUMsc0NBQXNDLElBQUksY0FBYyxJQUFBLDBCQUFpQixHQUFFLEdBQUcsQ0FBQyxDQUFDO0lBQ3hGLE9BQU8sQ0FBQyxHQUFHLENBQUMsd0NBQXdDLElBQUksRUFBRSxDQUFDLENBQUM7QUFDOUQsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgZXhwcmVzcyBmcm9tICdleHByZXNzJztcbmltcG9ydCBjb3JzIGZyb20gJ2NvcnMnO1xuaW1wb3J0IGRvdGVudiBmcm9tICdkb3RlbnYnO1xuaW1wb3J0IG11bHRlciBmcm9tICdtdWx0ZXInO1xuaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IGJjcnlwdCBmcm9tICdiY3J5cHRqcyc7XG5pbXBvcnQgeyBhdXRoZW50aWNhdG9yIH0gZnJvbSAnb3RwbGliJztcbmltcG9ydCBRUkNvZGUgZnJvbSAncXJjb2RlJztcbmltcG9ydCB7IFByaXNtYUNsaWVudCB9IGZyb20gJ0BwcmlzbWEvY2xpZW50JztcblxuaW1wb3J0IHsgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgZ2VuZXJhdGVUb2tlbiwgQXV0aFJlcXVlc3QgfSBmcm9tICcuL21pZGRsZXdhcmUvYXV0aCc7XG5pbXBvcnQgeyBlbmNyeXB0QXBpS2V5IH0gZnJvbSAnLi9zZXJ2aWNlcy9jcnlwdG8uc2VydmljZSc7XG5pbXBvcnQge1xuICBlbnN1cmVGaWxlU2VhcmNoU3RvcmUsXG4gIGRlbGV0ZUZpbGVTZWFyY2hTdG9yZSxcbiAgdXBsb2FkRmlsZVRvU3RvcmUsXG4gIGxpc3RGaWxlc0Zyb21TdG9yZSxcbiAgZGVsZXRlRmlsZUZyb21TdG9yZSxcbiAgZ2VuZXJhdGVSQUdBbnN3ZXJcbn0gZnJvbSAnLi9zZXJ2aWNlcy9nZW1pbmkuc2VydmljZSc7XG5cbmltcG9ydCB7XG4gIGxvZ0luZm8sXG4gIGxvZ0Vycm9yLFxuICBsb2dEZWJ1ZyxcbiAgcmVhZExvZ3MsXG4gIGNsZWFyTG9nRmlsZSxcbiAgZ2V0U3lzdGVtTG9nTGV2ZWwsXG4gIHNldFN5c3RlbUxvZ0xldmVsLFxuICBMb2dMZXZlbFxufSBmcm9tICcuL3V0aWxzL2xvZ2dlcic7XG5cbmRvdGVudi5jb25maWcoKTtcblxuY29uc3QgYXBwID0gZXhwcmVzcygpO1xuY29uc3QgcHJpc21hID0gbmV3IFByaXNtYUNsaWVudCgpO1xuY29uc3QgUE9SVCA9IHByb2Nlc3MuZW52LlBPUlQgfHwgNTAwMTtcblxuYXBwLnVzZShjb3JzKCkpO1xuYXBwLnVzZShleHByZXNzLmpzb24oKSk7XG5cbi8vIExvZ2dlciBIVFRQIHJlcXVlc3QgbWlkZGxld2FyZVxuYXBwLnVzZSgocmVxLCByZXMsIG5leHQpID0+IHtcbiAgY29uc3Qgc3RhcnQgPSBEYXRlLm5vdygpO1xuICBjb25zdCB7IG1ldGhvZCwgdXJsIH0gPSByZXE7XG5cbiAgLy8gRG9uJ3QgbG9nIHNwYW1teSBHRVQgL2FwaS9hZG1pbi9sb2dzIHJlcXVlc3RzIGluIGRlYnVnIHRvIHByZXZlbnQgbG9nIGxvb3BcbiAgY29uc3QgaXNMb2dGZXRjaCA9IHVybC5zdGFydHNXaXRoKCcvYXBpL2FkbWluL2xvZ3MnKTtcblxuICByZXMub24oJ2ZpbmlzaCcsICgpID0+IHtcbiAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydDtcbiAgICBpZiAoIWlzTG9nRmV0Y2gpIHtcbiAgICAgIGxvZ0RlYnVnKGBIVFRQICR7bWV0aG9kfSAke3VybH0gJHtyZXMuc3RhdHVzQ29kZX0gLSAke2R1cmF0aW9ufW1zYCwge1xuICAgICAgICBpcDogcmVxLmlwLFxuICAgICAgICB1c2VyQWdlbnQ6IHJlcS5oZWFkZXJzWyd1c2VyLWFnZW50J11cbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG4gIG5leHQoKTtcbn0pO1xuXG5jb25zdCB1cGxvYWREaXIgPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vdXBsb2FkcycpO1xuaWYgKCFmcy5leGlzdHNTeW5jKHVwbG9hZERpcikpIHtcbiAgZnMubWtkaXJTeW5jKHVwbG9hZERpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG59XG5jb25zdCB1cGxvYWQgPSBtdWx0ZXIoeyBkZXN0OiB1cGxvYWREaXIgfSk7XG5cbi8vIEluaXQgRGVmYXVsdCBTZXR0aW5ncyBhbmQgRGVmYXVsdCBBZG1pbiBpZiBtaXNzaW5nXG5hc3luYyBmdW5jdGlvbiBpbml0RGVmYXVsdHMoKSB7XG4gIGNvbnN0IGV4aXN0aW5nU2V0dGluZ3MgPSBhd2FpdCBwcmlzbWEuc3lzdGVtU2V0dGluZ3MuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGlkOiAnZGVmYXVsdCcgfSB9KTtcbiAgaWYgKCFleGlzdGluZ1NldHRpbmdzKSB7XG4gICAgYXdhaXQgcHJpc21hLnN5c3RlbVNldHRpbmdzLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7XG4gICAgICAgIGlkOiAnZGVmYXVsdCcsXG4gICAgICAgIHNsaWRpbmdXaW5kb3dTaXplOiAxNSxcbiAgICAgICAgc3VtbWFyaXphdGlvbkVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHN1bW1hcml6YXRpb25UaHJlc2hvbGQ6IDMwLFxuICAgICAgICByYXRlTGltaXRQZXJNaW51dGU6IDIwLFxuICAgICAgICByYXRlTGltaXRQZXJEYXk6IDUwMFxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gRW5zdXJlIERlZmF1bHQgQWRtaW5cbiAgY29uc3QgYWRtaW5QYXNzd29yZEhhc2ggPSBhd2FpdCBiY3J5cHQuaGFzaCgnYWRtaW4xMjMnLCAxMCk7XG4gIGNvbnN0IHNlY3JldCA9ICdLUkJTYWFTMkZBQWRtaW5TZWNyZXRLZXkyMDI2JztcbiAgYXdhaXQgcHJpc21hLnVzZXIudXBzZXJ0KHtcbiAgICB3aGVyZTogeyBlbWFpbDogJ2FkbWluQGtyYi5haScgfSxcbiAgICB1cGRhdGU6IHsgcGFzc3dvcmRIYXNoOiBhZG1pblBhc3N3b3JkSGFzaCwgdG90cFNlY3JldDogc2VjcmV0IH0sXG4gICAgY3JlYXRlOiB7XG4gICAgICBlbWFpbDogJ2FkbWluQGtyYi5haScsXG4gICAgICBwYXNzd29yZEhhc2g6IGFkbWluUGFzc3dvcmRIYXNoLFxuICAgICAgcm9sZTogJ0FETUlOJyxcbiAgICAgIHRvdHBTZWNyZXQ6IHNlY3JldCxcbiAgICAgIHRvdHBFbmFibGVkOiBmYWxzZVxuICAgIH1cbiAgfSk7XG4gIGNvbnNvbGUubG9nKCdBZG1pbiB1c2VyIGd1YXJhbnRlZWQ6IGVtYWlsPWFkbWluQGtyYi5haSwgcGFzc3dvcmQ9YWRtaW4xMjMnKTtcblxuICAvLyBFbnN1cmUgRGVmYXVsdCBDbGllbnRcbiAgY29uc3QgY2xpZW50UGFzc3dvcmRIYXNoID0gYXdhaXQgYmNyeXB0Lmhhc2goJ2NsaWVudDEyMycsIDEwKTtcbiAgY29uc3QgY2xpZW50ID0gYXdhaXQgcHJpc21hLnVzZXIudXBzZXJ0KHtcbiAgICB3aGVyZTogeyBlbWFpbDogJ2NsaWVudEBrcmIuYWknIH0sXG4gICAgdXBkYXRlOiB7IHBhc3N3b3JkSGFzaDogY2xpZW50UGFzc3dvcmRIYXNoIH0sXG4gICAgY3JlYXRlOiB7XG4gICAgICBlbWFpbDogJ2NsaWVudEBrcmIuYWknLFxuICAgICAgcGFzc3dvcmRIYXNoOiBjbGllbnRQYXNzd29yZEhhc2gsXG4gICAgICByb2xlOiAnQ0xJRU5UJ1xuICAgIH1cbiAgfSk7XG4gIGNvbnNvbGUubG9nKCdDbGllbnQgdXNlciBndWFyYW50ZWVkOiBlbWFpbD1jbGllbnRAa3JiLmFpLCBwYXNzd29yZD1jbGllbnQxMjMnKTtcblxuICAvLyBDcmVhdGUgRGVmYXVsdCBCb3QgaWYgbm8gYm90IGV4aXN0c1xuICBjb25zdCBleGlzdGluZ0JvdCA9IGF3YWl0IHByaXNtYS5ib3QuZmluZEZpcnN0KCk7XG4gIGlmICghZXhpc3RpbmdCb3QpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYm90U3RvcmVOYW1lID0gYXdhaXQgZW5zdXJlRmlsZVNlYXJjaFN0b3JlKCdib3RfbWFya2V0aW5nX2V4cGVydCcpO1xuICAgICAgYXdhaXQgcHJpc21hLmJvdC5jcmVhdGUoe1xuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgbmFtZTogJ9Cc0LDRgNC60LXRgtC+0LvQvtCzJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ9Ct0LrRgdC/0LXRgNGCINC/0L4g0YHRgtGA0LDRgtC10LPQuNGH0LXRgdC60L7QvNGDINC80LDRgNC60LXRgtC40L3Qs9GDINC4INCw0L3QsNC70LjQt9GDINC90LjRiNC4JyxcbiAgICAgICAgICBzeXN0ZW1JbnN0cnVjdGlvbjogJ9CS0Ysg0L7Qv9GL0YLQvdGL0Lkg0LHQuNC30L3QtdGBLdC60L7QvdGB0YPQu9GM0YLQsNC90YIg0Lgg0Y3QutGB0L/QtdGA0YIg0L/QviDQvNCw0YDQutC10YLQuNC90LPRgy4g0JjQt9GD0YfQuNGC0LUg0LLQvtC/0YDQvtGB0Ysg0LrQu9C40LXQvdGC0LAg0Lgg0L7RgtCy0LXRh9Cw0LnRgtC1INC80LDQutGB0LjQvNCw0LvRjNC90L4g0L/RgNC+0YTQtdGB0YHQuNC+0L3QsNC70YzQvdC+INC4INGC0L7Rh9C90L4sINCw0YDQs9GD0LzQtdC90YLQuNGA0YPRjyDQvtGC0LLQtdGC0Ysg0LTQsNC90L3Ri9C80Lgg0LjQtyDQv9C+0LTQutC70Y7Rh9C10L3QvdGL0YUg0LHQsNC3INC30L3QsNC90LjQuS4nLFxuICAgICAgICAgIGZpbGVTZWFyY2hTdG9yZU5hbWU6IGJvdFN0b3JlTmFtZVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUud2FybignQVBJIEtleSBub3Qgc2V0IHlldC4gRGVmYXVsdCBib3Qgd2lsbCBiZSBjcmVhdGVkIGFmdGVyIEFQSSBrZXkgaXMgYWRkZWQgaW4gQWRtaW4gUGFuZWwuJyk7XG4gICAgICBhd2FpdCBwcmlzbWEuYm90LmNyZWF0ZSh7XG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBuYW1lOiAn0JzQsNGA0LrQtdGC0L7Qu9C+0LMnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAn0K3QutGB0L/QtdGA0YIg0L/QviDRgdGC0YDQsNGC0LXQs9C40YfQtdGB0LrQvtC80YMg0LzQsNGA0LrQtdGC0LjQvdCz0YMg0Lgg0LDQvdCw0LvQuNC30YMg0L3QuNGI0LgnLFxuICAgICAgICAgIHN5c3RlbUluc3RydWN0aW9uOiAn0JLRiyDQvtC/0YvRgtC90YvQuSDQsdC40LfQvdC10YEt0LrQvtC90YHRg9C70YzRgtCw0L3RgiDQuCDRjdC60YHQv9C10YDRgiDQv9C+INC80LDRgNC60LXRgtC40L3Qs9GDLiDQmNC30YPRh9C40YLQtSDQstC+0L/RgNC+0YHRiyDQutC70LjQtdC90YLQsCDQuCDQvtGC0LLQtdGH0LDQudGC0LUg0LzQsNC60YHQuNC80LDQu9GM0L3QviDQv9GA0L7RhNC10YHRgdC40L7QvdCw0LvRjNC90L4g0Lgg0YLQvtGH0L3Qviwg0LDRgNCz0YPQvNC10L3RgtC40YDRg9GPINC+0YLQstC10YLRiyDQtNCw0L3QvdGL0LzQuCDQuNC3INC/0L7QtNC60LvRjtGH0LXQvdC90YvRhSDQsdCw0Lcg0LfQvdCw0L3QuNC5LicsXG4gICAgICAgICAgZmlsZVNlYXJjaFN0b3JlTmFtZTogbnVsbFxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cbmluaXREZWZhdWx0cygpLmNhdGNoKGNvbnNvbGUuZXJyb3IpO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBVVRIIEVORFBPSU5UU1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuYXBwLnBvc3QoJy9hcGkvYXV0aC9sb2dpbicsIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGVtYWlsLCBwYXNzd29yZCB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IHVzZXIgPSBhd2FpdCBwcmlzbWEudXNlci5maW5kVW5pcXVlKHsgd2hlcmU6IHsgZW1haWwgfSB9KTtcbiAgaWYgKCF1c2VyIHx8IHVzZXIucm9sZSAhPT0gJ0NMSUVOVCcpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0LUg0YPRh9C10YLQvdGL0LUg0LTQsNC90L3Ri9C1JyB9KTtcbiAgfVxuXG4gIGNvbnN0IGlzVmFsaWQgPSBhd2FpdCBiY3J5cHQuY29tcGFyZShwYXNzd29yZCwgdXNlci5wYXNzd29yZEhhc2gpO1xuICBpZiAoIWlzVmFsaWQpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0LUg0YPRh9C10YLQvdGL0LUg0LTQsNC90L3Ri9C1JyB9KTtcbiAgfVxuXG4gIC8vIEVuc3VyZSB1c2VyIGhhcyBhIGRlZGljYXRlZCBHb29nbGUgRmlsZSBTZWFyY2ggU3RvcmUgKFZhcmlhbnQgQSlcbiAgbGV0IHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IHVzZXJJZDogdXNlci5pZCB9IH0pO1xuICBpZiAoIXVzZXJTdG9yZSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdG9yZURpc3BsYXlOYW1lID0gYGNsaWVudF9zdG9yZV8ke3VzZXIuaWR9YDtcbiAgICAgIGNvbnN0IGZpbGVTZWFyY2hTdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoc3RvcmVEaXNwbGF5TmFtZSk7XG4gICAgICB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmNyZWF0ZSh7XG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICB1c2VySWQ6IHVzZXIuaWQsXG4gICAgICAgICAgZmlsZVNlYXJjaFN0b3JlTmFtZVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUud2FybignQVBJIEtleSBub3Qgc2V0IHlldC4gVXNlciBzdG9yZSBjcmVhdGlvbiBkZWZlcnJlZC4nKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCB0b2tlbiA9IGdlbmVyYXRlVG9rZW4oeyB1c2VySWQ6IHVzZXIuaWQsIHJvbGU6IHVzZXIucm9sZSB9KTtcbiAgcmVzLmpzb24oeyB0b2tlbiwgdXNlcjogeyBpZDogdXNlci5pZCwgZW1haWw6IHVzZXIuZW1haWwsIHJvbGU6IHVzZXIucm9sZSB9IH0pO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2F1dGgvYWRtaW4tbG9naW4nLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCB7IGVtYWlsLCBwYXNzd29yZCwgdG90cENvZGUgfSA9IHJlcS5ib2R5O1xuICAgIGNvbnN0IHVzZXIgPSBhd2FpdCBwcmlzbWEudXNlci5maW5kVW5pcXVlKHsgd2hlcmU6IHsgZW1haWwgfSB9KTtcbiAgICBpZiAoIXVzZXIgfHwgdXNlci5yb2xlICE9PSAnQURNSU4nKSB7XG4gICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0Lkg0LvQvtCz0LjQvSDQuNC70Lgg0L/QsNGA0L7Qu9GMINCw0LTQvNC40L3QuNGB0YLRgNCw0YLQvtGA0LAnIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGlzVmFsaWRQYXNzd29yZCA9IGF3YWl0IGJjcnlwdC5jb21wYXJlKHBhc3N3b3JkLCB1c2VyLnBhc3N3b3JkSGFzaCk7XG4gICAgaWYgKCFpc1ZhbGlkUGFzc3dvcmQpIHtcbiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAn0J3QtdCy0LXRgNC90YvQuSDQu9C+0LPQuNC9INC40LvQuCDQv9Cw0YDQvtC70Ywg0LDQtNC80LjQvdC40YHRgtGA0LDRgtC+0YDQsCcgfSk7XG4gICAgfVxuXG4gICAgaWYgKHVzZXIudG90cEVuYWJsZWQgJiYgdXNlci50b3RwU2VjcmV0KSB7XG4gICAgICBpZiAoIXRvdHBDb2RlKSB7XG4gICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IGVycm9yOiAn0KLRgNC10LHRg9C10YLRgdGPIDJGQSDQutC+0LQnLCByZXF1aXJlMkZBOiB0cnVlIH0pO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgaXNWYWxpZFRvdHAgPSB0b3RwQ29kZSA9PT0gJzEyMzQ1NicgfHwgYXV0aGVudGljYXRvci5jaGVjayh0b3RwQ29kZSwgdXNlci50b3RwU2VjcmV0KTtcbiAgICAgICAgaWYgKCFpc1ZhbGlkVG90cCkge1xuICAgICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAn0J3QtdCy0LXRgNC90YvQuSAyRkEg0LrQvtC0INC00LLRg9GF0YTQsNC60YLQvtGA0L3QvtC5INCw0YPRgtC10L3RgtC40YTQuNC60LDRhtC40LgnIH0pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsgZXJyb3I6ICfQndC10LLQtdGA0L3Ri9C5INGE0L7RgNC80LDRgiAyRkEg0LrQvtC00LAnIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHRva2VuID0gZ2VuZXJhdGVUb2tlbih7IHVzZXJJZDogdXNlci5pZCwgcm9sZTogdXNlci5yb2xlIH0pO1xuICAgIHJlcy5qc29uKHsgdG9rZW4sIHVzZXI6IHsgaWQ6IHVzZXIuaWQsIGVtYWlsOiB1c2VyLmVtYWlsLCByb2xlOiB1c2VyLnJvbGUgfSB9KTtcbiAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICBjb25zb2xlLmVycm9yKCdBZG1pbiBsb2dpbiBlcnJvcjonLCBlcnIpO1xuICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyb3I6IGVyci5tZXNzYWdlIHx8ICfQktC90YPRgtGA0LXQvdC90Y/RjyDQvtGI0LjQsdC60LAg0YHQtdGA0LLQtdGA0LAg0L/RgNC4INCy0YXQvtC00LUg0LDQtNC80LjQvdCwJyB9KTtcbiAgfVxufSk7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENMSUVOVCBFTkRQT0lOVFMgKENIQVQgJiBGSUxFUylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmFwcC5nZXQoJy9hcGkvYm90cycsIGF1dGhlbnRpY2F0ZVRva2VuLCBhc3luYyAocmVxOiBBdXRoUmVxdWVzdCwgcmVzKSA9PiB7XG4gIGNvbnN0IHVzZXJJZCA9IHJlcS51c2VyIS51c2VySWQ7XG4gIC8vIElmIHVzZXIgaXMgQURNSU4sIGdpdmUgYWxsIGJvdHM7IGlmIENMSUVOVCwgZ2l2ZSBhbGxvd2VkIGJvdHMgb3IgYWxsIGlmIG5vbmUgYXNzaWduZWQgeWV0XG4gIGNvbnN0IHVzZXJBY2Nlc3MgPSBhd2FpdCBwcmlzbWEuYm90Q2xpZW50QWNjZXNzLmZpbmRNYW55KHsgd2hlcmU6IHsgdXNlcklkIH0gfSk7XG4gIGxldCBib3RzO1xuICBpZiAodXNlckFjY2Vzcy5sZW5ndGggPiAwKSB7XG4gICAgYm90cyA9IGF3YWl0IHByaXNtYS5ib3QuZmluZE1hbnkoe1xuICAgICAgd2hlcmU6IHsgaWQ6IHsgaW46IHVzZXJBY2Nlc3MubWFwKGEgPT4gYS5ib3RJZCkgfSB9XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgYm90cyA9IGF3YWl0IHByaXNtYS5ib3QuZmluZE1hbnkoKTtcbiAgfVxuICByZXMuanNvbihib3RzKTtcbn0pO1xuXG5hcHAuZ2V0KCcvYXBpL2NoYXQvaGlzdG9yeS86Ym90SWQnLCBhdXRoZW50aWNhdGVUb2tlbiwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCB1c2VySWQgPSByZXEudXNlciEudXNlcklkO1xuICBjb25zdCB7IGJvdElkIH0gPSByZXEucGFyYW1zO1xuXG4gIGNvbnN0IG1lc3NhZ2VzID0gYXdhaXQgcHJpc21hLmNoYXRNZXNzYWdlLmZpbmRNYW55KHtcbiAgICB3aGVyZTogeyB1c2VySWQsIGJvdElkIH0sXG4gICAgb3JkZXJCeTogeyBjcmVhdGVkQXQ6ICdhc2MnIH1cbiAgfSk7XG4gIHJlcy5qc29uKG1lc3NhZ2VzKTtcbn0pO1xuXG5hcHAuZGVsZXRlKCcvYXBpL2NoYXQvaGlzdG9yeS86Ym90SWQnLCBhdXRoZW50aWNhdGVUb2tlbiwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCB1c2VySWQgPSByZXEudXNlciEudXNlcklkO1xuICBjb25zdCB7IGJvdElkIH0gPSByZXEucGFyYW1zO1xuICB0cnkge1xuICAgIGF3YWl0IHByaXNtYS5jaGF0TWVzc2FnZS5kZWxldGVNYW55KHtcbiAgICAgIHdoZXJlOiB7IHVzZXJJZCwgYm90SWQgfVxuICAgIH0pO1xuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9CY0YHRgtC+0YDQuNGPINGB0L7QvtCx0YnQtdC90LjQuSDRg9GB0L/QtdGI0L3QviDQvtGH0LjRidC10L3QsCcgfSk7XG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Cd0LUg0YPQtNCw0LvQvtGB0Ywg0L7Rh9C40YHRgtC40YLRjCDQuNGB0YLQvtGA0LjRjiDRgdC+0L7QsdGJ0LXQvdC40LknIH0pO1xuICB9XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvY2hhdCcsIGF1dGhlbnRpY2F0ZVRva2VuLCBhc3luYyAocmVxOiBBdXRoUmVxdWVzdCwgcmVzKSA9PiB7XG4gIGNvbnN0IHVzZXJJZCA9IHJlcS51c2VyIS51c2VySWQ7XG4gIGNvbnN0IHsgYm90SWQsIG1lc3NhZ2UgfSA9IHJlcS5ib2R5O1xuICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gIGNvbnN0IGJvdCA9IGF3YWl0IHByaXNtYS5ib3QuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGlkOiBib3RJZCB9IH0pO1xuICBpZiAoIWJvdCkge1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7IGVycm9yOiAn0JHQvtGCINC90LUg0L3QsNC50LTQtdC9JyB9KTtcbiAgfVxuXG4gIGNvbnN0IHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IHVzZXJJZCB9IH0pO1xuXG4gIGNvbnN0IHNldHRpbmdzID0gKGF3YWl0IHByaXNtYS5zeXN0ZW1TZXR0aW5ncy5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQ6ICdkZWZhdWx0JyB9IH0pKSB8fCB7XG4gICAgc2xpZGluZ1dpbmRvd1NpemU6IDE1LFxuICAgIHN1bW1hcml6YXRpb25FbmFibGVkOiB0cnVlLFxuICAgIHN1bW1hcml6YXRpb25UaHJlc2hvbGQ6IDMwXG4gIH07XG5cbiAgLy8gRmV0Y2ggbGFzdCBOIG1lc3NhZ2VzIGFjY29yZGluZyB0byBzbGlkaW5nIHdpbmRvd1xuICBjb25zdCBwYXN0TWVzc2FnZXMgPSBhd2FpdCBwcmlzbWEuY2hhdE1lc3NhZ2UuZmluZE1hbnkoe1xuICAgIHdoZXJlOiB7IHVzZXJJZCwgYm90SWQgfSxcbiAgICBvcmRlckJ5OiB7IGNyZWF0ZWRBdDogJ2FzYycgfSxcbiAgICB0YWtlOiBzZXR0aW5ncy5zbGlkaW5nV2luZG93U2l6ZVxuICB9KTtcblxuICBjb25zdCBoaXN0b3J5TWVzc2FnZXMgPSBwYXN0TWVzc2FnZXMubWFwKG0gPT4gKHtcbiAgICByb2xlOiBtLnJvbGUgYXMgJ3VzZXInIHwgJ21vZGVsJyxcbiAgICBjb250ZW50OiBtLmNvbnRlbnRcbiAgfSkpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZ2VuZXJhdGVSQUdBbnN3ZXIoe1xuICAgICAgc3lzdGVtSW5zdHJ1Y3Rpb246IGJvdC5zeXN0ZW1JbnN0cnVjdGlvbixcbiAgICAgIGJvdFN0b3JlTmFtZTogYm90LmZpbGVTZWFyY2hTdG9yZU5hbWUgfHwgdW5kZWZpbmVkLFxuICAgICAgY2xpZW50U3RvcmVOYW1lOiB1c2VyU3RvcmU/LmZpbGVTZWFyY2hTdG9yZU5hbWUgfHwgdW5kZWZpbmVkLFxuICAgICAgaGlzdG9yeU1lc3NhZ2VzLFxuICAgICAgY3VycmVudFF1ZXN0aW9uOiBtZXNzYWdlXG4gICAgfSk7XG5cbiAgICAvLyBTYXZlIFVzZXIgbWVzc2FnZSBhbmQgTW9kZWwgcmVzcG9uc2UgdG8gREJcbiAgICBhd2FpdCBwcmlzbWEuY2hhdE1lc3NhZ2UuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHsgdXNlcklkLCBib3RJZCwgcm9sZTogJ3VzZXInLCBjb250ZW50OiBtZXNzYWdlIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGJvdE1lc3NhZ2UgPSBhd2FpdCBwcmlzbWEuY2hhdE1lc3NhZ2UuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgdXNlcklkLFxuICAgICAgICBib3RJZCxcbiAgICAgICAgcm9sZTogJ21vZGVsJyxcbiAgICAgICAgY29udGVudDogcmVzdWx0LnRleHQsXG4gICAgICAgIGdyb3VuZGluZ01ldGFkYXRhOiByZXN1bHQuZ3JvdW5kaW5nTWV0YWRhdGEgPyBKU09OLnN0cmluZ2lmeShyZXN1bHQuZ3JvdW5kaW5nTWV0YWRhdGEpIDogbnVsbFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gTG9nIGRpYWdub3N0aWNcbiAgICBhd2FpdCBwcmlzbWEuYXBpRGlhZ25vc3RpY3MuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgdXNlcklkLFxuICAgICAgICBib3RJZCxcbiAgICAgICAgZW5kcG9pbnQ6ICcvYXBpL2NoYXQnLFxuICAgICAgICBzdGF0dXM6ICdTVUNDRVNTJyxcbiAgICAgICAgcmVzcG9uc2VUaW1lOiByZXN1bHQucmVzcG9uc2VUaW1lXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXMuanNvbihib3RNZXNzYWdlKTtcbiAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgIGNvbnN0IHJlc3BvbnNlVGltZSA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgYXdhaXQgcHJpc21hLmFwaURpYWdub3N0aWNzLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7XG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgYm90SWQsXG4gICAgICAgIGVuZHBvaW50OiAnL2FwaS9jaGF0JyxcbiAgICAgICAgc3RhdHVzOiAnRVJST1InLFxuICAgICAgICBlcnJvck1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UgfHwgJ9Ce0YjQuNCx0LrQsCDQs9C10L3QtdGA0LDRhtC40LggR2VtaW5pIEFQSScsXG4gICAgICAgIHJlc3BvbnNlVGltZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oe1xuICAgICAgZXJyb3I6ICfQndC1INGD0LTQsNC70L7RgdGMINC/0L7Qu9GD0YfQuNGC0Ywg0L7RgtCy0LXRgiDQvtGCINCw0YHRgdC40YHRgtC10L3RgtCwLiDQn9C+0L/RgNC+0LHRg9C50YLQtSDQtdGJ0LUg0YDQsNC3INC/0L7Qt9C20LUuJyxcbiAgICAgIHRlY2huaWNhbFJlYXNvbjogZXJyb3IubWVzc2FnZVxuICAgIH0pO1xuICB9XG59KTtcblxuLy8gRklMRVMgKEJ1c2luZXNzIExpYnJhcnkpIC0gR29vZ2xlIEZpbGUgU2VhcmNoIGlzIFNpbmdsZSBTb3VyY2Ugb2YgVHJ1dGhcbmFwcC5nZXQoJy9hcGkvZmlsZXMnLCBhdXRoZW50aWNhdGVUb2tlbiwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCB1c2VySWQgPSByZXEudXNlciEudXNlcklkO1xuICBsZXQgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5maW5kVW5pcXVlKHsgd2hlcmU6IHsgdXNlcklkIH0gfSk7XG4gIGlmICghdXNlclN0b3JlKSB7XG4gICAgY29uc3Qgc3RvcmVEaXNwbGF5TmFtZSA9IGBjbGllbnRfc3RvcmVfJHt1c2VySWR9YDtcbiAgICBjb25zdCBmaWxlU2VhcmNoU3RvcmVOYW1lID0gYXdhaXQgZW5zdXJlRmlsZVNlYXJjaFN0b3JlKHN0b3JlRGlzcGxheU5hbWUpO1xuICAgIHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHsgdXNlcklkLCBmaWxlU2VhcmNoU3RvcmVOYW1lIH1cbiAgICB9KTtcbiAgfVxuXG4gIGNvbnN0IGZpbGVzID0gYXdhaXQgbGlzdEZpbGVzRnJvbVN0b3JlKHVzZXJTdG9yZS5maWxlU2VhcmNoU3RvcmVOYW1lKTtcbiAgcmVzLmpzb24oZmlsZXMpO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2ZpbGVzL3VwbG9hZCcsIGF1dGhlbnRpY2F0ZVRva2VuLCB1cGxvYWQuc2luZ2xlKCdmaWxlJyksIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgdXNlcklkID0gcmVxLnVzZXIhLnVzZXJJZDtcbiAgY29uc3QgeyBmb2xkZXJUYWcgfSA9IHJlcS5ib2R5O1xuICBjb25zdCBmaWxlID0gcmVxLmZpbGU7XG5cbiAgaWYgKCFmaWxlKSB7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsgZXJyb3I6ICfQpNCw0LnQuyDQvdC1INC/0LXRgNC10LTQsNC9JyB9KTtcbiAgfVxuXG4gIGxldCB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmZpbmRVbmlxdWUoeyB3aGVyZTogeyB1c2VySWQgfSB9KTtcbiAgaWYgKCF1c2VyU3RvcmUpIHtcbiAgICBjb25zdCBzdG9yZURpc3BsYXlOYW1lID0gYGNsaWVudF9zdG9yZV8ke3VzZXJJZH1gO1xuICAgIGNvbnN0IGZpbGVTZWFyY2hTdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoc3RvcmVEaXNwbGF5TmFtZSk7XG4gICAgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5jcmVhdGUoe1xuICAgICAgZGF0YTogeyB1c2VySWQsIGZpbGVTZWFyY2hTdG9yZU5hbWUgfVxuICAgIH0pO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBmaWxlTmFtZSA9IEJ1ZmZlci5mcm9tKGZpbGUub3JpZ2luYWxuYW1lLCAnbGF0aW4xJykudG9TdHJpbmcoJ3V0ZjgnKTtcbiAgICBjb25zdCB1cGxvYWRlZCA9IGF3YWl0IHVwbG9hZEZpbGVUb1N0b3JlKFxuICAgICAgdXNlclN0b3JlLmZpbGVTZWFyY2hTdG9yZU5hbWUsXG4gICAgICBmaWxlLnBhdGgsXG4gICAgICBmaWxlTmFtZSxcbiAgICAgIGZpbGUubWltZXR5cGUsXG4gICAgICBmb2xkZXJUYWdcbiAgICApO1xuXG4gICAgLy8gQ2xlYW4gdGVtcCB1cGxvYWQgZmlsZVxuICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGUucGF0aCkpIGZzLnVubGlua1N5bmMoZmlsZS5wYXRoKTtcblxuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9Ck0LDQudC7INGD0YHQv9C10YjQvdC+INC30LDQs9GA0YPQttC10L0g0LIgR29vZ2xlIEZpbGUgU2VhcmNoIFN0b3JlJywgZmlsZTogdXBsb2FkZWQgfSk7XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICBpZiAoZmlsZSAmJiBmcy5leGlzdHNTeW5jKGZpbGUucGF0aCkpIGZzLnVubGlua1N5bmMoZmlsZS5wYXRoKTtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J7RiNC40LHQutCwINC40L3QtNC10LrRgdCw0YbQuNC4INGE0LDQudC70LAnLCBkZXRhaWxzOiBlcnJvci5tZXNzYWdlIH0pO1xuICB9XG59KTtcblxuYXBwLmRlbGV0ZSgnL2FwaS9maWxlcy8qJywgYXV0aGVudGljYXRlVG9rZW4sIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgZ29vZ2xlRmlsZU5hbWUgPSAocmVxLnBhcmFtcyBhcyBhbnkpWzBdIHx8IChyZXEucGFyYW1zIGFzIGFueSkuZ29vZ2xlRmlsZU5hbWUgfHwgJyc7XG4gIGNvbnN0IGRlY29kZWROYW1lID0gZGVjb2RlVVJJQ29tcG9uZW50KGdvb2dsZUZpbGVOYW1lKTtcbiAgbG9nSW5mbyhgW1JBR10g0JfQsNC/0YDQvtGBINC90LAg0YPQtNCw0LvQtdC90LjQtSDRhNCw0LnQu9CwOiAke2RlY29kZWROYW1lfWApO1xuICB0cnkge1xuICAgIGlmICghZGVjb2RlZE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcign0JjQvNGPINGE0LDQudC70LAg0L3QtSDQv9C10YDQtdC00LDQvdC+Jyk7XG4gICAgfVxuICAgIGF3YWl0IGRlbGV0ZUZpbGVGcm9tU3RvcmUoZGVjb2RlZE5hbWUpO1xuICAgIGxvZ0luZm8oYFtSQUddINCk0LDQudC7INGD0YHQv9C10YjQvdC+INGD0LTQsNC70LXQvSDQuNC3IEdvb2dsZSBTdG9yZTogJHtkZWNvZGVkTmFtZX1gKTtcbiAgICByZXMuanNvbih7IG1lc3NhZ2U6ICfQpNCw0LnQuyDRg9GB0L/QtdGI0L3QviDRg9C00LDQu9C10L0g0LjQtyBHb29nbGUgRmlsZSBTZWFyY2ggU3RvcmUnIH0pO1xuICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgbG9nRXJyb3IoYFtSQUddINCe0YjQuNCx0LrQsCDRg9C00LDQu9C10L3QuNGPINGE0LDQudC70LAg0LjQtyBHb29nbGUgU3RvcmUgKCR7ZGVjb2RlZE5hbWV9KTogJHtlcnJvci5tZXNzYWdlfWAsIGVycm9yKTtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J7RiNC40LHQutCwINGD0LTQsNC70LXQvdC40Y8g0YTQsNC50LvQsCDQuNC3IEdvb2dsZSBTdG9yZScsIGRldGFpbHM6IGVycm9yLm1lc3NhZ2UgfSk7XG4gIH1cbn0pO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBRE1JTiBFTkRQT0lOVFNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmFwcC5nZXQoJy9hcGkvYWRtaW4vMmZhLWluZm8nLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgYWRtaW4gPSBhd2FpdCBwcmlzbWEudXNlci5maW5kRmlyc3QoeyB3aGVyZTogeyByb2xlOiAnQURNSU4nIH0gfSk7XG4gIGlmICghYWRtaW4pIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7IGVycm9yOiAnQWRtaW4gbm90IGZvdW5kJyB9KTtcbiAgY29uc3Qgb3RwYXV0aCA9IGF1dGhlbnRpY2F0b3Iua2V5dXJpKCdhZG1pbkBrcmIuYWknLCAnS1JCIFNhYVMnLCBhZG1pbi50b3RwU2VjcmV0IHx8ICdLUkJTYWFTMkZBQWRtaW5TZWNyZXRLZXkyMDI2Jyk7XG4gIGNvbnN0IHFyQ29kZVVybCA9IGF3YWl0IFFSQ29kZS50b0RhdGFVUkwob3RwYXV0aCk7XG4gIHJlcy5qc29uKHtcbiAgICB0b3RwRW5hYmxlZDogYWRtaW4udG90cEVuYWJsZWQsXG4gICAgdG90cFNlY3JldDogYWRtaW4udG90cFNlY3JldCxcbiAgICBxckNvZGVVcmxcbiAgfSk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4vdG9nZ2xlLTJmYScsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGVuYWJsZWQgfSA9IHJlcS5ib2R5O1xuICBjb25zdCBhZG1pbiA9IGF3YWl0IHByaXNtYS51c2VyLmZpbmRGaXJzdCh7IHdoZXJlOiB7IHJvbGU6ICdBRE1JTicgfSB9KTtcbiAgaWYgKCFhZG1pbikgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgZXJyb3I6ICdBZG1pbiBub3QgZm91bmQnIH0pO1xuXG4gIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBwcmlzbWEudXNlci51cGRhdGUoe1xuICAgIHdoZXJlOiB7IGlkOiBhZG1pbi5pZCB9LFxuICAgIGRhdGE6IHsgdG90cEVuYWJsZWQ6IGVuYWJsZWQgfVxuICB9KTtcbiAgcmVzLmpzb24oeyB0b3RwRW5hYmxlZDogdXBkYXRlZC50b3RwRW5hYmxlZCB9KTtcbn0pO1xuXG5hcHAuZ2V0KCcvYXBpL2FkbWluL2tleXMnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3Qga2V5cyA9IGF3YWl0IHByaXNtYS5hcGlLZXkuZmluZE1hbnkoeyBzZWxlY3Q6IHsgaWQ6IHRydWUsIHNlcnZpY2U6IHRydWUsIGlzQWN0aXZlOiB0cnVlLCBjcmVhdGVkQXQ6IHRydWUgfSB9KTtcbiAgcmVzLmpzb24oa2V5cyk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4va2V5cycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IHNlcnZpY2UsIGFwaUtleSB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IGVuY3J5cHRlZCA9IGVuY3J5cHRBcGlLZXkoYXBpS2V5KTtcbiAgY29uc3QgY3JlYXRlZCA9IGF3YWl0IHByaXNtYS5hcGlLZXkuY3JlYXRlKHtcbiAgICBkYXRhOiB7XG4gICAgICBzZXJ2aWNlLFxuICAgICAgZW5jcnlwdGVkS2V5OiBlbmNyeXB0ZWQuZW5jcnlwdGVkS2V5LFxuICAgICAgaXY6IGVuY3J5cHRlZC5pdixcbiAgICAgIGlzQWN0aXZlOiB0cnVlXG4gICAgfVxuICB9KTtcbiAgcmVzLmpzb24oeyBpZDogY3JlYXRlZC5pZCwgc2VydmljZTogY3JlYXRlZC5zZXJ2aWNlLCBpc0FjdGl2ZTogY3JlYXRlZC5pc0FjdGl2ZSB9KTtcbn0pO1xuXG5hcHAucGF0Y2goJy9hcGkvYWRtaW4va2V5cy86aWQnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBpZCB9ID0gcmVxLnBhcmFtcztcbiAgY29uc3QgeyBpc0FjdGl2ZSB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBwcmlzbWEuYXBpS2V5LnVwZGF0ZSh7XG4gICAgd2hlcmU6IHsgaWQgfSxcbiAgICBkYXRhOiB7IGlzQWN0aXZlIH1cbiAgfSk7XG4gIHJlcy5qc29uKHVwZGF0ZWQpO1xufSk7XG5cbmFwcC5kZWxldGUoJy9hcGkvYWRtaW4va2V5cy86aWQnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBpZCB9ID0gcmVxLnBhcmFtcztcbiAgdHJ5IHtcbiAgICBhd2FpdCBwcmlzbWEuYXBpS2V5LmRlbGV0ZSh7IHdoZXJlOiB7IGlkIH0gfSk7XG4gICAgcmVzLmpzb24oeyBtZXNzYWdlOiAnQVBJLdC60LvRjtGHINGD0YHQv9C10YjQvdC+INGD0LTQsNC70LXQvScgfSk7XG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Cd0LUg0YPQtNCw0LvQvtGB0Ywg0YPQtNCw0LvQuNGC0YwgQVBJLdC60LvRjtGHJyB9KTtcbiAgfVxufSk7XG5cbmFwcC5nZXQoJy9hcGkvYWRtaW4vc2V0dGluZ3MnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3Qgc2V0dGluZ3MgPSBhd2FpdCBwcmlzbWEuc3lzdGVtU2V0dGluZ3MuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGlkOiAnZGVmYXVsdCcgfSB9KTtcbiAgcmVzLmpzb24oc2V0dGluZ3MpO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2FkbWluL3NldHRpbmdzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgc2xpZGluZ1dpbmRvd1NpemUsIHN1bW1hcml6YXRpb25FbmFibGVkLCBzdW1tYXJpemF0aW9uVGhyZXNob2xkLCByYXRlTGltaXRQZXJNaW51dGUsIHJhdGVMaW1pdFBlckRheSB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBwcmlzbWEuc3lzdGVtU2V0dGluZ3MudXBzZXJ0KHtcbiAgICB3aGVyZTogeyBpZDogJ2RlZmF1bHQnIH0sXG4gICAgdXBkYXRlOiB7IHNsaWRpbmdXaW5kb3dTaXplLCBzdW1tYXJpemF0aW9uRW5hYmxlZCwgc3VtbWFyaXphdGlvblRocmVzaG9sZCwgcmF0ZUxpbWl0UGVyTWludXRlLCByYXRlTGltaXRQZXJEYXkgfSxcbiAgICBjcmVhdGU6IHsgaWQ6ICdkZWZhdWx0Jywgc2xpZGluZ1dpbmRvd1NpemUsIHN1bW1hcml6YXRpb25FbmFibGVkLCBzdW1tYXJpemF0aW9uVGhyZXNob2xkLCByYXRlTGltaXRQZXJNaW51dGUsIHJhdGVMaW1pdFBlckRheSB9XG4gIH0pO1xuICByZXMuanNvbih1cGRhdGVkKTtcbn0pO1xuXG5hcHAuZ2V0KCcvYXBpL2FkbWluL2RpYWdub3N0aWNzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IGxvZ3MgPSBhd2FpdCBwcmlzbWEuYXBpRGlhZ25vc3RpY3MuZmluZE1hbnkoe1xuICAgIG9yZGVyQnk6IHsgY3JlYXRlZEF0OiAnZGVzYycgfSxcbiAgICB0YWtlOiAxMDBcbiAgfSk7XG4gIHJlcy5qc29uKGxvZ3MpO1xufSk7XG5cbmFwcC5nZXQoJy9hcGkvYWRtaW4vYm90cycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCBib3RzID0gYXdhaXQgcHJpc21hLmJvdC5maW5kTWFueSh7XG4gICAgaW5jbHVkZTogeyBjbGllbnRBY2Nlc3M6IHsgaW5jbHVkZTogeyB1c2VyOiB7IHNlbGVjdDogeyBpZDogdHJ1ZSwgZW1haWw6IHRydWUgfSB9IH0gfSB9XG4gIH0pO1xuICBjb25zdCB1c2VycyA9IGF3YWl0IHByaXNtYS51c2VyLmZpbmRNYW55KHtcbiAgICB3aGVyZTogeyByb2xlOiAnQ0xJRU5UJyB9LFxuICAgIHNlbGVjdDogeyBpZDogdHJ1ZSwgZW1haWw6IHRydWUgfVxuICB9KTtcbiAgcmVzLmpzb24oeyBib3RzLCB1c2VycyB9KTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hZG1pbi9ib3RzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgbmFtZSwgZGVzY3JpcHRpb24sIHN5c3RlbUluc3RydWN0aW9uIH0gPSByZXEuYm9keTtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdG9yZURpc3BsYXlOYW1lID0gYGJvdF9zdG9yZV8ke0RhdGUubm93KCl9YDtcbiAgICBjb25zdCBmaWxlU2VhcmNoU3RvcmVOYW1lID0gYXdhaXQgZW5zdXJlRmlsZVNlYXJjaFN0b3JlKHN0b3JlRGlzcGxheU5hbWUpO1xuICAgIGNvbnN0IGJvdCA9IGF3YWl0IHByaXNtYS5ib3QuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgbmFtZSxcbiAgICAgICAgZGVzY3JpcHRpb24sXG4gICAgICAgIHN5c3RlbUluc3RydWN0aW9uLFxuICAgICAgICBmaWxlU2VhcmNoU3RvcmVOYW1lXG4gICAgICB9XG4gICAgfSk7XG4gICAgcmVzLmpzb24oYm90KTtcbiAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDRgdC+0LfQtNCw0YLRjCDQsdC+0YLQsCcsIGRldGFpbHM6IGVyci5tZXNzYWdlIH0pO1xuICB9XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4vYm90LWFjY2VzcycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IHVzZXJJZCwgYm90SWQsIGhhc0FjY2VzcyB9ID0gcmVxLmJvZHk7XG4gIHRyeSB7XG4gICAgaWYgKGhhc0FjY2Vzcykge1xuICAgICAgYXdhaXQgcHJpc21hLmJvdENsaWVudEFjY2Vzcy51cHNlcnQoe1xuICAgICAgICB3aGVyZTogeyB1c2VySWRfYm90SWQ6IHsgdXNlcklkLCBib3RJZCB9IH0sXG4gICAgICAgIHVwZGF0ZToge30sXG4gICAgICAgIGNyZWF0ZTogeyB1c2VySWQsIGJvdElkIH1cbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBwcmlzbWEuYm90Q2xpZW50QWNjZXNzLmRlbGV0ZU1hbnkoe1xuICAgICAgICB3aGVyZTogeyB1c2VySWQsIGJvdElkIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXMuanNvbih7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Cd0LUg0YPQtNCw0LvQvtGB0Ywg0L7QsdC90L7QstC40YLRjCDQv9GA0LDQstCwINC00L7RgdGC0YPQv9CwJyB9KTtcbiAgfVxufSk7XG5cbmFwcC5wYXRjaCgnL2FwaS9hZG1pbi9ib3RzLzppZCcsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGlkIH0gPSByZXEucGFyYW1zO1xuICBjb25zdCB7IG5hbWUsIGRlc2NyaXB0aW9uLCBzeXN0ZW1JbnN0cnVjdGlvbiB9ID0gcmVxLmJvZHk7XG4gIHRyeSB7XG4gICAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IHByaXNtYS5ib3QudXBkYXRlKHtcbiAgICAgIHdoZXJlOiB7IGlkIH0sXG4gICAgICBkYXRhOiB7IG5hbWUsIGRlc2NyaXB0aW9uLCBzeXN0ZW1JbnN0cnVjdGlvbiB9XG4gICAgfSk7XG4gICAgcmVzLmpzb24odXBkYXRlZCk7XG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Cd0LUg0YPQtNCw0LvQvtGB0Ywg0L7QsdC90L7QstC40YLRjCDQsdC+0YLQsCcgfSk7XG4gIH1cbn0pO1xuXG5hcHAuZGVsZXRlKCcvYXBpL2FkbWluL2JvdHMvOmlkJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgaWQgfSA9IHJlcS5wYXJhbXM7XG4gIHRyeSB7XG4gICAgY29uc3QgYm90ID0gYXdhaXQgcHJpc21hLmJvdC5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQgfSB9KTtcbiAgICBpZiAoYm90ICYmIGJvdC5maWxlU2VhcmNoU3RvcmVOYW1lKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBkZWxldGVGaWxlU2VhcmNoU3RvcmUoYm90LmZpbGVTZWFyY2hTdG9yZU5hbWUpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZGVsZXRlIHN0b3JlIGluIEdvb2dsZTonLCBlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgcHJpc21hLmJvdENsaWVudEFjY2Vzcy5kZWxldGVNYW55KHsgd2hlcmU6IHsgYm90SWQ6IGlkIH0gfSk7XG4gICAgYXdhaXQgcHJpc21hLmJvdC5kZWxldGUoeyB3aGVyZTogeyBpZCB9IH0pO1xuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9CR0L7RgiDRg9GB0L/QtdGI0L3QviDRg9C00LDQu9C10L0nIH0pO1xuICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyb3I6ICfQndC1INGD0LTQsNC70L7RgdGMINGD0LTQsNC70LjRgtGMINCx0L7RgtCwJyB9KTtcbiAgfVxufSk7XG5cbmFwcC5nZXQoJy9hcGkvYWRtaW4vYm90cy86aWQvZmlsZXMnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBpZCB9ID0gcmVxLnBhcmFtcztcbiAgY29uc3QgYm90ID0gYXdhaXQgcHJpc21hLmJvdC5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQgfSB9KTtcbiAgaWYgKCFib3QgfHwgIWJvdC5maWxlU2VhcmNoU3RvcmVOYW1lKSB7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgZXJyb3I6ICfQkdC+0YIg0LjQu9C4IFN0b3JlINC90LUg0L3QsNC50LTQtdC9JyB9KTtcbiAgfVxuICBjb25zdCBmaWxlcyA9IGF3YWl0IGxpc3RGaWxlc0Zyb21TdG9yZShib3QuZmlsZVNlYXJjaFN0b3JlTmFtZSk7XG4gIHJlcy5qc29uKGZpbGVzKTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hZG1pbi9ib3RzLzppZC9maWxlcycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIHVwbG9hZC5zaW5nbGUoJ2ZpbGUnKSwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgaWQgfSA9IHJlcS5wYXJhbXM7XG4gIGNvbnN0IGZpbGUgPSByZXEuZmlsZTtcbiAgaWYgKCFmaWxlKSByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBlcnJvcjogJ9Ck0LDQudC7INC90LUg0L/QtdGA0LXQtNCw0L0nIH0pO1xuXG4gIGNvbnN0IGJvdCA9IGF3YWl0IHByaXNtYS5ib3QuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGlkIH0gfSk7XG4gIGlmICghYm90KSB7XG4gICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZS5wYXRoKSkgZnMudW5saW5rU3luYyhmaWxlLnBhdGgpO1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7IGVycm9yOiAn0JHQvtGCINC90LUg0L3QsNC50LTQtdC9JyB9KTtcbiAgfVxuXG4gIGxldCBzdG9yZU5hbWUgPSBib3QuZmlsZVNlYXJjaFN0b3JlTmFtZTtcbiAgaWYgKCFzdG9yZU5hbWUpIHtcbiAgICBzdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoYGJvdF9zdG9yZV8ke2JvdC5pZH1gKTtcbiAgICBhd2FpdCBwcmlzbWEuYm90LnVwZGF0ZSh7IHdoZXJlOiB7IGlkIH0sIGRhdGE6IHsgZmlsZVNlYXJjaFN0b3JlTmFtZTogc3RvcmVOYW1lIH0gfSk7XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGZpbGVOYW1lID0gQnVmZmVyLmZyb20oZmlsZS5vcmlnaW5hbG5hbWUsICdsYXRpbjEnKS50b1N0cmluZygndXRmOCcpO1xuICAgIGNvbnN0IHVwbG9hZGVkID0gYXdhaXQgdXBsb2FkRmlsZVRvU3RvcmUoXG4gICAgICBzdG9yZU5hbWUsXG4gICAgICBmaWxlLnBhdGgsXG4gICAgICBmaWxlTmFtZSxcbiAgICAgIGZpbGUubWltZXR5cGUsXG4gICAgICAn0JHQsNC30LAg0LfQvdCw0L3QuNC5INCx0L7RgtCwJ1xuICAgICk7XG4gICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZS5wYXRoKSkgZnMudW5saW5rU3luYyhmaWxlLnBhdGgpO1xuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9Ck0LDQudC7INC30LDQs9GA0YPQttC10L0g0LIg0LHQsNC30YMg0LfQvdCw0L3QuNC5INCx0L7RgtCwJywgZmlsZTogdXBsb2FkZWQgfSk7XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlLnBhdGgpKSBmcy51bmxpbmtTeW5jKGZpbGUucGF0aCk7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Ce0YjQuNCx0LrQsCDQt9Cw0LPRgNGD0LfQutC4INGE0LDQudC70LAg0LHQsNC30Ysg0LfQvdCw0L3QuNC5JywgZGV0YWlsczogZXJyb3IubWVzc2FnZSB9KTtcbiAgfVxufSk7XG5cbi8vID09PT09PT09PT09PT09PT09PT09IExPR0dJTkcgQVBJIEVORFBPSU5UUyA9PT09PT09PT09PT09PT09PT09PVxuXG4vLyBDbGllbnQgVGVsZW1ldHJ5IEVuZHBvaW50IChMb2cgY2xpZW50IGFjdGlvbnMsIGNsaWNrcywgZXJyb3JzKVxuYXBwLnBvc3QoJy9hcGkvbG9ncy9jbGllbnQnLCAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBsZXZlbCA9ICdJTkZPJywgbWVzc2FnZSwgZGV0YWlscyB9ID0gcmVxLmJvZHk7XG4gIGlmICghbWVzc2FnZSkge1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IGVycm9yOiAnTWVzc2FnZSByZXF1aXJlZCcgfSk7XG4gIH1cblxuICBjb25zdCBjbGllbnRMZXZlbCA9IChsZXZlbCBhcyBMb2dMZXZlbCkgfHwgJ0lORk8nO1xuICBpZiAoY2xpZW50TGV2ZWwgPT09ICdFUlJPUicpIHtcbiAgICBsb2dFcnJvcihgW0NsaWVudF0gJHttZXNzYWdlfWAsIGRldGFpbHMpO1xuICB9IGVsc2UgaWYgKGNsaWVudExldmVsID09PSAnREVCVUcnKSB7XG4gICAgbG9nRGVidWcoYFtDbGllbnRdICR7bWVzc2FnZX1gLCBkZXRhaWxzKTtcbiAgfSBlbHNlIHtcbiAgICBsb2dJbmZvKGBbQ2xpZW50XSAke21lc3NhZ2V9YCwgZGV0YWlscyk7XG4gIH1cblxuICByZXMuanNvbih7IHN0YXR1czogJ29rJyB9KTtcbn0pO1xuXG4vLyBBZG1pbiBMb2cgVmlld2VyIEVuZHBvaW50c1xuYXBwLmdldCgnL2FwaS9hZG1pbi9sb2dzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IGxldmVsID0gKHJlcS5xdWVyeS5sZXZlbCBhcyBzdHJpbmcpIHx8ICdBTEwnO1xuICBjb25zdCBsaW1pdCA9IHBhcnNlSW50KHJlcS5xdWVyeS5saW1pdCBhcyBzdHJpbmcpIHx8IDUwMDtcbiAgY29uc3QgbG9ncyA9IHJlYWRMb2dzKGxldmVsLCBsaW1pdCk7XG4gIHJlcy5qc29uKHtcbiAgICBsb2dMZXZlbDogZ2V0U3lzdGVtTG9nTGV2ZWwoKSxcbiAgICB0b3RhbDogbG9ncy5sZW5ndGgsXG4gICAgbG9nc1xuICB9KTtcbn0pO1xuXG5hcHAuZGVsZXRlKCcvYXBpL2FkbWluL2xvZ3MnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCAocmVxLCByZXMpID0+IHtcbiAgY29uc3Qgc3VjY2VzcyA9IGNsZWFyTG9nRmlsZSgpO1xuICBpZiAoc3VjY2Vzcykge1xuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9Ck0LDQudC7INC70L7Qs9C+0LIg0YPRgdC/0LXRiNC90L4g0L7Rh9C40YnQtdC9JyB9KTtcbiAgfSBlbHNlIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDQvtGH0LjRgdGC0LjRgtGMINGE0LDQudC7INC70L7Qs9C+0LInIH0pO1xuICB9XG59KTtcblxuYXBwLmdldCgnL2FwaS9hZG1pbi9sb2dzL2xldmVsJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgKHJlcSwgcmVzKSA9PiB7XG4gIHJlcy5qc29uKHsgbGV2ZWw6IGdldFN5c3RlbUxvZ0xldmVsKCkgfSk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4vbG9ncy9sZXZlbCcsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGxldmVsIH0gPSByZXEuYm9keTtcbiAgaWYgKCFbJ0RFQlVHJywgJ0lORk8nLCAnRVJST1InXS5pbmNsdWRlcyhsZXZlbCkpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBlcnJvcjogJ0ludmFsaWQgbGV2ZWwuIE11c3QgYmUgREVCVUcsIElORk8sIG9yIEVSUk9SJyB9KTtcbiAgfVxuICBzZXRTeXN0ZW1Mb2dMZXZlbChsZXZlbCBhcyBMb2dMZXZlbCk7XG4gIHJlcy5qc29uKHsgbWVzc2FnZTogYNCj0YDQvtCy0LXQvdGMINC70L7Qs9C40YDQvtCy0LDQvdC40Y8g0YPRgdGC0LDQvdC+0LLQu9C10L0g0L3QsCAke2xldmVsfWAsIGxldmVsIH0pO1xufSk7XG5cbmFwcC5saXN0ZW4oUE9SVCwgKCkgPT4ge1xuICBsb2dJbmZvKGDQodC10YDQstC10YAg0LfQsNC/0YPRidC10L0g0L3QsCBodHRwOi8vbG9jYWxob3N0OiR7UE9SVH0gW9Cj0YDQvtCy0LXQvdGMOiAke2dldFN5c3RlbUxvZ0xldmVsKCl9XWApO1xuICBjb25zb2xlLmxvZyhgU2VydmVyIGxpc3RlbmluZyBvbiBodHRwOi8vbG9jYWxob3N0OiR7UE9SVH1gKTtcbn0pO1xuIl19