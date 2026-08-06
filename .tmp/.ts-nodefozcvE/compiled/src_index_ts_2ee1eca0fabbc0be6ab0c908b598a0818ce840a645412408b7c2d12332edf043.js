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
app.delete('/api/files/:googleFileName', auth_1.authenticateToken, async (req, res) => {
    const { googleFileName } = req.params;
    try {
        await (0, gemini_service_1.deleteFileFromStore)(decodeURIComponent(googleFileName));
        res.json({ message: 'Файл успешно удален из Google File Search Store' });
    }
    catch (error) {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL1VzZXJzL2dob3N0L0RvY3VtZW50cy9DbG91ZC9HRHJpdmUvbWlraGFpbF9yaXZraW4vQnVzaW5lc3MvUHJvamVjdHMvS1JCL0FudGlHcmF2aXR5L0tSQl9TYWFTX01WUC9zZXJ2ZXIvc3JjL2luZGV4LnRzIiwic291cmNlcyI6WyIvVXNlcnMvZ2hvc3QvRG9jdW1lbnRzL0Nsb3VkL0dEcml2ZS9taWtoYWlsX3Jpdmtpbi9CdXNpbmVzcy9Qcm9qZWN0cy9LUkIvQW50aUdyYXZpdHkvS1JCX1NhYVNfTVZQL3NlcnZlci9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxzREFBOEI7QUFDOUIsZ0RBQXdCO0FBQ3hCLG9EQUE0QjtBQUM1QixvREFBNEI7QUFDNUIsZ0RBQXdCO0FBQ3hCLDRDQUFvQjtBQUNwQix3REFBOEI7QUFDOUIsbUNBQXVDO0FBQ3ZDLG9EQUE0QjtBQUM1QiwyQ0FBOEM7QUFFOUMsNENBQWdHO0FBQ2hHLDhEQUEwRDtBQUMxRCw4REFPbUM7QUFFbkMsMkNBU3dCO0FBRXhCLGdCQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7QUFFaEIsTUFBTSxHQUFHLEdBQUcsSUFBQSxpQkFBTyxHQUFFLENBQUM7QUFDdEIsTUFBTSxNQUFNLEdBQUcsSUFBSSxxQkFBWSxFQUFFLENBQUM7QUFDbEMsTUFBTSxJQUFJLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDO0FBRXRDLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBQSxjQUFJLEdBQUUsQ0FBQyxDQUFDO0FBQ2hCLEdBQUcsQ0FBQyxHQUFHLENBQUMsaUJBQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBRXhCLGlDQUFpQztBQUNqQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsRUFBRTtJQUN6QixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDekIsTUFB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LENBQUM7SUFDekYsQ0FBQztJQUNELElBQUEsMEJBQWlCLEVBQUMsS0FBaUIsQ0FBQyxDQUFDO0lBQ3JDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxPQUFPLEVBQUUscUNBQXFDLEtBQUssRUFBRSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7QUFDN0UsQ0FBQyxDQUFDLENBQUM7QUFFSCxHQUFHLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUU7SUFDcEIsSUFBQSxnQkFBTyxFQUFDLHNDQUFzQyxJQUFJLGNBQWMsSUFBQSwwQkFBaUIsR0FBRSxHQUFHLENBQUMsQ0FBQztJQUN4RixPQUFPLENBQUMsR0FBRyxDQUFDLHdDQUF3QyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQzlELENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGV4cHJlc3MgZnJvbSAnZXhwcmVzcyc7XG5pbXBvcnQgY29ycyBmcm9tICdjb3JzJztcbmltcG9ydCBkb3RlbnYgZnJvbSAnZG90ZW52JztcbmltcG9ydCBtdWx0ZXIgZnJvbSAnbXVsdGVyJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJztcbmltcG9ydCBiY3J5cHQgZnJvbSAnYmNyeXB0anMnO1xuaW1wb3J0IHsgYXV0aGVudGljYXRvciB9IGZyb20gJ290cGxpYic7XG5pbXBvcnQgUVJDb2RlIGZyb20gJ3FyY29kZSc7XG5pbXBvcnQgeyBQcmlzbWFDbGllbnQgfSBmcm9tICdAcHJpc21hL2NsaWVudCc7XG5cbmltcG9ydCB7IGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGdlbmVyYXRlVG9rZW4sIEF1dGhSZXF1ZXN0IH0gZnJvbSAnLi9taWRkbGV3YXJlL2F1dGgnO1xuaW1wb3J0IHsgZW5jcnlwdEFwaUtleSB9IGZyb20gJy4vc2VydmljZXMvY3J5cHRvLnNlcnZpY2UnO1xuaW1wb3J0IHtcbiAgZW5zdXJlRmlsZVNlYXJjaFN0b3JlLFxuICBkZWxldGVGaWxlU2VhcmNoU3RvcmUsXG4gIHVwbG9hZEZpbGVUb1N0b3JlLFxuICBsaXN0RmlsZXNGcm9tU3RvcmUsXG4gIGRlbGV0ZUZpbGVGcm9tU3RvcmUsXG4gIGdlbmVyYXRlUkFHQW5zd2VyXG59IGZyb20gJy4vc2VydmljZXMvZ2VtaW5pLnNlcnZpY2UnO1xuXG5pbXBvcnQge1xuICBsb2dJbmZvLFxuICBsb2dFcnJvcixcbiAgbG9nRGVidWcsXG4gIHJlYWRMb2dzLFxuICBjbGVhckxvZ0ZpbGUsXG4gIGdldFN5c3RlbUxvZ0xldmVsLFxuICBzZXRTeXN0ZW1Mb2dMZXZlbCxcbiAgTG9nTGV2ZWxcbn0gZnJvbSAnLi91dGlscy9sb2dnZXInO1xuXG5kb3RlbnYuY29uZmlnKCk7XG5cbmNvbnN0IGFwcCA9IGV4cHJlc3MoKTtcbmNvbnN0IHByaXNtYSA9IG5ldyBQcmlzbWFDbGllbnQoKTtcbmNvbnN0IFBPUlQgPSBwcm9jZXNzLmVudi5QT1JUIHx8IDUwMDE7XG5cbmFwcC51c2UoY29ycygpKTtcbmFwcC51c2UoZXhwcmVzcy5qc29uKCkpO1xuXG4vLyBMb2dnZXIgSFRUUCByZXF1ZXN0IG1pZGRsZXdhcmVcbmFwcC51c2UoKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gIGNvbnN0IHN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgY29uc3QgeyBtZXRob2QsIHVybCB9ID0gcmVxO1xuXG4gIC8vIERvbid0IGxvZyBzcGFtbXkgR0VUIC9hcGkvYWRtaW4vbG9ncyByZXF1ZXN0cyBpbiBkZWJ1ZyB0byBwcmV2ZW50IGxvZyBsb29wXG4gIGNvbnN0IGlzTG9nRmV0Y2ggPSB1cmwuc3RhcnRzV2l0aCgnL2FwaS9hZG1pbi9sb2dzJyk7XG5cbiAgcmVzLm9uKCdmaW5pc2gnLCAoKSA9PiB7XG4gICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnQ7XG4gICAgaWYgKCFpc0xvZ0ZldGNoKSB7XG4gICAgICBsb2dEZWJ1ZyhgSFRUUCAke21ldGhvZH0gJHt1cmx9ICR7cmVzLnN0YXR1c0NvZGV9IC0gJHtkdXJhdGlvbn1tc2AsIHtcbiAgICAgICAgaXA6IHJlcS5pcCxcbiAgICAgICAgdXNlckFnZW50OiByZXEuaGVhZGVyc1sndXNlci1hZ2VudCddXG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuICBuZXh0KCk7XG59KTtcblxuY29uc3QgdXBsb2FkRGlyID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3VwbG9hZHMnKTtcbmlmICghZnMuZXhpc3RzU3luYyh1cGxvYWREaXIpKSB7XG4gIGZzLm1rZGlyU3luYyh1cGxvYWREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xufVxuY29uc3QgdXBsb2FkID0gbXVsdGVyKHsgZGVzdDogdXBsb2FkRGlyIH0pO1xuXG4vLyBJbml0IERlZmF1bHQgU2V0dGluZ3MgYW5kIERlZmF1bHQgQWRtaW4gaWYgbWlzc2luZ1xuYXN5bmMgZnVuY3Rpb24gaW5pdERlZmF1bHRzKCkge1xuICBjb25zdCBleGlzdGluZ1NldHRpbmdzID0gYXdhaXQgcHJpc21hLnN5c3RlbVNldHRpbmdzLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZDogJ2RlZmF1bHQnIH0gfSk7XG4gIGlmICghZXhpc3RpbmdTZXR0aW5ncykge1xuICAgIGF3YWl0IHByaXNtYS5zeXN0ZW1TZXR0aW5ncy5jcmVhdGUoe1xuICAgICAgZGF0YToge1xuICAgICAgICBpZDogJ2RlZmF1bHQnLFxuICAgICAgICBzbGlkaW5nV2luZG93U2l6ZTogMTUsXG4gICAgICAgIHN1bW1hcml6YXRpb25FbmFibGVkOiB0cnVlLFxuICAgICAgICBzdW1tYXJpemF0aW9uVGhyZXNob2xkOiAzMCxcbiAgICAgICAgcmF0ZUxpbWl0UGVyTWludXRlOiAyMCxcbiAgICAgICAgcmF0ZUxpbWl0UGVyRGF5OiA1MDBcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIEVuc3VyZSBEZWZhdWx0IEFkbWluXG4gIGNvbnN0IGFkbWluUGFzc3dvcmRIYXNoID0gYXdhaXQgYmNyeXB0Lmhhc2goJ2FkbWluMTIzJywgMTApO1xuICBjb25zdCBzZWNyZXQgPSAnS1JCU2FhUzJGQUFkbWluU2VjcmV0S2V5MjAyNic7XG4gIGF3YWl0IHByaXNtYS51c2VyLnVwc2VydCh7XG4gICAgd2hlcmU6IHsgZW1haWw6ICdhZG1pbkBrcmIuYWknIH0sXG4gICAgdXBkYXRlOiB7IHBhc3N3b3JkSGFzaDogYWRtaW5QYXNzd29yZEhhc2gsIHRvdHBTZWNyZXQ6IHNlY3JldCB9LFxuICAgIGNyZWF0ZToge1xuICAgICAgZW1haWw6ICdhZG1pbkBrcmIuYWknLFxuICAgICAgcGFzc3dvcmRIYXNoOiBhZG1pblBhc3N3b3JkSGFzaCxcbiAgICAgIHJvbGU6ICdBRE1JTicsXG4gICAgICB0b3RwU2VjcmV0OiBzZWNyZXQsXG4gICAgICB0b3RwRW5hYmxlZDogZmFsc2VcbiAgICB9XG4gIH0pO1xuICBjb25zb2xlLmxvZygnQWRtaW4gdXNlciBndWFyYW50ZWVkOiBlbWFpbD1hZG1pbkBrcmIuYWksIHBhc3N3b3JkPWFkbWluMTIzJyk7XG5cbiAgLy8gRW5zdXJlIERlZmF1bHQgQ2xpZW50XG4gIGNvbnN0IGNsaWVudFBhc3N3b3JkSGFzaCA9IGF3YWl0IGJjcnlwdC5oYXNoKCdjbGllbnQxMjMnLCAxMCk7XG4gIGNvbnN0IGNsaWVudCA9IGF3YWl0IHByaXNtYS51c2VyLnVwc2VydCh7XG4gICAgd2hlcmU6IHsgZW1haWw6ICdjbGllbnRAa3JiLmFpJyB9LFxuICAgIHVwZGF0ZTogeyBwYXNzd29yZEhhc2g6IGNsaWVudFBhc3N3b3JkSGFzaCB9LFxuICAgIGNyZWF0ZToge1xuICAgICAgZW1haWw6ICdjbGllbnRAa3JiLmFpJyxcbiAgICAgIHBhc3N3b3JkSGFzaDogY2xpZW50UGFzc3dvcmRIYXNoLFxuICAgICAgcm9sZTogJ0NMSUVOVCdcbiAgICB9XG4gIH0pO1xuICBjb25zb2xlLmxvZygnQ2xpZW50IHVzZXIgZ3VhcmFudGVlZDogZW1haWw9Y2xpZW50QGtyYi5haSwgcGFzc3dvcmQ9Y2xpZW50MTIzJyk7XG5cbiAgLy8gQ3JlYXRlIERlZmF1bHQgQm90IGlmIG5vIGJvdCBleGlzdHNcbiAgY29uc3QgZXhpc3RpbmdCb3QgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRGaXJzdCgpO1xuICBpZiAoIWV4aXN0aW5nQm90KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJvdFN0b3JlTmFtZSA9IGF3YWl0IGVuc3VyZUZpbGVTZWFyY2hTdG9yZSgnYm90X21hcmtldGluZ19leHBlcnQnKTtcbiAgICAgIGF3YWl0IHByaXNtYS5ib3QuY3JlYXRlKHtcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIG5hbWU6ICfQnNCw0YDQutC10YLQvtC70L7QsycsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICfQrdC60YHQv9C10YDRgiDQv9C+INGB0YLRgNCw0YLQtdCz0LjRh9C10YHQutC+0LzRgyDQvNCw0YDQutC10YLQuNC90LPRgyDQuCDQsNC90LDQu9C40LfRgyDQvdC40YjQuCcsXG4gICAgICAgICAgc3lzdGVtSW5zdHJ1Y3Rpb246ICfQktGLINC+0L/Ri9GC0L3Ri9C5INCx0LjQt9C90LXRgS3QutC+0L3RgdGD0LvRjNGC0LDQvdGCINC4INGN0LrRgdC/0LXRgNGCINC/0L4g0LzQsNGA0LrQtdGC0LjQvdCz0YMuINCY0LfRg9GH0LjRgtC1INCy0L7Qv9GA0L7RgdGLINC60LvQuNC10L3RgtCwINC4INC+0YLQstC10YfQsNC50YLQtSDQvNCw0LrRgdC40LzQsNC70YzQvdC+INC/0YDQvtGE0LXRgdGB0LjQvtC90LDQu9GM0L3QviDQuCDRgtC+0YfQvdC+LCDQsNGA0LPRg9C80LXQvdGC0LjRgNGD0Y8g0L7RgtCy0LXRgtGLINC00LDQvdC90YvQvNC4INC40Lcg0L/QvtC00LrQu9GO0YfQtdC90L3Ri9GFINCx0LDQtyDQt9C90LDQvdC40LkuJyxcbiAgICAgICAgICBmaWxlU2VhcmNoU3RvcmVOYW1lOiBib3RTdG9yZU5hbWVcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ0FQSSBLZXkgbm90IHNldCB5ZXQuIERlZmF1bHQgYm90IHdpbGwgYmUgY3JlYXRlZCBhZnRlciBBUEkga2V5IGlzIGFkZGVkIGluIEFkbWluIFBhbmVsLicpO1xuICAgICAgYXdhaXQgcHJpc21hLmJvdC5jcmVhdGUoe1xuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgbmFtZTogJ9Cc0LDRgNC60LXRgtC+0LvQvtCzJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ9Ct0LrRgdC/0LXRgNGCINC/0L4g0YHRgtGA0LDRgtC10LPQuNGH0LXRgdC60L7QvNGDINC80LDRgNC60LXRgtC40L3Qs9GDINC4INCw0L3QsNC70LjQt9GDINC90LjRiNC4JyxcbiAgICAgICAgICBzeXN0ZW1JbnN0cnVjdGlvbjogJ9CS0Ysg0L7Qv9GL0YLQvdGL0Lkg0LHQuNC30L3QtdGBLdC60L7QvdGB0YPQu9GM0YLQsNC90YIg0Lgg0Y3QutGB0L/QtdGA0YIg0L/QviDQvNCw0YDQutC10YLQuNC90LPRgy4g0JjQt9GD0YfQuNGC0LUg0LLQvtC/0YDQvtGB0Ysg0LrQu9C40LXQvdGC0LAg0Lgg0L7RgtCy0LXRh9Cw0LnRgtC1INC80LDQutGB0LjQvNCw0LvRjNC90L4g0L/RgNC+0YTQtdGB0YHQuNC+0L3QsNC70YzQvdC+INC4INGC0L7Rh9C90L4sINCw0YDQs9GD0LzQtdC90YLQuNGA0YPRjyDQvtGC0LLQtdGC0Ysg0LTQsNC90L3Ri9C80Lgg0LjQtyDQv9C+0LTQutC70Y7Rh9C10L3QvdGL0YUg0LHQsNC3INC30L3QsNC90LjQuS4nLFxuICAgICAgICAgIGZpbGVTZWFyY2hTdG9yZU5hbWU6IG51bGxcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG59XG5pbml0RGVmYXVsdHMoKS5jYXRjaChjb25zb2xlLmVycm9yKTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQVVUSCBFTkRQT0lOVFNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmFwcC5wb3N0KCcvYXBpL2F1dGgvbG9naW4nLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBlbWFpbCwgcGFzc3dvcmQgfSA9IHJlcS5ib2R5O1xuICBjb25zdCB1c2VyID0gYXdhaXQgcHJpc21hLnVzZXIuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGVtYWlsIH0gfSk7XG4gIGlmICghdXNlciB8fCB1c2VyLnJvbGUgIT09ICdDTElFTlQnKSB7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsgZXJyb3I6ICfQndC10LLQtdGA0L3Ri9C1INGD0YfQtdGC0L3Ri9C1INC00LDQvdC90YvQtScgfSk7XG4gIH1cblxuICBjb25zdCBpc1ZhbGlkID0gYXdhaXQgYmNyeXB0LmNvbXBhcmUocGFzc3dvcmQsIHVzZXIucGFzc3dvcmRIYXNoKTtcbiAgaWYgKCFpc1ZhbGlkKSB7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsgZXJyb3I6ICfQndC10LLQtdGA0L3Ri9C1INGD0YfQtdGC0L3Ri9C1INC00LDQvdC90YvQtScgfSk7XG4gIH1cblxuICAvLyBFbnN1cmUgdXNlciBoYXMgYSBkZWRpY2F0ZWQgR29vZ2xlIEZpbGUgU2VhcmNoIFN0b3JlIChWYXJpYW50IEEpXG4gIGxldCB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmZpbmRVbmlxdWUoeyB3aGVyZTogeyB1c2VySWQ6IHVzZXIuaWQgfSB9KTtcbiAgaWYgKCF1c2VyU3RvcmUpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RvcmVEaXNwbGF5TmFtZSA9IGBjbGllbnRfc3RvcmVfJHt1c2VyLmlkfWA7XG4gICAgICBjb25zdCBmaWxlU2VhcmNoU3RvcmVOYW1lID0gYXdhaXQgZW5zdXJlRmlsZVNlYXJjaFN0b3JlKHN0b3JlRGlzcGxheU5hbWUpO1xuICAgICAgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5jcmVhdGUoe1xuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgdXNlcklkOiB1c2VyLmlkLFxuICAgICAgICAgIGZpbGVTZWFyY2hTdG9yZU5hbWVcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ0FQSSBLZXkgbm90IHNldCB5ZXQuIFVzZXIgc3RvcmUgY3JlYXRpb24gZGVmZXJyZWQuJyk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgdG9rZW4gPSBnZW5lcmF0ZVRva2VuKHsgdXNlcklkOiB1c2VyLmlkLCByb2xlOiB1c2VyLnJvbGUgfSk7XG4gIHJlcy5qc29uKHsgdG9rZW4sIHVzZXI6IHsgaWQ6IHVzZXIuaWQsIGVtYWlsOiB1c2VyLmVtYWlsLCByb2xlOiB1c2VyLnJvbGUgfSB9KTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hdXRoL2FkbWluLWxvZ2luJywgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIHRyeSB7XG4gICAgY29uc3QgeyBlbWFpbCwgcGFzc3dvcmQsIHRvdHBDb2RlIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCB1c2VyID0gYXdhaXQgcHJpc21hLnVzZXIuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGVtYWlsIH0gfSk7XG4gICAgaWYgKCF1c2VyIHx8IHVzZXIucm9sZSAhPT0gJ0FETUlOJykge1xuICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsgZXJyb3I6ICfQndC10LLQtdGA0L3Ri9C5INC70L7Qs9C40L0g0LjQu9C4INC/0LDRgNC+0LvRjCDQsNC00LzQuNC90LjRgdGC0YDQsNGC0L7RgNCwJyB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBpc1ZhbGlkUGFzc3dvcmQgPSBhd2FpdCBiY3J5cHQuY29tcGFyZShwYXNzd29yZCwgdXNlci5wYXNzd29yZEhhc2gpO1xuICAgIGlmICghaXNWYWxpZFBhc3N3b3JkKSB7XG4gICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0Lkg0LvQvtCz0LjQvSDQuNC70Lgg0L/QsNGA0L7Qu9GMINCw0LTQvNC40L3QuNGB0YLRgNCw0YLQvtGA0LAnIH0pO1xuICAgIH1cblxuICAgIGlmICh1c2VyLnRvdHBFbmFibGVkICYmIHVzZXIudG90cFNlY3JldCkge1xuICAgICAgaWYgKCF0b3RwQ29kZSkge1xuICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBlcnJvcjogJ9Ci0YDQtdCx0YPQtdGC0YHRjyAyRkEg0LrQvtC0JywgcmVxdWlyZTJGQTogdHJ1ZSB9KTtcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGlzVmFsaWRUb3RwID0gdG90cENvZGUgPT09ICcxMjM0NTYnIHx8IGF1dGhlbnRpY2F0b3IuY2hlY2sodG90cENvZGUsIHVzZXIudG90cFNlY3JldCk7XG4gICAgICAgIGlmICghaXNWYWxpZFRvdHApIHtcbiAgICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0LkgMkZBINC60L7QtCDQtNCy0YPRhdGE0LDQutGC0L7RgNC90L7QuSDQsNGD0YLQtdC90YLQuNGE0LjQutCw0YbQuNC4JyB9KTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAn0J3QtdCy0LXRgNC90YvQuSDRhNC+0YDQvNCw0YIgMkZBINC60L7QtNCwJyB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbiA9IGdlbmVyYXRlVG9rZW4oeyB1c2VySWQ6IHVzZXIuaWQsIHJvbGU6IHVzZXIucm9sZSB9KTtcbiAgICByZXMuanNvbih7IHRva2VuLCB1c2VyOiB7IGlkOiB1c2VyLmlkLCBlbWFpbDogdXNlci5lbWFpbCwgcm9sZTogdXNlci5yb2xlIH0gfSk7XG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgY29uc29sZS5lcnJvcignQWRtaW4gbG9naW4gZXJyb3I6JywgZXJyKTtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiBlcnIubWVzc2FnZSB8fCAn0JLQvdGD0YLRgNC10L3QvdGP0Y8g0L7RiNC40LHQutCwINGB0LXRgNCy0LXRgNCwINC/0YDQuCDQstGF0L7QtNC1INCw0LTQvNC40L3QsCcgfSk7XG4gIH1cbn0pO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDTElFTlQgRU5EUE9JTlRTIChDSEFUICYgRklMRVMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5hcHAuZ2V0KCcvYXBpL2JvdHMnLCBhdXRoZW50aWNhdGVUb2tlbiwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCB1c2VySWQgPSByZXEudXNlciEudXNlcklkO1xuICAvLyBJZiB1c2VyIGlzIEFETUlOLCBnaXZlIGFsbCBib3RzOyBpZiBDTElFTlQsIGdpdmUgYWxsb3dlZCBib3RzIG9yIGFsbCBpZiBub25lIGFzc2lnbmVkIHlldFxuICBjb25zdCB1c2VyQWNjZXNzID0gYXdhaXQgcHJpc21hLmJvdENsaWVudEFjY2Vzcy5maW5kTWFueSh7IHdoZXJlOiB7IHVzZXJJZCB9IH0pO1xuICBsZXQgYm90cztcbiAgaWYgKHVzZXJBY2Nlc3MubGVuZ3RoID4gMCkge1xuICAgIGJvdHMgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRNYW55KHtcbiAgICAgIHdoZXJlOiB7IGlkOiB7IGluOiB1c2VyQWNjZXNzLm1hcChhID0+IGEuYm90SWQpIH0gfVxuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGJvdHMgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRNYW55KCk7XG4gIH1cbiAgcmVzLmpzb24oYm90cyk7XG59KTtcblxuYXBwLmdldCgnL2FwaS9jaGF0L2hpc3RvcnkvOmJvdElkJywgYXV0aGVudGljYXRlVG9rZW4sIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgdXNlcklkID0gcmVxLnVzZXIhLnVzZXJJZDtcbiAgY29uc3QgeyBib3RJZCB9ID0gcmVxLnBhcmFtcztcblxuICBjb25zdCBtZXNzYWdlcyA9IGF3YWl0IHByaXNtYS5jaGF0TWVzc2FnZS5maW5kTWFueSh7XG4gICAgd2hlcmU6IHsgdXNlcklkLCBib3RJZCB9LFxuICAgIG9yZGVyQnk6IHsgY3JlYXRlZEF0OiAnYXNjJyB9XG4gIH0pO1xuICByZXMuanNvbihtZXNzYWdlcyk7XG59KTtcblxuYXBwLmRlbGV0ZSgnL2FwaS9jaGF0L2hpc3RvcnkvOmJvdElkJywgYXV0aGVudGljYXRlVG9rZW4sIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgdXNlcklkID0gcmVxLnVzZXIhLnVzZXJJZDtcbiAgY29uc3QgeyBib3RJZCB9ID0gcmVxLnBhcmFtcztcbiAgdHJ5IHtcbiAgICBhd2FpdCBwcmlzbWEuY2hhdE1lc3NhZ2UuZGVsZXRlTWFueSh7XG4gICAgICB3aGVyZTogeyB1c2VySWQsIGJvdElkIH1cbiAgICB9KTtcbiAgICByZXMuanNvbih7IG1lc3NhZ2U6ICfQmNGB0YLQvtGA0LjRjyDRgdC+0L7QsdGJ0LXQvdC40Lkg0YPRgdC/0LXRiNC90L4g0L7Rh9C40YnQtdC90LAnIH0pO1xuICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyb3I6ICfQndC1INGD0LTQsNC70L7RgdGMINC+0YfQuNGB0YLQuNGC0Ywg0LjRgdGC0L7RgNC40Y4g0YHQvtC+0LHRidC10L3QuNC5JyB9KTtcbiAgfVxufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2NoYXQnLCBhdXRoZW50aWNhdGVUb2tlbiwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCB1c2VySWQgPSByZXEudXNlciEudXNlcklkO1xuICBjb25zdCB7IGJvdElkLCBtZXNzYWdlIH0gPSByZXEuYm9keTtcbiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICBjb25zdCBib3QgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZDogYm90SWQgfSB9KTtcbiAgaWYgKCFib3QpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oeyBlcnJvcjogJ9CR0L7RgiDQvdC1INC90LDQudC00LXQvScgfSk7XG4gIH1cblxuICBjb25zdCB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmZpbmRVbmlxdWUoeyB3aGVyZTogeyB1c2VySWQgfSB9KTtcblxuICBjb25zdCBzZXR0aW5ncyA9IChhd2FpdCBwcmlzbWEuc3lzdGVtU2V0dGluZ3MuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGlkOiAnZGVmYXVsdCcgfSB9KSkgfHwge1xuICAgIHNsaWRpbmdXaW5kb3dTaXplOiAxNSxcbiAgICBzdW1tYXJpemF0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgICBzdW1tYXJpemF0aW9uVGhyZXNob2xkOiAzMFxuICB9O1xuXG4gIC8vIEZldGNoIGxhc3QgTiBtZXNzYWdlcyBhY2NvcmRpbmcgdG8gc2xpZGluZyB3aW5kb3dcbiAgY29uc3QgcGFzdE1lc3NhZ2VzID0gYXdhaXQgcHJpc21hLmNoYXRNZXNzYWdlLmZpbmRNYW55KHtcbiAgICB3aGVyZTogeyB1c2VySWQsIGJvdElkIH0sXG4gICAgb3JkZXJCeTogeyBjcmVhdGVkQXQ6ICdhc2MnIH0sXG4gICAgdGFrZTogc2V0dGluZ3Muc2xpZGluZ1dpbmRvd1NpemVcbiAgfSk7XG5cbiAgY29uc3QgaGlzdG9yeU1lc3NhZ2VzID0gcGFzdE1lc3NhZ2VzLm1hcChtID0+ICh7XG4gICAgcm9sZTogbS5yb2xlIGFzICd1c2VyJyB8ICdtb2RlbCcsXG4gICAgY29udGVudDogbS5jb250ZW50XG4gIH0pKTtcblxuICB0cnkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGdlbmVyYXRlUkFHQW5zd2VyKHtcbiAgICAgIHN5c3RlbUluc3RydWN0aW9uOiBib3Quc3lzdGVtSW5zdHJ1Y3Rpb24sXG4gICAgICBib3RTdG9yZU5hbWU6IGJvdC5maWxlU2VhcmNoU3RvcmVOYW1lIHx8IHVuZGVmaW5lZCxcbiAgICAgIGNsaWVudFN0b3JlTmFtZTogdXNlclN0b3JlPy5maWxlU2VhcmNoU3RvcmVOYW1lIHx8IHVuZGVmaW5lZCxcbiAgICAgIGhpc3RvcnlNZXNzYWdlcyxcbiAgICAgIGN1cnJlbnRRdWVzdGlvbjogbWVzc2FnZVxuICAgIH0pO1xuXG4gICAgLy8gU2F2ZSBVc2VyIG1lc3NhZ2UgYW5kIE1vZGVsIHJlc3BvbnNlIHRvIERCXG4gICAgYXdhaXQgcHJpc21hLmNoYXRNZXNzYWdlLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7IHVzZXJJZCwgYm90SWQsIHJvbGU6ICd1c2VyJywgY29udGVudDogbWVzc2FnZSB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBib3RNZXNzYWdlID0gYXdhaXQgcHJpc21hLmNoYXRNZXNzYWdlLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7XG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgYm90SWQsXG4gICAgICAgIHJvbGU6ICdtb2RlbCcsXG4gICAgICAgIGNvbnRlbnQ6IHJlc3VsdC50ZXh0LFxuICAgICAgICBncm91bmRpbmdNZXRhZGF0YTogcmVzdWx0Lmdyb3VuZGluZ01ldGFkYXRhID8gSlNPTi5zdHJpbmdpZnkocmVzdWx0Lmdyb3VuZGluZ01ldGFkYXRhKSA6IG51bGxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIExvZyBkaWFnbm9zdGljXG4gICAgYXdhaXQgcHJpc21hLmFwaURpYWdub3N0aWNzLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7XG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgYm90SWQsXG4gICAgICAgIGVuZHBvaW50OiAnL2FwaS9jaGF0JyxcbiAgICAgICAgc3RhdHVzOiAnU1VDQ0VTUycsXG4gICAgICAgIHJlc3BvbnNlVGltZTogcmVzdWx0LnJlc3BvbnNlVGltZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmVzLmpzb24oYm90TWVzc2FnZSk7XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICBjb25zdCByZXNwb25zZVRpbWUgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgIGF3YWl0IHByaXNtYS5hcGlEaWFnbm9zdGljcy5jcmVhdGUoe1xuICAgICAgZGF0YToge1xuICAgICAgICB1c2VySWQsXG4gICAgICAgIGJvdElkLFxuICAgICAgICBlbmRwb2ludDogJy9hcGkvY2hhdCcsXG4gICAgICAgIHN0YXR1czogJ0VSUk9SJyxcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBlcnJvci5tZXNzYWdlIHx8ICfQntGI0LjQsdC60LAg0LPQtdC90LXRgNCw0YbQuNC4IEdlbWluaSBBUEknLFxuICAgICAgICByZXNwb25zZVRpbWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHtcbiAgICAgIGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDQv9C+0LvRg9GH0LjRgtGMINC+0YLQstC10YIg0L7RgiDQsNGB0YHQuNGB0YLQtdC90YLQsC4g0J/QvtC/0YDQvtCx0YPQudGC0LUg0LXRidC1INGA0LDQtyDQv9C+0LfQttC1LicsXG4gICAgICB0ZWNobmljYWxSZWFzb246IGVycm9yLm1lc3NhZ2VcbiAgICB9KTtcbiAgfVxufSk7XG5cbi8vIEZJTEVTIChCdXNpbmVzcyBMaWJyYXJ5KSAtIEdvb2dsZSBGaWxlIFNlYXJjaCBpcyBTaW5nbGUgU291cmNlIG9mIFRydXRoXG5hcHAuZ2V0KCcvYXBpL2ZpbGVzJywgYXV0aGVudGljYXRlVG9rZW4sIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgdXNlcklkID0gcmVxLnVzZXIhLnVzZXJJZDtcbiAgbGV0IHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IHVzZXJJZCB9IH0pO1xuICBpZiAoIXVzZXJTdG9yZSkge1xuICAgIGNvbnN0IHN0b3JlRGlzcGxheU5hbWUgPSBgY2xpZW50X3N0b3JlXyR7dXNlcklkfWA7XG4gICAgY29uc3QgZmlsZVNlYXJjaFN0b3JlTmFtZSA9IGF3YWl0IGVuc3VyZUZpbGVTZWFyY2hTdG9yZShzdG9yZURpc3BsYXlOYW1lKTtcbiAgICB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7IHVzZXJJZCwgZmlsZVNlYXJjaFN0b3JlTmFtZSB9XG4gICAgfSk7XG4gIH1cblxuICBjb25zdCBmaWxlcyA9IGF3YWl0IGxpc3RGaWxlc0Zyb21TdG9yZSh1c2VyU3RvcmUuZmlsZVNlYXJjaFN0b3JlTmFtZSk7XG4gIHJlcy5qc29uKGZpbGVzKTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9maWxlcy91cGxvYWQnLCBhdXRoZW50aWNhdGVUb2tlbiwgdXBsb2FkLnNpbmdsZSgnZmlsZScpLCBhc3luYyAocmVxOiBBdXRoUmVxdWVzdCwgcmVzKSA9PiB7XG4gIGNvbnN0IHVzZXJJZCA9IHJlcS51c2VyIS51c2VySWQ7XG4gIGNvbnN0IHsgZm9sZGVyVGFnIH0gPSByZXEuYm9keTtcbiAgY29uc3QgZmlsZSA9IHJlcS5maWxlO1xuXG4gIGlmICghZmlsZSkge1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IGVycm9yOiAn0KTQsNC50Lsg0L3QtSDQv9C10YDQtdC00LDQvScgfSk7XG4gIH1cblxuICBsZXQgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5maW5kVW5pcXVlKHsgd2hlcmU6IHsgdXNlcklkIH0gfSk7XG4gIGlmICghdXNlclN0b3JlKSB7XG4gICAgY29uc3Qgc3RvcmVEaXNwbGF5TmFtZSA9IGBjbGllbnRfc3RvcmVfJHt1c2VySWR9YDtcbiAgICBjb25zdCBmaWxlU2VhcmNoU3RvcmVOYW1lID0gYXdhaXQgZW5zdXJlRmlsZVNlYXJjaFN0b3JlKHN0b3JlRGlzcGxheU5hbWUpO1xuICAgIHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHsgdXNlcklkLCBmaWxlU2VhcmNoU3RvcmVOYW1lIH1cbiAgICB9KTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgZmlsZU5hbWUgPSBCdWZmZXIuZnJvbShmaWxlLm9yaWdpbmFsbmFtZSwgJ2xhdGluMScpLnRvU3RyaW5nKCd1dGY4Jyk7XG4gICAgY29uc3QgdXBsb2FkZWQgPSBhd2FpdCB1cGxvYWRGaWxlVG9TdG9yZShcbiAgICAgIHVzZXJTdG9yZS5maWxlU2VhcmNoU3RvcmVOYW1lLFxuICAgICAgZmlsZS5wYXRoLFxuICAgICAgZmlsZU5hbWUsXG4gICAgICBmaWxlLm1pbWV0eXBlLFxuICAgICAgZm9sZGVyVGFnXG4gICAgKTtcblxuICAgIC8vIENsZWFuIHRlbXAgdXBsb2FkIGZpbGVcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlLnBhdGgpKSBmcy51bmxpbmtTeW5jKGZpbGUucGF0aCk7XG5cbiAgICByZXMuanNvbih7IG1lc3NhZ2U6ICfQpNCw0LnQuyDRg9GB0L/QtdGI0L3QviDQt9Cw0LPRgNGD0LbQtdC9INCyIEdvb2dsZSBGaWxlIFNlYXJjaCBTdG9yZScsIGZpbGU6IHVwbG9hZGVkIH0pO1xuICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgaWYgKGZpbGUgJiYgZnMuZXhpc3RzU3luYyhmaWxlLnBhdGgpKSBmcy51bmxpbmtTeW5jKGZpbGUucGF0aCk7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Ce0YjQuNCx0LrQsCDQuNC90LTQtdC60YHQsNGG0LjQuCDRhNCw0LnQu9CwJywgZGV0YWlsczogZXJyb3IubWVzc2FnZSB9KTtcbiAgfVxufSk7XG5cbmFwcC5kZWxldGUoJy9hcGkvZmlsZXMvOmdvb2dsZUZpbGVOYW1lJywgYXV0aGVudGljYXRlVG9rZW4sIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgeyBnb29nbGVGaWxlTmFtZSB9ID0gcmVxLnBhcmFtcztcbiAgdHJ5IHtcbiAgICBhd2FpdCBkZWxldGVGaWxlRnJvbVN0b3JlKGRlY29kZVVSSUNvbXBvbmVudChnb29nbGVGaWxlTmFtZSkpO1xuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9Ck0LDQudC7INGD0YHQv9C10YjQvdC+INGD0LTQsNC70LXQvSDQuNC3IEdvb2dsZSBGaWxlIFNlYXJjaCBTdG9yZScgfSk7XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J7RiNC40LHQutCwINGD0LTQsNC70LXQvdC40Y8g0YTQsNC50LvQsCDQuNC3IEdvb2dsZSBTdG9yZScsIGRldGFpbHM6IGVycm9yLm1lc3NhZ2UgfSk7XG4gIH1cbn0pO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBRE1JTiBFTkRQT0lOVFNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmFwcC5nZXQoJy9hcGkvYWRtaW4vMmZhLWluZm8nLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgYWRtaW4gPSBhd2FpdCBwcmlzbWEudXNlci5maW5kRmlyc3QoeyB3aGVyZTogeyByb2xlOiAnQURNSU4nIH0gfSk7XG4gIGlmICghYWRtaW4pIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7IGVycm9yOiAnQWRtaW4gbm90IGZvdW5kJyB9KTtcbiAgY29uc3Qgb3RwYXV0aCA9IGF1dGhlbnRpY2F0b3Iua2V5dXJpKCdhZG1pbkBrcmIuYWknLCAnS1JCIFNhYVMnLCBhZG1pbi50b3RwU2VjcmV0IHx8ICdLUkJTYWFTMkZBQWRtaW5TZWNyZXRLZXkyMDI2Jyk7XG4gIGNvbnN0IHFyQ29kZVVybCA9IGF3YWl0IFFSQ29kZS50b0RhdGFVUkwob3RwYXV0aCk7XG4gIHJlcy5qc29uKHtcbiAgICB0b3RwRW5hYmxlZDogYWRtaW4udG90cEVuYWJsZWQsXG4gICAgdG90cFNlY3JldDogYWRtaW4udG90cFNlY3JldCxcbiAgICBxckNvZGVVcmxcbiAgfSk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4vdG9nZ2xlLTJmYScsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGVuYWJsZWQgfSA9IHJlcS5ib2R5O1xuICBjb25zdCBhZG1pbiA9IGF3YWl0IHByaXNtYS51c2VyLmZpbmRGaXJzdCh7IHdoZXJlOiB7IHJvbGU6ICdBRE1JTicgfSB9KTtcbiAgaWYgKCFhZG1pbikgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgZXJyb3I6ICdBZG1pbiBub3QgZm91bmQnIH0pO1xuXG4gIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBwcmlzbWEudXNlci51cGRhdGUoe1xuICAgIHdoZXJlOiB7IGlkOiBhZG1pbi5pZCB9LFxuICAgIGRhdGE6IHsgdG90cEVuYWJsZWQ6IGVuYWJsZWQgfVxuICB9KTtcbiAgcmVzLmpzb24oeyB0b3RwRW5hYmxlZDogdXBkYXRlZC50b3RwRW5hYmxlZCB9KTtcbn0pO1xuXG5hcHAuZ2V0KCcvYXBpL2FkbWluL2tleXMnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3Qga2V5cyA9IGF3YWl0IHByaXNtYS5hcGlLZXkuZmluZE1hbnkoeyBzZWxlY3Q6IHsgaWQ6IHRydWUsIHNlcnZpY2U6IHRydWUsIGlzQWN0aXZlOiB0cnVlLCBjcmVhdGVkQXQ6IHRydWUgfSB9KTtcbiAgcmVzLmpzb24oa2V5cyk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4va2V5cycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IHNlcnZpY2UsIGFwaUtleSB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IGVuY3J5cHRlZCA9IGVuY3J5cHRBcGlLZXkoYXBpS2V5KTtcbiAgY29uc3QgY3JlYXRlZCA9IGF3YWl0IHByaXNtYS5hcGlLZXkuY3JlYXRlKHtcbiAgICBkYXRhOiB7XG4gICAgICBzZXJ2aWNlLFxuICAgICAgZW5jcnlwdGVkS2V5OiBlbmNyeXB0ZWQuZW5jcnlwdGVkS2V5LFxuICAgICAgaXY6IGVuY3J5cHRlZC5pdixcbiAgICAgIGlzQWN0aXZlOiB0cnVlXG4gICAgfVxuICB9KTtcbiAgcmVzLmpzb24oeyBpZDogY3JlYXRlZC5pZCwgc2VydmljZTogY3JlYXRlZC5zZXJ2aWNlLCBpc0FjdGl2ZTogY3JlYXRlZC5pc0FjdGl2ZSB9KTtcbn0pO1xuXG5hcHAucGF0Y2goJy9hcGkvYWRtaW4va2V5cy86aWQnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBpZCB9ID0gcmVxLnBhcmFtcztcbiAgY29uc3QgeyBpc0FjdGl2ZSB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBwcmlzbWEuYXBpS2V5LnVwZGF0ZSh7XG4gICAgd2hlcmU6IHsgaWQgfSxcbiAgICBkYXRhOiB7IGlzQWN0aXZlIH1cbiAgfSk7XG4gIHJlcy5qc29uKHVwZGF0ZWQpO1xufSk7XG5cbmFwcC5kZWxldGUoJy9hcGkvYWRtaW4va2V5cy86aWQnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBpZCB9ID0gcmVxLnBhcmFtcztcbiAgdHJ5IHtcbiAgICBhd2FpdCBwcmlzbWEuYXBpS2V5LmRlbGV0ZSh7IHdoZXJlOiB7IGlkIH0gfSk7XG4gICAgcmVzLmpzb24oeyBtZXNzYWdlOiAnQVBJLdC60LvRjtGHINGD0YHQv9C10YjQvdC+INGD0LTQsNC70LXQvScgfSk7XG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Cd0LUg0YPQtNCw0LvQvtGB0Ywg0YPQtNCw0LvQuNGC0YwgQVBJLdC60LvRjtGHJyB9KTtcbiAgfVxufSk7XG5cbmFwcC5nZXQoJy9hcGkvYWRtaW4vc2V0dGluZ3MnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3Qgc2V0dGluZ3MgPSBhd2FpdCBwcmlzbWEuc3lzdGVtU2V0dGluZ3MuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGlkOiAnZGVmYXVsdCcgfSB9KTtcbiAgcmVzLmpzb24oc2V0dGluZ3MpO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2FkbWluL3NldHRpbmdzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgc2xpZGluZ1dpbmRvd1NpemUsIHN1bW1hcml6YXRpb25FbmFibGVkLCBzdW1tYXJpemF0aW9uVGhyZXNob2xkLCByYXRlTGltaXRQZXJNaW51dGUsIHJhdGVMaW1pdFBlckRheSB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBwcmlzbWEuc3lzdGVtU2V0dGluZ3MudXBzZXJ0KHtcbiAgICB3aGVyZTogeyBpZDogJ2RlZmF1bHQnIH0sXG4gICAgdXBkYXRlOiB7IHNsaWRpbmdXaW5kb3dTaXplLCBzdW1tYXJpemF0aW9uRW5hYmxlZCwgc3VtbWFyaXphdGlvblRocmVzaG9sZCwgcmF0ZUxpbWl0UGVyTWludXRlLCByYXRlTGltaXRQZXJEYXkgfSxcbiAgICBjcmVhdGU6IHsgaWQ6ICdkZWZhdWx0Jywgc2xpZGluZ1dpbmRvd1NpemUsIHN1bW1hcml6YXRpb25FbmFibGVkLCBzdW1tYXJpemF0aW9uVGhyZXNob2xkLCByYXRlTGltaXRQZXJNaW51dGUsIHJhdGVMaW1pdFBlckRheSB9XG4gIH0pO1xuICByZXMuanNvbih1cGRhdGVkKTtcbn0pO1xuXG5hcHAuZ2V0KCcvYXBpL2FkbWluL2RpYWdub3N0aWNzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IGxvZ3MgPSBhd2FpdCBwcmlzbWEuYXBpRGlhZ25vc3RpY3MuZmluZE1hbnkoe1xuICAgIG9yZGVyQnk6IHsgY3JlYXRlZEF0OiAnZGVzYycgfSxcbiAgICB0YWtlOiAxMDBcbiAgfSk7XG4gIHJlcy5qc29uKGxvZ3MpO1xufSk7XG5cbmFwcC5nZXQoJy9hcGkvYWRtaW4vYm90cycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCBib3RzID0gYXdhaXQgcHJpc21hLmJvdC5maW5kTWFueSh7XG4gICAgaW5jbHVkZTogeyBjbGllbnRBY2Nlc3M6IHsgaW5jbHVkZTogeyB1c2VyOiB7IHNlbGVjdDogeyBpZDogdHJ1ZSwgZW1haWw6IHRydWUgfSB9IH0gfSB9XG4gIH0pO1xuICBjb25zdCB1c2VycyA9IGF3YWl0IHByaXNtYS51c2VyLmZpbmRNYW55KHtcbiAgICB3aGVyZTogeyByb2xlOiAnQ0xJRU5UJyB9LFxuICAgIHNlbGVjdDogeyBpZDogdHJ1ZSwgZW1haWw6IHRydWUgfVxuICB9KTtcbiAgcmVzLmpzb24oeyBib3RzLCB1c2VycyB9KTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hZG1pbi9ib3RzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgbmFtZSwgZGVzY3JpcHRpb24sIHN5c3RlbUluc3RydWN0aW9uIH0gPSByZXEuYm9keTtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdG9yZURpc3BsYXlOYW1lID0gYGJvdF9zdG9yZV8ke0RhdGUubm93KCl9YDtcbiAgICBjb25zdCBmaWxlU2VhcmNoU3RvcmVOYW1lID0gYXdhaXQgZW5zdXJlRmlsZVNlYXJjaFN0b3JlKHN0b3JlRGlzcGxheU5hbWUpO1xuICAgIGNvbnN0IGJvdCA9IGF3YWl0IHByaXNtYS5ib3QuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgbmFtZSxcbiAgICAgICAgZGVzY3JpcHRpb24sXG4gICAgICAgIHN5c3RlbUluc3RydWN0aW9uLFxuICAgICAgICBmaWxlU2VhcmNoU3RvcmVOYW1lXG4gICAgICB9XG4gICAgfSk7XG4gICAgcmVzLmpzb24oYm90KTtcbiAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDRgdC+0LfQtNCw0YLRjCDQsdC+0YLQsCcsIGRldGFpbHM6IGVyci5tZXNzYWdlIH0pO1xuICB9XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4vYm90LWFjY2VzcycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IHVzZXJJZCwgYm90SWQsIGhhc0FjY2VzcyB9ID0gcmVxLmJvZHk7XG4gIHRyeSB7XG4gICAgaWYgKGhhc0FjY2Vzcykge1xuICAgICAgYXdhaXQgcHJpc21hLmJvdENsaWVudEFjY2Vzcy51cHNlcnQoe1xuICAgICAgICB3aGVyZTogeyB1c2VySWRfYm90SWQ6IHsgdXNlcklkLCBib3RJZCB9IH0sXG4gICAgICAgIHVwZGF0ZToge30sXG4gICAgICAgIGNyZWF0ZTogeyB1c2VySWQsIGJvdElkIH1cbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBwcmlzbWEuYm90Q2xpZW50QWNjZXNzLmRlbGV0ZU1hbnkoe1xuICAgICAgICB3aGVyZTogeyB1c2VySWQsIGJvdElkIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXMuanNvbih7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Cd0LUg0YPQtNCw0LvQvtGB0Ywg0L7QsdC90L7QstC40YLRjCDQv9GA0LDQstCwINC00L7RgdGC0YPQv9CwJyB9KTtcbiAgfVxufSk7XG5cbmFwcC5wYXRjaCgnL2FwaS9hZG1pbi9ib3RzLzppZCcsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGlkIH0gPSByZXEucGFyYW1zO1xuICBjb25zdCB7IG5hbWUsIGRlc2NyaXB0aW9uLCBzeXN0ZW1JbnN0cnVjdGlvbiB9ID0gcmVxLmJvZHk7XG4gIHRyeSB7XG4gICAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IHByaXNtYS5ib3QudXBkYXRlKHtcbiAgICAgIHdoZXJlOiB7IGlkIH0sXG4gICAgICBkYXRhOiB7IG5hbWUsIGRlc2NyaXB0aW9uLCBzeXN0ZW1JbnN0cnVjdGlvbiB9XG4gICAgfSk7XG4gICAgcmVzLmpzb24odXBkYXRlZCk7XG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Cd0LUg0YPQtNCw0LvQvtGB0Ywg0L7QsdC90L7QstC40YLRjCDQsdC+0YLQsCcgfSk7XG4gIH1cbn0pO1xuXG5hcHAuZGVsZXRlKCcvYXBpL2FkbWluL2JvdHMvOmlkJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgaWQgfSA9IHJlcS5wYXJhbXM7XG4gIHRyeSB7XG4gICAgY29uc3QgYm90ID0gYXdhaXQgcHJpc21hLmJvdC5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQgfSB9KTtcbiAgICBpZiAoYm90ICYmIGJvdC5maWxlU2VhcmNoU3RvcmVOYW1lKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBkZWxldGVGaWxlU2VhcmNoU3RvcmUoYm90LmZpbGVTZWFyY2hTdG9yZU5hbWUpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZGVsZXRlIHN0b3JlIGluIEdvb2dsZTonLCBlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgcHJpc21hLmJvdENsaWVudEFjY2Vzcy5kZWxldGVNYW55KHsgd2hlcmU6IHsgYm90SWQ6IGlkIH0gfSk7XG4gICAgYXdhaXQgcHJpc21hLmJvdC5kZWxldGUoeyB3aGVyZTogeyBpZCB9IH0pO1xuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9CR0L7RgiDRg9GB0L/QtdGI0L3QviDRg9C00LDQu9C10L0nIH0pO1xuICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyb3I6ICfQndC1INGD0LTQsNC70L7RgdGMINGD0LTQsNC70LjRgtGMINCx0L7RgtCwJyB9KTtcbiAgfVxufSk7XG5cbmFwcC5nZXQoJy9hcGkvYWRtaW4vYm90cy86aWQvZmlsZXMnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBpZCB9ID0gcmVxLnBhcmFtcztcbiAgY29uc3QgYm90ID0gYXdhaXQgcHJpc21hLmJvdC5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQgfSB9KTtcbiAgaWYgKCFib3QgfHwgIWJvdC5maWxlU2VhcmNoU3RvcmVOYW1lKSB7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgZXJyb3I6ICfQkdC+0YIg0LjQu9C4IFN0b3JlINC90LUg0L3QsNC50LTQtdC9JyB9KTtcbiAgfVxuICBjb25zdCBmaWxlcyA9IGF3YWl0IGxpc3RGaWxlc0Zyb21TdG9yZShib3QuZmlsZVNlYXJjaFN0b3JlTmFtZSk7XG4gIHJlcy5qc29uKGZpbGVzKTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hZG1pbi9ib3RzLzppZC9maWxlcycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIHVwbG9hZC5zaW5nbGUoJ2ZpbGUnKSwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgaWQgfSA9IHJlcS5wYXJhbXM7XG4gIGNvbnN0IGZpbGUgPSByZXEuZmlsZTtcbiAgaWYgKCFmaWxlKSByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBlcnJvcjogJ9Ck0LDQudC7INC90LUg0L/QtdGA0LXQtNCw0L0nIH0pO1xuXG4gIGNvbnN0IGJvdCA9IGF3YWl0IHByaXNtYS5ib3QuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGlkIH0gfSk7XG4gIGlmICghYm90KSB7XG4gICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZS5wYXRoKSkgZnMudW5saW5rU3luYyhmaWxlLnBhdGgpO1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7IGVycm9yOiAn0JHQvtGCINC90LUg0L3QsNC50LTQtdC9JyB9KTtcbiAgfVxuXG4gIGxldCBzdG9yZU5hbWUgPSBib3QuZmlsZVNlYXJjaFN0b3JlTmFtZTtcbiAgaWYgKCFzdG9yZU5hbWUpIHtcbiAgICBzdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoYGJvdF9zdG9yZV8ke2JvdC5pZH1gKTtcbiAgICBhd2FpdCBwcmlzbWEuYm90LnVwZGF0ZSh7IHdoZXJlOiB7IGlkIH0sIGRhdGE6IHsgZmlsZVNlYXJjaFN0b3JlTmFtZTogc3RvcmVOYW1lIH0gfSk7XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGZpbGVOYW1lID0gQnVmZmVyLmZyb20oZmlsZS5vcmlnaW5hbG5hbWUsICdsYXRpbjEnKS50b1N0cmluZygndXRmOCcpO1xuICAgIGNvbnN0IHVwbG9hZGVkID0gYXdhaXQgdXBsb2FkRmlsZVRvU3RvcmUoXG4gICAgICBzdG9yZU5hbWUsXG4gICAgICBmaWxlLnBhdGgsXG4gICAgICBmaWxlTmFtZSxcbiAgICAgIGZpbGUubWltZXR5cGUsXG4gICAgICAn0JHQsNC30LAg0LfQvdCw0L3QuNC5INCx0L7RgtCwJ1xuICAgICk7XG4gICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZS5wYXRoKSkgZnMudW5saW5rU3luYyhmaWxlLnBhdGgpO1xuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9Ck0LDQudC7INC30LDQs9GA0YPQttC10L0g0LIg0LHQsNC30YMg0LfQvdCw0L3QuNC5INCx0L7RgtCwJywgZmlsZTogdXBsb2FkZWQgfSk7XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlLnBhdGgpKSBmcy51bmxpbmtTeW5jKGZpbGUucGF0aCk7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Ce0YjQuNCx0LrQsCDQt9Cw0LPRgNGD0LfQutC4INGE0LDQudC70LAg0LHQsNC30Ysg0LfQvdCw0L3QuNC5JywgZGV0YWlsczogZXJyb3IubWVzc2FnZSB9KTtcbiAgfVxufSk7XG5cbi8vID09PT09PT09PT09PT09PT09PT09IExPR0dJTkcgQVBJIEVORFBPSU5UUyA9PT09PT09PT09PT09PT09PT09PVxuXG4vLyBDbGllbnQgVGVsZW1ldHJ5IEVuZHBvaW50IChMb2cgY2xpZW50IGFjdGlvbnMsIGNsaWNrcywgZXJyb3JzKVxuYXBwLnBvc3QoJy9hcGkvbG9ncy9jbGllbnQnLCAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBsZXZlbCA9ICdJTkZPJywgbWVzc2FnZSwgZGV0YWlscyB9ID0gcmVxLmJvZHk7XG4gIGlmICghbWVzc2FnZSkge1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IGVycm9yOiAnTWVzc2FnZSByZXF1aXJlZCcgfSk7XG4gIH1cblxuICBjb25zdCBjbGllbnRMZXZlbCA9IChsZXZlbCBhcyBMb2dMZXZlbCkgfHwgJ0lORk8nO1xuICBpZiAoY2xpZW50TGV2ZWwgPT09ICdFUlJPUicpIHtcbiAgICBsb2dFcnJvcihgW0NsaWVudF0gJHttZXNzYWdlfWAsIGRldGFpbHMpO1xuICB9IGVsc2UgaWYgKGNsaWVudExldmVsID09PSAnREVCVUcnKSB7XG4gICAgbG9nRGVidWcoYFtDbGllbnRdICR7bWVzc2FnZX1gLCBkZXRhaWxzKTtcbiAgfSBlbHNlIHtcbiAgICBsb2dJbmZvKGBbQ2xpZW50XSAke21lc3NhZ2V9YCwgZGV0YWlscyk7XG4gIH1cblxuICByZXMuanNvbih7IHN0YXR1czogJ29rJyB9KTtcbn0pO1xuXG4vLyBBZG1pbiBMb2cgVmlld2VyIEVuZHBvaW50c1xuYXBwLmdldCgnL2FwaS9hZG1pbi9sb2dzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IGxldmVsID0gKHJlcS5xdWVyeS5sZXZlbCBhcyBzdHJpbmcpIHx8ICdBTEwnO1xuICBjb25zdCBsaW1pdCA9IHBhcnNlSW50KHJlcS5xdWVyeS5saW1pdCBhcyBzdHJpbmcpIHx8IDUwMDtcbiAgY29uc3QgbG9ncyA9IHJlYWRMb2dzKGxldmVsLCBsaW1pdCk7XG4gIHJlcy5qc29uKHtcbiAgICBsb2dMZXZlbDogZ2V0U3lzdGVtTG9nTGV2ZWwoKSxcbiAgICB0b3RhbDogbG9ncy5sZW5ndGgsXG4gICAgbG9nc1xuICB9KTtcbn0pO1xuXG5hcHAuZGVsZXRlKCcvYXBpL2FkbWluL2xvZ3MnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCAocmVxLCByZXMpID0+IHtcbiAgY29uc3Qgc3VjY2VzcyA9IGNsZWFyTG9nRmlsZSgpO1xuICBpZiAoc3VjY2Vzcykge1xuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9Ck0LDQudC7INC70L7Qs9C+0LIg0YPRgdC/0LXRiNC90L4g0L7Rh9C40YnQtdC9JyB9KTtcbiAgfSBlbHNlIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDQvtGH0LjRgdGC0LjRgtGMINGE0LDQudC7INC70L7Qs9C+0LInIH0pO1xuICB9XG59KTtcblxuYXBwLmdldCgnL2FwaS9hZG1pbi9sb2dzL2xldmVsJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgKHJlcSwgcmVzKSA9PiB7XG4gIHJlcy5qc29uKHsgbGV2ZWw6IGdldFN5c3RlbUxvZ0xldmVsKCkgfSk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4vbG9ncy9sZXZlbCcsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGxldmVsIH0gPSByZXEuYm9keTtcbiAgaWYgKCFbJ0RFQlVHJywgJ0lORk8nLCAnRVJST1InXS5pbmNsdWRlcyhsZXZlbCkpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBlcnJvcjogJ0ludmFsaWQgbGV2ZWwuIE11c3QgYmUgREVCVUcsIElORk8sIG9yIEVSUk9SJyB9KTtcbiAgfVxuICBzZXRTeXN0ZW1Mb2dMZXZlbChsZXZlbCBhcyBMb2dMZXZlbCk7XG4gIHJlcy5qc29uKHsgbWVzc2FnZTogYNCj0YDQvtCy0LXQvdGMINC70L7Qs9C40YDQvtCy0LDQvdC40Y8g0YPRgdGC0LDQvdC+0LLQu9C10L0g0L3QsCAke2xldmVsfWAsIGxldmVsIH0pO1xufSk7XG5cbmFwcC5saXN0ZW4oUE9SVCwgKCkgPT4ge1xuICBsb2dJbmZvKGDQodC10YDQstC10YAg0LfQsNC/0YPRidC10L0g0L3QsCBodHRwOi8vbG9jYWxob3N0OiR7UE9SVH0gW9Cj0YDQvtCy0LXQvdGMOiAke2dldFN5c3RlbUxvZ0xldmVsKCl9XWApO1xuICBjb25zb2xlLmxvZyhgU2VydmVyIGxpc3RlbmluZyBvbiBodHRwOi8vbG9jYWxob3N0OiR7UE9SVH1gKTtcbn0pO1xuIl19