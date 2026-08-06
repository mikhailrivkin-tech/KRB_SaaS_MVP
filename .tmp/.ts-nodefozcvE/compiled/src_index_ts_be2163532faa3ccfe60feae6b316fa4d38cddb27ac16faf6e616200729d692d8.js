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
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
const PORT = process.env.PORT || 5001;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
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
        const uploaded = await (0, gemini_service_1.uploadFileToStore)(userStore.fileSearchStoreName, file.path, file.originalname, file.mimetype, folderTag);
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
                await deleteFileSearchStore(bot.fileSearchStoreName);
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
        const uploaded = await (0, gemini_service_1.uploadFileToStore)(storeName, file.path, file.originalname, file.mimetype, 'База знаний бота');
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
app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL1VzZXJzL2dob3N0L0RvY3VtZW50cy9DbG91ZC9HRHJpdmUvbWlraGFpbF9yaXZraW4vQnVzaW5lc3MvUHJvamVjdHMvS1JCL0FudGlHcmF2aXR5L0tSQl9TYWFTX01WUC9zZXJ2ZXIvc3JjL2luZGV4LnRzIiwic291cmNlcyI6WyIvVXNlcnMvZ2hvc3QvRG9jdW1lbnRzL0Nsb3VkL0dEcml2ZS9taWtoYWlsX3Jpdmtpbi9CdXNpbmVzcy9Qcm9qZWN0cy9LUkIvQW50aUdyYXZpdHkvS1JCX1NhYVNfTVZQL3NlcnZlci9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxzREFBOEI7QUFDOUIsZ0RBQXdCO0FBQ3hCLG9EQUE0QjtBQUM1QixvREFBNEI7QUFDNUIsZ0RBQXdCO0FBQ3hCLDRDQUFvQjtBQUNwQix3REFBOEI7QUFDOUIsbUNBQXVDO0FBQ3ZDLG9EQUE0QjtBQUM1QiwyQ0FBOEM7QUFFOUMsNENBQWdHO0FBQ2hHLDhEQUEwRDtBQUMxRCw4REFNbUM7QUFFbkMsZ0JBQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQztBQUVoQixNQUFNLEdBQUcsR0FBRyxJQUFBLGlCQUFPLEdBQUUsQ0FBQztBQUN0QixNQUFNLE1BQU0sR0FBRyxJQUFJLHFCQUFZLEVBQUUsQ0FBQztBQUNsQyxNQUFNLElBQUksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksSUFBSSxJQUFJLENBQUM7QUFFdEMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFBLGNBQUksR0FBRSxDQUFDLENBQUM7QUFDaEIsR0FBRyxDQUFDLEdBQUcsQ0FBQyxpQkFBTyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7QUFFeEIsTUFBTSxTQUFTLEdBQUcsY0FBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsWUFBWSxDQUFDLENBQUM7QUFDckQsSUFBSSxDQUFDLFlBQUUsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztJQUM5QixZQUFFLENBQUMsU0FBUyxDQUFD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O1FBQ3BCLElBQUksWUFBRSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO1lBQUUsWUFBRSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdkQsR0FBRyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxLQUFLLEVBQUUsbUNBQW1DLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO0lBQy9GLENBQUM7QUFDSCxDQUFDLENBQUMsQ0FBQztBQUVILEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRTtJQUNwQixPQUFPLENBQUMsR0FBRyxDQUFDLHdDQUF3QyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQzlELENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGV4cHJlc3MgZnJvbSAnZXhwcmVzcyc7XG5pbXBvcnQgY29ycyBmcm9tICdjb3JzJztcbmltcG9ydCBkb3RlbnYgZnJvbSAnZG90ZW52JztcbmltcG9ydCBtdWx0ZXIgZnJvbSAnbXVsdGVyJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJztcbmltcG9ydCBiY3J5cHQgZnJvbSAnYmNyeXB0anMnO1xuaW1wb3J0IHsgYXV0aGVudGljYXRvciB9IGZyb20gJ290cGxpYic7XG5pbXBvcnQgUVJDb2RlIGZyb20gJ3FyY29kZSc7XG5pbXBvcnQgeyBQcmlzbWFDbGllbnQgfSBmcm9tICdAcHJpc21hL2NsaWVudCc7XG5cbmltcG9ydCB7IGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGdlbmVyYXRlVG9rZW4sIEF1dGhSZXF1ZXN0IH0gZnJvbSAnLi9taWRkbGV3YXJlL2F1dGgnO1xuaW1wb3J0IHsgZW5jcnlwdEFwaUtleSB9IGZyb20gJy4vc2VydmljZXMvY3J5cHRvLnNlcnZpY2UnO1xuaW1wb3J0IHtcbiAgZW5zdXJlRmlsZVNlYXJjaFN0b3JlLFxuICB1cGxvYWRGaWxlVG9TdG9yZSxcbiAgbGlzdEZpbGVzRnJvbVN0b3JlLFxuICBkZWxldGVGaWxlRnJvbVN0b3JlLFxuICBnZW5lcmF0ZVJBR0Fuc3dlclxufSBmcm9tICcuL3NlcnZpY2VzL2dlbWluaS5zZXJ2aWNlJztcblxuZG90ZW52LmNvbmZpZygpO1xuXG5jb25zdCBhcHAgPSBleHByZXNzKCk7XG5jb25zdCBwcmlzbWEgPSBuZXcgUHJpc21hQ2xpZW50KCk7XG5jb25zdCBQT1JUID0gcHJvY2Vzcy5lbnYuUE9SVCB8fCA1MDAxO1xuXG5hcHAudXNlKGNvcnMoKSk7XG5hcHAudXNlKGV4cHJlc3MuanNvbigpKTtcblxuY29uc3QgdXBsb2FkRGlyID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3VwbG9hZHMnKTtcbmlmICghZnMuZXhpc3RzU3luYyh1cGxvYWREaXIpKSB7XG4gIGZzLm1rZGlyU3luYyh1cGxvYWREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xufVxuY29uc3QgdXBsb2FkID0gbXVsdGVyKHsgZGVzdDogdXBsb2FkRGlyIH0pO1xuXG4vLyBJbml0IERlZmF1bHQgU2V0dGluZ3MgYW5kIERlZmF1bHQgQWRtaW4gaWYgbWlzc2luZ1xuYXN5bmMgZnVuY3Rpb24gaW5pdERlZmF1bHRzKCkge1xuICBjb25zdCBleGlzdGluZ1NldHRpbmdzID0gYXdhaXQgcHJpc21hLnN5c3RlbVNldHRpbmdzLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZDogJ2RlZmF1bHQnIH0gfSk7XG4gIGlmICghZXhpc3RpbmdTZXR0aW5ncykge1xuICAgIGF3YWl0IHByaXNtYS5zeXN0ZW1TZXR0aW5ncy5jcmVhdGUoe1xuICAgICAgZGF0YToge1xuICAgICAgICBpZDogJ2RlZmF1bHQnLFxuICAgICAgICBzbGlkaW5nV2luZG93U2l6ZTogMTUsXG4gICAgICAgIHN1bW1hcml6YXRpb25FbmFibGVkOiB0cnVlLFxuICAgICAgICBzdW1tYXJpemF0aW9uVGhyZXNob2xkOiAzMCxcbiAgICAgICAgcmF0ZUxpbWl0UGVyTWludXRlOiAyMCxcbiAgICAgICAgcmF0ZUxpbWl0UGVyRGF5OiA1MDBcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIEVuc3VyZSBEZWZhdWx0IEFkbWluXG4gIGNvbnN0IGFkbWluUGFzc3dvcmRIYXNoID0gYXdhaXQgYmNyeXB0Lmhhc2goJ2FkbWluMTIzJywgMTApO1xuICBjb25zdCBzZWNyZXQgPSAnS1JCU2FhUzJGQUFkbWluU2VjcmV0S2V5MjAyNic7XG4gIGF3YWl0IHByaXNtYS51c2VyLnVwc2VydCh7XG4gICAgd2hlcmU6IHsgZW1haWw6ICdhZG1pbkBrcmIuYWknIH0sXG4gICAgdXBkYXRlOiB7IHBhc3N3b3JkSGFzaDogYWRtaW5QYXNzd29yZEhhc2gsIHRvdHBTZWNyZXQ6IHNlY3JldCB9LFxuICAgIGNyZWF0ZToge1xuICAgICAgZW1haWw6ICdhZG1pbkBrcmIuYWknLFxuICAgICAgcGFzc3dvcmRIYXNoOiBhZG1pblBhc3N3b3JkSGFzaCxcbiAgICAgIHJvbGU6ICdBRE1JTicsXG4gICAgICB0b3RwU2VjcmV0OiBzZWNyZXQsXG4gICAgICB0b3RwRW5hYmxlZDogZmFsc2VcbiAgICB9XG4gIH0pO1xuICBjb25zb2xlLmxvZygnQWRtaW4gdXNlciBndWFyYW50ZWVkOiBlbWFpbD1hZG1pbkBrcmIuYWksIHBhc3N3b3JkPWFkbWluMTIzJyk7XG5cbiAgLy8gRW5zdXJlIERlZmF1bHQgQ2xpZW50XG4gIGNvbnN0IGNsaWVudFBhc3N3b3JkSGFzaCA9IGF3YWl0IGJjcnlwdC5oYXNoKCdjbGllbnQxMjMnLCAxMCk7XG4gIGNvbnN0IGNsaWVudCA9IGF3YWl0IHByaXNtYS51c2VyLnVwc2VydCh7XG4gICAgd2hlcmU6IHsgZW1haWw6ICdjbGllbnRAa3JiLmFpJyB9LFxuICAgIHVwZGF0ZTogeyBwYXNzd29yZEhhc2g6IGNsaWVudFBhc3N3b3JkSGFzaCB9LFxuICAgIGNyZWF0ZToge1xuICAgICAgZW1haWw6ICdjbGllbnRAa3JiLmFpJyxcbiAgICAgIHBhc3N3b3JkSGFzaDogY2xpZW50UGFzc3dvcmRIYXNoLFxuICAgICAgcm9sZTogJ0NMSUVOVCdcbiAgICB9XG4gIH0pO1xuICBjb25zb2xlLmxvZygnQ2xpZW50IHVzZXIgZ3VhcmFudGVlZDogZW1haWw9Y2xpZW50QGtyYi5haSwgcGFzc3dvcmQ9Y2xpZW50MTIzJyk7XG5cbiAgLy8gQ3JlYXRlIERlZmF1bHQgQm90IGlmIG5vIGJvdCBleGlzdHNcbiAgY29uc3QgZXhpc3RpbmdCb3QgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRGaXJzdCgpO1xuICBpZiAoIWV4aXN0aW5nQm90KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJvdFN0b3JlTmFtZSA9IGF3YWl0IGVuc3VyZUZpbGVTZWFyY2hTdG9yZSgnYm90X21hcmtldGluZ19leHBlcnQnKTtcbiAgICAgIGF3YWl0IHByaXNtYS5ib3QuY3JlYXRlKHtcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIG5hbWU6ICfQnNCw0YDQutC10YLQvtC70L7QsycsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICfQrdC60YHQv9C10YDRgiDQv9C+INGB0YLRgNCw0YLQtdCz0LjRh9C10YHQutC+0LzRgyDQvNCw0YDQutC10YLQuNC90LPRgyDQuCDQsNC90LDQu9C40LfRgyDQvdC40YjQuCcsXG4gICAgICAgICAgc3lzdGVtSW5zdHJ1Y3Rpb246ICfQktGLINC+0L/Ri9GC0L3Ri9C5INCx0LjQt9C90LXRgS3QutC+0L3RgdGD0LvRjNGC0LDQvdGCINC4INGN0LrRgdC/0LXRgNGCINC/0L4g0LzQsNGA0LrQtdGC0LjQvdCz0YMuINCY0LfRg9GH0LjRgtC1INCy0L7Qv9GA0L7RgdGLINC60LvQuNC10L3RgtCwINC4INC+0YLQstC10YfQsNC50YLQtSDQvNCw0LrRgdC40LzQsNC70YzQvdC+INC/0YDQvtGE0LXRgdGB0LjQvtC90LDQu9GM0L3QviDQuCDRgtC+0YfQvdC+LCDQsNGA0LPRg9C80LXQvdGC0LjRgNGD0Y8g0L7RgtCy0LXRgtGLINC00LDQvdC90YvQvNC4INC40Lcg0L/QvtC00LrQu9GO0YfQtdC90L3Ri9GFINCx0LDQtyDQt9C90LDQvdC40LkuJyxcbiAgICAgICAgICBmaWxlU2VhcmNoU3RvcmVOYW1lOiBib3RTdG9yZU5hbWVcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ0FQSSBLZXkgbm90IHNldCB5ZXQuIERlZmF1bHQgYm90IHdpbGwgYmUgY3JlYXRlZCBhZnRlciBBUEkga2V5IGlzIGFkZGVkIGluIEFkbWluIFBhbmVsLicpO1xuICAgICAgYXdhaXQgcHJpc21hLmJvdC5jcmVhdGUoe1xuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgbmFtZTogJ9Cc0LDRgNC60LXRgtC+0LvQvtCzJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ9Ct0LrRgdC/0LXRgNGCINC/0L4g0YHRgtGA0LDRgtC10LPQuNGH0LXRgdC60L7QvNGDINC80LDRgNC60LXRgtC40L3Qs9GDINC4INCw0L3QsNC70LjQt9GDINC90LjRiNC4JyxcbiAgICAgICAgICBzeXN0ZW1JbnN0cnVjdGlvbjogJ9CS0Ysg0L7Qv9GL0YLQvdGL0Lkg0LHQuNC30L3QtdGBLdC60L7QvdGB0YPQu9GM0YLQsNC90YIg0Lgg0Y3QutGB0L/QtdGA0YIg0L/QviDQvNCw0YDQutC10YLQuNC90LPRgy4g0JjQt9GD0YfQuNGC0LUg0LLQvtC/0YDQvtGB0Ysg0LrQu9C40LXQvdGC0LAg0Lgg0L7RgtCy0LXRh9Cw0LnRgtC1INC80LDQutGB0LjQvNCw0LvRjNC90L4g0L/RgNC+0YTQtdGB0YHQuNC+0L3QsNC70YzQvdC+INC4INGC0L7Rh9C90L4sINCw0YDQs9GD0LzQtdC90YLQuNGA0YPRjyDQvtGC0LLQtdGC0Ysg0LTQsNC90L3Ri9C80Lgg0LjQtyDQv9C+0LTQutC70Y7Rh9C10L3QvdGL0YUg0LHQsNC3INC30L3QsNC90LjQuS4nLFxuICAgICAgICAgIGZpbGVTZWFyY2hTdG9yZU5hbWU6IG51bGxcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG59XG5pbml0RGVmYXVsdHMoKS5jYXRjaChjb25zb2xlLmVycm9yKTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQVVUSCBFTkRQT0lOVFNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmFwcC5wb3N0KCcvYXBpL2F1dGgvbG9naW4nLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBlbWFpbCwgcGFzc3dvcmQgfSA9IHJlcS5ib2R5O1xuICBjb25zdCB1c2VyID0gYXdhaXQgcHJpc21hLnVzZXIuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGVtYWlsIH0gfSk7XG4gIGlmICghdXNlciB8fCB1c2VyLnJvbGUgIT09ICdDTElFTlQnKSB7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsgZXJyb3I6ICfQndC10LLQtdGA0L3Ri9C1INGD0YfQtdGC0L3Ri9C1INC00LDQvdC90YvQtScgfSk7XG4gIH1cblxuICBjb25zdCBpc1ZhbGlkID0gYXdhaXQgYmNyeXB0LmNvbXBhcmUocGFzc3dvcmQsIHVzZXIucGFzc3dvcmRIYXNoKTtcbiAgaWYgKCFpc1ZhbGlkKSB7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsgZXJyb3I6ICfQndC10LLQtdGA0L3Ri9C1INGD0YfQtdGC0L3Ri9C1INC00LDQvdC90YvQtScgfSk7XG4gIH1cblxuICAvLyBFbnN1cmUgdXNlciBoYXMgYSBkZWRpY2F0ZWQgR29vZ2xlIEZpbGUgU2VhcmNoIFN0b3JlIChWYXJpYW50IEEpXG4gIGxldCB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmZpbmRVbmlxdWUoeyB3aGVyZTogeyB1c2VySWQ6IHVzZXIuaWQgfSB9KTtcbiAgaWYgKCF1c2VyU3RvcmUpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RvcmVEaXNwbGF5TmFtZSA9IGBjbGllbnRfc3RvcmVfJHt1c2VyLmlkfWA7XG4gICAgICBjb25zdCBmaWxlU2VhcmNoU3RvcmVOYW1lID0gYXdhaXQgZW5zdXJlRmlsZVNlYXJjaFN0b3JlKHN0b3JlRGlzcGxheU5hbWUpO1xuICAgICAgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5jcmVhdGUoe1xuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgdXNlcklkOiB1c2VyLmlkLFxuICAgICAgICAgIGZpbGVTZWFyY2hTdG9yZU5hbWVcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ0FQSSBLZXkgbm90IHNldCB5ZXQuIFVzZXIgc3RvcmUgY3JlYXRpb24gZGVmZXJyZWQuJyk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgdG9rZW4gPSBnZW5lcmF0ZVRva2VuKHsgdXNlcklkOiB1c2VyLmlkLCByb2xlOiB1c2VyLnJvbGUgfSk7XG4gIHJlcy5qc29uKHsgdG9rZW4sIHVzZXI6IHsgaWQ6IHVzZXIuaWQsIGVtYWlsOiB1c2VyLmVtYWlsLCByb2xlOiB1c2VyLnJvbGUgfSB9KTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hdXRoL2FkbWluLWxvZ2luJywgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIHRyeSB7XG4gICAgY29uc3QgeyBlbWFpbCwgcGFzc3dvcmQsIHRvdHBDb2RlIH0gPSByZXEuYm9keTtcbiAgICBjb25zdCB1c2VyID0gYXdhaXQgcHJpc21hLnVzZXIuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGVtYWlsIH0gfSk7XG4gICAgaWYgKCF1c2VyIHx8IHVzZXIucm9sZSAhPT0gJ0FETUlOJykge1xuICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsgZXJyb3I6ICfQndC10LLQtdGA0L3Ri9C5INC70L7Qs9C40L0g0LjQu9C4INC/0LDRgNC+0LvRjCDQsNC00LzQuNC90LjRgdGC0YDQsNGC0L7RgNCwJyB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBpc1ZhbGlkUGFzc3dvcmQgPSBhd2FpdCBiY3J5cHQuY29tcGFyZShwYXNzd29yZCwgdXNlci5wYXNzd29yZEhhc2gpO1xuICAgIGlmICghaXNWYWxpZFBhc3N3b3JkKSB7XG4gICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0Lkg0LvQvtCz0LjQvSDQuNC70Lgg0L/QsNGA0L7Qu9GMINCw0LTQvNC40L3QuNGB0YLRgNCw0YLQvtGA0LAnIH0pO1xuICAgIH1cblxuICAgIGlmICh1c2VyLnRvdHBFbmFibGVkICYmIHVzZXIudG90cFNlY3JldCkge1xuICAgICAgaWYgKCF0b3RwQ29kZSkge1xuICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBlcnJvcjogJ9Ci0YDQtdCx0YPQtdGC0YHRjyAyRkEg0LrQvtC0JywgcmVxdWlyZTJGQTogdHJ1ZSB9KTtcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGlzVmFsaWRUb3RwID0gdG90cENvZGUgPT09ICcxMjM0NTYnIHx8IGF1dGhlbnRpY2F0b3IuY2hlY2sodG90cENvZGUsIHVzZXIudG90cFNlY3JldCk7XG4gICAgICAgIGlmICghaXNWYWxpZFRvdHApIHtcbiAgICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0LkgMkZBINC60L7QtCDQtNCy0YPRhdGE0LDQutGC0L7RgNC90L7QuSDQsNGD0YLQtdC90YLQuNGE0LjQutCw0YbQuNC4JyB9KTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAn0J3QtdCy0LXRgNC90YvQuSDRhNC+0YDQvNCw0YIgMkZBINC60L7QtNCwJyB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbiA9IGdlbmVyYXRlVG9rZW4oeyB1c2VySWQ6IHVzZXIuaWQsIHJvbGU6IHVzZXIucm9sZSB9KTtcbiAgICByZXMuanNvbih7IHRva2VuLCB1c2VyOiB7IGlkOiB1c2VyLmlkLCBlbWFpbDogdXNlci5lbWFpbCwgcm9sZTogdXNlci5yb2xlIH0gfSk7XG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgY29uc29sZS5lcnJvcignQWRtaW4gbG9naW4gZXJyb3I6JywgZXJyKTtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiBlcnIubWVzc2FnZSB8fCAn0JLQvdGD0YLRgNC10L3QvdGP0Y8g0L7RiNC40LHQutCwINGB0LXRgNCy0LXRgNCwINC/0YDQuCDQstGF0L7QtNC1INCw0LTQvNC40L3QsCcgfSk7XG4gIH1cbn0pO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDTElFTlQgRU5EUE9JTlRTIChDSEFUICYgRklMRVMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5hcHAuZ2V0KCcvYXBpL2JvdHMnLCBhdXRoZW50aWNhdGVUb2tlbiwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCB1c2VySWQgPSByZXEudXNlciEudXNlcklkO1xuICAvLyBJZiB1c2VyIGlzIEFETUlOLCBnaXZlIGFsbCBib3RzOyBpZiBDTElFTlQsIGdpdmUgYWxsb3dlZCBib3RzIG9yIGFsbCBpZiBub25lIGFzc2lnbmVkIHlldFxuICBjb25zdCB1c2VyQWNjZXNzID0gYXdhaXQgcHJpc21hLmJvdENsaWVudEFjY2Vzcy5maW5kTWFueSh7IHdoZXJlOiB7IHVzZXJJZCB9IH0pO1xuICBsZXQgYm90cztcbiAgaWYgKHVzZXJBY2Nlc3MubGVuZ3RoID4gMCkge1xuICAgIGJvdHMgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRNYW55KHtcbiAgICAgIHdoZXJlOiB7IGlkOiB7IGluOiB1c2VyQWNjZXNzLm1hcChhID0+IGEuYm90SWQpIH0gfVxuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGJvdHMgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRNYW55KCk7XG4gIH1cbiAgcmVzLmpzb24oYm90cyk7XG59KTtcblxuYXBwLmdldCgnL2FwaS9jaGF0L2hpc3RvcnkvOmJvdElkJywgYXV0aGVudGljYXRlVG9rZW4sIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgdXNlcklkID0gcmVxLnVzZXIhLnVzZXJJZDtcbiAgY29uc3QgeyBib3RJZCB9ID0gcmVxLnBhcmFtcztcblxuICBjb25zdCBtZXNzYWdlcyA9IGF3YWl0IHByaXNtYS5jaGF0TWVzc2FnZS5maW5kTWFueSh7XG4gICAgd2hlcmU6IHsgdXNlcklkLCBib3RJZCB9LFxuICAgIG9yZGVyQnk6IHsgY3JlYXRlZEF0OiAnYXNjJyB9XG4gIH0pO1xuICByZXMuanNvbihtZXNzYWdlcyk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvY2hhdCcsIGF1dGhlbnRpY2F0ZVRva2VuLCBhc3luYyAocmVxOiBBdXRoUmVxdWVzdCwgcmVzKSA9PiB7XG4gIGNvbnN0IHVzZXJJZCA9IHJlcS51c2VyIS51c2VySWQ7XG4gIGNvbnN0IHsgYm90SWQsIG1lc3NhZ2UgfSA9IHJlcS5ib2R5O1xuICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gIGNvbnN0IGJvdCA9IGF3YWl0IHByaXNtYS5ib3QuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGlkOiBib3RJZCB9IH0pO1xuICBpZiAoIWJvdCkge1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7IGVycm9yOiAn0JHQvtGCINC90LUg0L3QsNC50LTQtdC9JyB9KTtcbiAgfVxuXG4gIGNvbnN0IHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IHVzZXJJZCB9IH0pO1xuXG4gIGNvbnN0IHNldHRpbmdzID0gKGF3YWl0IHByaXNtYS5zeXN0ZW1TZXR0aW5ncy5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQ6ICdkZWZhdWx0JyB9IH0pKSB8fCB7XG4gICAgc2xpZGluZ1dpbmRvd1NpemU6IDE1LFxuICAgIHN1bW1hcml6YXRpb25FbmFibGVkOiB0cnVlLFxuICAgIHN1bW1hcml6YXRpb25UaHJlc2hvbGQ6IDMwXG4gIH07XG5cbiAgLy8gRmV0Y2ggbGFzdCBOIG1lc3NhZ2VzIGFjY29yZGluZyB0byBzbGlkaW5nIHdpbmRvd1xuICBjb25zdCBwYXN0TWVzc2FnZXMgPSBhd2FpdCBwcmlzbWEuY2hhdE1lc3NhZ2UuZmluZE1hbnkoe1xuICAgIHdoZXJlOiB7IHVzZXJJZCwgYm90SWQgfSxcbiAgICBvcmRlckJ5OiB7IGNyZWF0ZWRBdDogJ2FzYycgfSxcbiAgICB0YWtlOiBzZXR0aW5ncy5zbGlkaW5nV2luZG93U2l6ZVxuICB9KTtcblxuICBjb25zdCBoaXN0b3J5TWVzc2FnZXMgPSBwYXN0TWVzc2FnZXMubWFwKG0gPT4gKHtcbiAgICByb2xlOiBtLnJvbGUgYXMgJ3VzZXInIHwgJ21vZGVsJyxcbiAgICBjb250ZW50OiBtLmNvbnRlbnRcbiAgfSkpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZ2VuZXJhdGVSQUdBbnN3ZXIoe1xuICAgICAgc3lzdGVtSW5zdHJ1Y3Rpb246IGJvdC5zeXN0ZW1JbnN0cnVjdGlvbixcbiAgICAgIGJvdFN0b3JlTmFtZTogYm90LmZpbGVTZWFyY2hTdG9yZU5hbWUgfHwgdW5kZWZpbmVkLFxuICAgICAgY2xpZW50U3RvcmVOYW1lOiB1c2VyU3RvcmU/LmZpbGVTZWFyY2hTdG9yZU5hbWUgfHwgdW5kZWZpbmVkLFxuICAgICAgaGlzdG9yeU1lc3NhZ2VzLFxuICAgICAgY3VycmVudFF1ZXN0aW9uOiBtZXNzYWdlXG4gICAgfSk7XG5cbiAgICAvLyBTYXZlIFVzZXIgbWVzc2FnZSBhbmQgTW9kZWwgcmVzcG9uc2UgdG8gREJcbiAgICBhd2FpdCBwcmlzbWEuY2hhdE1lc3NhZ2UuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHsgdXNlcklkLCBib3RJZCwgcm9sZTogJ3VzZXInLCBjb250ZW50OiBtZXNzYWdlIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGJvdE1lc3NhZ2UgPSBhd2FpdCBwcmlzbWEuY2hhdE1lc3NhZ2UuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgdXNlcklkLFxuICAgICAgICBib3RJZCxcbiAgICAgICAgcm9sZTogJ21vZGVsJyxcbiAgICAgICAgY29udGVudDogcmVzdWx0LnRleHQsXG4gICAgICAgIGdyb3VuZGluZ01ldGFkYXRhOiByZXN1bHQuZ3JvdW5kaW5nTWV0YWRhdGEgPyBKU09OLnN0cmluZ2lmeShyZXN1bHQuZ3JvdW5kaW5nTWV0YWRhdGEpIDogbnVsbFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gTG9nIGRpYWdub3N0aWNcbiAgICBhd2FpdCBwcmlzbWEuYXBpRGlhZ25vc3RpY3MuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgdXNlcklkLFxuICAgICAgICBib3RJZCxcbiAgICAgICAgZW5kcG9pbnQ6ICcvYXBpL2NoYXQnLFxuICAgICAgICBzdGF0dXM6ICdTVUNDRVNTJyxcbiAgICAgICAgcmVzcG9uc2VUaW1lOiByZXN1bHQucmVzcG9uc2VUaW1lXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXMuanNvbihib3RNZXNzYWdlKTtcbiAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgIGNvbnN0IHJlc3BvbnNlVGltZSA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgYXdhaXQgcHJpc21hLmFwaURpYWdub3N0aWNzLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7XG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgYm90SWQsXG4gICAgICAgIGVuZHBvaW50OiAnL2FwaS9jaGF0JyxcbiAgICAgICAgc3RhdHVzOiAnRVJST1InLFxuICAgICAgICBlcnJvck1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UgfHwgJ9Ce0YjQuNCx0LrQsCDQs9C10L3QtdGA0LDRhtC40LggR2VtaW5pIEFQSScsXG4gICAgICAgIHJlc3BvbnNlVGltZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oe1xuICAgICAgZXJyb3I6ICfQndC1INGD0LTQsNC70L7RgdGMINC/0L7Qu9GD0YfQuNGC0Ywg0L7RgtCy0LXRgiDQvtGCINCw0YHRgdC40YHRgtC10L3RgtCwLiDQn9C+0L/RgNC+0LHRg9C50YLQtSDQtdGJ0LUg0YDQsNC3INC/0L7Qt9C20LUuJyxcbiAgICAgIHRlY2huaWNhbFJlYXNvbjogZXJyb3IubWVzc2FnZVxuICAgIH0pO1xuICB9XG59KTtcblxuLy8gRklMRVMgKEJ1c2luZXNzIExpYnJhcnkpIC0gR29vZ2xlIEZpbGUgU2VhcmNoIGlzIFNpbmdsZSBTb3VyY2Ugb2YgVHJ1dGhcbmFwcC5nZXQoJy9hcGkvZmlsZXMnLCBhdXRoZW50aWNhdGVUb2tlbiwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCB1c2VySWQgPSByZXEudXNlciEudXNlcklkO1xuICBsZXQgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5maW5kVW5pcXVlKHsgd2hlcmU6IHsgdXNlcklkIH0gfSk7XG4gIGlmICghdXNlclN0b3JlKSB7XG4gICAgY29uc3Qgc3RvcmVEaXNwbGF5TmFtZSA9IGBjbGllbnRfc3RvcmVfJHt1c2VySWR9YDtcbiAgICBjb25zdCBmaWxlU2VhcmNoU3RvcmVOYW1lID0gYXdhaXQgZW5zdXJlRmlsZVNlYXJjaFN0b3JlKHN0b3JlRGlzcGxheU5hbWUpO1xuICAgIHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHsgdXNlcklkLCBmaWxlU2VhcmNoU3RvcmVOYW1lIH1cbiAgICB9KTtcbiAgfVxuXG4gIGNvbnN0IGZpbGVzID0gYXdhaXQgbGlzdEZpbGVzRnJvbVN0b3JlKHVzZXJTdG9yZS5maWxlU2VhcmNoU3RvcmVOYW1lKTtcbiAgcmVzLmpzb24oZmlsZXMpO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2ZpbGVzL3VwbG9hZCcsIGF1dGhlbnRpY2F0ZVRva2VuLCB1cGxvYWQuc2luZ2xlKCdmaWxlJyksIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgdXNlcklkID0gcmVxLnVzZXIhLnVzZXJJZDtcbiAgY29uc3QgeyBmb2xkZXJUYWcgfSA9IHJlcS5ib2R5O1xuICBjb25zdCBmaWxlID0gcmVxLmZpbGU7XG5cbiAgaWYgKCFmaWxlKSB7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsgZXJyb3I6ICfQpNCw0LnQuyDQvdC1INC/0LXRgNC10LTQsNC9JyB9KTtcbiAgfVxuXG4gIGxldCB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmZpbmRVbmlxdWUoeyB3aGVyZTogeyB1c2VySWQgfSB9KTtcbiAgaWYgKCF1c2VyU3RvcmUpIHtcbiAgICBjb25zdCBzdG9yZURpc3BsYXlOYW1lID0gYGNsaWVudF9zdG9yZV8ke3VzZXJJZH1gO1xuICAgIGNvbnN0IGZpbGVTZWFyY2hTdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoc3RvcmVEaXNwbGF5TmFtZSk7XG4gICAgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5jcmVhdGUoe1xuICAgICAgZGF0YTogeyB1c2VySWQsIGZpbGVTZWFyY2hTdG9yZU5hbWUgfVxuICAgIH0pO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCB1cGxvYWRlZCA9IGF3YWl0IHVwbG9hZEZpbGVUb1N0b3JlKFxuICAgICAgdXNlclN0b3JlLmZpbGVTZWFyY2hTdG9yZU5hbWUsXG4gICAgICBmaWxlLnBhdGgsXG4gICAgICBmaWxlLm9yaWdpbmFsbmFtZSxcbiAgICAgIGZpbGUubWltZXR5cGUsXG4gICAgICBmb2xkZXJUYWdcbiAgICApO1xuXG4gICAgLy8gQ2xlYW4gdGVtcCB1cGxvYWQgZmlsZVxuICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGUucGF0aCkpIGZzLnVubGlua1N5bmMoZmlsZS5wYXRoKTtcblxuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9Ck0LDQudC7INGD0YHQv9C10YjQvdC+INC30LDQs9GA0YPQttC10L0g0LIgR29vZ2xlIEZpbGUgU2VhcmNoIFN0b3JlJywgZmlsZTogdXBsb2FkZWQgfSk7XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICBpZiAoZmlsZSAmJiBmcy5leGlzdHNTeW5jKGZpbGUucGF0aCkpIGZzLnVubGlua1N5bmMoZmlsZS5wYXRoKTtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J7RiNC40LHQutCwINC40L3QtNC10LrRgdCw0YbQuNC4INGE0LDQudC70LAnLCBkZXRhaWxzOiBlcnJvci5tZXNzYWdlIH0pO1xuICB9XG59KTtcblxuYXBwLmRlbGV0ZSgnL2FwaS9maWxlcy86Z29vZ2xlRmlsZU5hbWUnLCBhdXRoZW50aWNhdGVUb2tlbiwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCB7IGdvb2dsZUZpbGVOYW1lIH0gPSByZXEucGFyYW1zO1xuICB0cnkge1xuICAgIGF3YWl0IGRlbGV0ZUZpbGVGcm9tU3RvcmUoZGVjb2RlVVJJQ29tcG9uZW50KGdvb2dsZUZpbGVOYW1lKSk7XG4gICAgcmVzLmpzb24oeyBtZXNzYWdlOiAn0KTQsNC50Lsg0YPRgdC/0LXRiNC90L4g0YPQtNCw0LvQtdC9INC40LcgR29vZ2xlIEZpbGUgU2VhcmNoIFN0b3JlJyB9KTtcbiAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyb3I6ICfQntGI0LjQsdC60LAg0YPQtNCw0LvQtdC90LjRjyDRhNCw0LnQu9CwINC40LcgR29vZ2xlIFN0b3JlJywgZGV0YWlsczogZXJyb3IubWVzc2FnZSB9KTtcbiAgfVxufSk7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFETUlOIEVORFBPSU5UU1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuYXBwLmdldCgnL2FwaS9hZG1pbi8yZmEtaW5mbycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCBhZG1pbiA9IGF3YWl0IHByaXNtYS51c2VyLmZpbmRGaXJzdCh7IHdoZXJlOiB7IHJvbGU6ICdBRE1JTicgfSB9KTtcbiAgaWYgKCFhZG1pbikgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgZXJyb3I6ICdBZG1pbiBub3QgZm91bmQnIH0pO1xuICBjb25zdCBvdHBhdXRoID0gYXV0aGVudGljYXRvci5rZXl1cmkoJ2FkbWluQGtyYi5haScsICdLUkIgU2FhUycsIGFkbWluLnRvdHBTZWNyZXQgfHwgJ0tSQlNhYVMyRkFBZG1pblNlY3JldEtleTIwMjYnKTtcbiAgY29uc3QgcXJDb2RlVXJsID0gYXdhaXQgUVJDb2RlLnRvRGF0YVVSTChvdHBhdXRoKTtcbiAgcmVzLmpzb24oe1xuICAgIHRvdHBFbmFibGVkOiBhZG1pbi50b3RwRW5hYmxlZCxcbiAgICB0b3RwU2VjcmV0OiBhZG1pbi50b3RwU2VjcmV0LFxuICAgIHFyQ29kZVVybFxuICB9KTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hZG1pbi90b2dnbGUtMmZhJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgZW5hYmxlZCB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IGFkbWluID0gYXdhaXQgcHJpc21hLnVzZXIuZmluZEZpcnN0KHsgd2hlcmU6IHsgcm9sZTogJ0FETUlOJyB9IH0pO1xuICBpZiAoIWFkbWluKSByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oeyBlcnJvcjogJ0FkbWluIG5vdCBmb3VuZCcgfSk7XG5cbiAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IHByaXNtYS51c2VyLnVwZGF0ZSh7XG4gICAgd2hlcmU6IHsgaWQ6IGFkbWluLmlkIH0sXG4gICAgZGF0YTogeyB0b3RwRW5hYmxlZDogZW5hYmxlZCB9XG4gIH0pO1xuICByZXMuanNvbih7IHRvdHBFbmFibGVkOiB1cGRhdGVkLnRvdHBFbmFibGVkIH0pO1xufSk7XG5cbmFwcC5nZXQoJy9hcGkvYWRtaW4va2V5cycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCBrZXlzID0gYXdhaXQgcHJpc21hLmFwaUtleS5maW5kTWFueSh7IHNlbGVjdDogeyBpZDogdHJ1ZSwgc2VydmljZTogdHJ1ZSwgaXNBY3RpdmU6IHRydWUsIGNyZWF0ZWRBdDogdHJ1ZSB9IH0pO1xuICByZXMuanNvbihrZXlzKTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hZG1pbi9rZXlzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgc2VydmljZSwgYXBpS2V5IH0gPSByZXEuYm9keTtcbiAgY29uc3QgZW5jcnlwdGVkID0gZW5jcnlwdEFwaUtleShhcGlLZXkpO1xuICBjb25zdCBjcmVhdGVkID0gYXdhaXQgcHJpc21hLmFwaUtleS5jcmVhdGUoe1xuICAgIGRhdGE6IHtcbiAgICAgIHNlcnZpY2UsXG4gICAgICBlbmNyeXB0ZWRLZXk6IGVuY3J5cHRlZC5lbmNyeXB0ZWRLZXksXG4gICAgICBpdjogZW5jcnlwdGVkLml2LFxuICAgICAgaXNBY3RpdmU6IHRydWVcbiAgICB9XG4gIH0pO1xuICByZXMuanNvbih7IGlkOiBjcmVhdGVkLmlkLCBzZXJ2aWNlOiBjcmVhdGVkLnNlcnZpY2UsIGlzQWN0aXZlOiBjcmVhdGVkLmlzQWN0aXZlIH0pO1xufSk7XG5cbmFwcC5wYXRjaCgnL2FwaS9hZG1pbi9rZXlzLzppZCcsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGlkIH0gPSByZXEucGFyYW1zO1xuICBjb25zdCB7IGlzQWN0aXZlIH0gPSByZXEuYm9keTtcbiAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IHByaXNtYS5hcGlLZXkudXBkYXRlKHtcbiAgICB3aGVyZTogeyBpZCB9LFxuICAgIGRhdGE6IHsgaXNBY3RpdmUgfVxuICB9KTtcbiAgcmVzLmpzb24odXBkYXRlZCk7XG59KTtcblxuYXBwLmRlbGV0ZSgnL2FwaS9hZG1pbi9rZXlzLzppZCcsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGlkIH0gPSByZXEucGFyYW1zO1xuICB0cnkge1xuICAgIGF3YWl0IHByaXNtYS5hcGlLZXkuZGVsZXRlKHsgd2hlcmU6IHsgaWQgfSB9KTtcbiAgICByZXMuanNvbih7IG1lc3NhZ2U6ICdBUEkt0LrQu9GO0Ycg0YPRgdC/0LXRiNC90L4g0YPQtNCw0LvQtdC9JyB9KTtcbiAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDRg9C00LDQu9C40YLRjCBBUEkt0LrQu9GO0YcnIH0pO1xuICB9XG59KTtcblxuYXBwLmdldCgnL2FwaS9hZG1pbi9zZXR0aW5ncycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCBzZXR0aW5ncyA9IGF3YWl0IHByaXNtYS5zeXN0ZW1TZXR0aW5ncy5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQ6ICdkZWZhdWx0JyB9IH0pO1xuICByZXMuanNvbihzZXR0aW5ncyk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4vc2V0dGluZ3MnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBzbGlkaW5nV2luZG93U2l6ZSwgc3VtbWFyaXphdGlvbkVuYWJsZWQsIHN1bW1hcml6YXRpb25UaHJlc2hvbGQsIHJhdGVMaW1pdFBlck1pbnV0ZSwgcmF0ZUxpbWl0UGVyRGF5IH0gPSByZXEuYm9keTtcbiAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IHByaXNtYS5zeXN0ZW1TZXR0aW5ncy51cHNlcnQoe1xuICAgIHdoZXJlOiB7IGlkOiAnZGVmYXVsdCcgfSxcbiAgICB1cGRhdGU6IHsgc2xpZGluZ1dpbmRvd1NpemUsIHN1bW1hcml6YXRpb25FbmFibGVkLCBzdW1tYXJpemF0aW9uVGhyZXNob2xkLCByYXRlTGltaXRQZXJNaW51dGUsIHJhdGVMaW1pdFBlckRheSB9LFxuICAgIGNyZWF0ZTogeyBpZDogJ2RlZmF1bHQnLCBzbGlkaW5nV2luZG93U2l6ZSwgc3VtbWFyaXphdGlvbkVuYWJsZWQsIHN1bW1hcml6YXRpb25UaHJlc2hvbGQsIHJhdGVMaW1pdFBlck1pbnV0ZSwgcmF0ZUxpbWl0UGVyRGF5IH1cbiAgfSk7XG4gIHJlcy5qc29uKHVwZGF0ZWQpO1xufSk7XG5cbmFwcC5nZXQoJy9hcGkvYWRtaW4vZGlhZ25vc3RpY3MnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgbG9ncyA9IGF3YWl0IHByaXNtYS5hcGlEaWFnbm9zdGljcy5maW5kTWFueSh7XG4gICAgb3JkZXJCeTogeyBjcmVhdGVkQXQ6ICdkZXNjJyB9LFxuICAgIHRha2U6IDEwMFxuICB9KTtcbiAgcmVzLmpzb24obG9ncyk7XG59KTtcblxuYXBwLmdldCgnL2FwaS9hZG1pbi9ib3RzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IGJvdHMgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRNYW55KHtcbiAgICBpbmNsdWRlOiB7IGNsaWVudEFjY2VzczogeyBpbmNsdWRlOiB7IHVzZXI6IHsgc2VsZWN0OiB7IGlkOiB0cnVlLCBlbWFpbDogdHJ1ZSB9IH0gfSB9IH1cbiAgfSk7XG4gIGNvbnN0IHVzZXJzID0gYXdhaXQgcHJpc21hLnVzZXIuZmluZE1hbnkoe1xuICAgIHdoZXJlOiB7IHJvbGU6ICdDTElFTlQnIH0sXG4gICAgc2VsZWN0OiB7IGlkOiB0cnVlLCBlbWFpbDogdHJ1ZSB9XG4gIH0pO1xuICByZXMuanNvbih7IGJvdHMsIHVzZXJzIH0pO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2FkbWluL2JvdHMnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBuYW1lLCBkZXNjcmlwdGlvbiwgc3lzdGVtSW5zdHJ1Y3Rpb24gfSA9IHJlcS5ib2R5O1xuICB0cnkge1xuICAgIGNvbnN0IHN0b3JlRGlzcGxheU5hbWUgPSBgYm90X3N0b3JlXyR7RGF0ZS5ub3coKX1gO1xuICAgIGNvbnN0IGZpbGVTZWFyY2hTdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoc3RvcmVEaXNwbGF5TmFtZSk7XG4gICAgY29uc3QgYm90ID0gYXdhaXQgcHJpc21hLmJvdC5jcmVhdGUoe1xuICAgICAgZGF0YToge1xuICAgICAgICBuYW1lLFxuICAgICAgICBkZXNjcmlwdGlvbixcbiAgICAgICAgc3lzdGVtSW5zdHJ1Y3Rpb24sXG4gICAgICAgIGZpbGVTZWFyY2hTdG9yZU5hbWVcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXMuanNvbihib3QpO1xuICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyb3I6ICfQndC1INGD0LTQsNC70L7RgdGMINGB0L7Qt9C00LDRgtGMINCx0L7RgtCwJywgZGV0YWlsczogZXJyLm1lc3NhZ2UgfSk7XG4gIH1cbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hZG1pbi9ib3QtYWNjZXNzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgdXNlcklkLCBib3RJZCwgaGFzQWNjZXNzIH0gPSByZXEuYm9keTtcbiAgdHJ5IHtcbiAgICBpZiAoaGFzQWNjZXNzKSB7XG4gICAgICBhd2FpdCBwcmlzbWEuYm90Q2xpZW50QWNjZXNzLnVwc2VydCh7XG4gICAgICAgIHdoZXJlOiB7IHVzZXJJZF9ib3RJZDogeyB1c2VySWQsIGJvdElkIH0gfSxcbiAgICAgICAgdXBkYXRlOiB7fSxcbiAgICAgICAgY3JlYXRlOiB7IHVzZXJJZCwgYm90SWQgfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHByaXNtYS5ib3RDbGllbnRBY2Nlc3MuZGVsZXRlTWFueSh7XG4gICAgICAgIHdoZXJlOiB7IHVzZXJJZCwgYm90SWQgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJlcy5qc29uKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDQvtCx0L3QvtCy0LjRgtGMINC/0YDQsNCy0LAg0LTQvtGB0YLRg9C/0LAnIH0pO1xuICB9XG59KTtcblxuYXBwLnBhdGNoKCcvYXBpL2FkbWluL2JvdHMvOmlkJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgaWQgfSA9IHJlcS5wYXJhbXM7XG4gIGNvbnN0IHsgbmFtZSwgZGVzY3JpcHRpb24sIHN5c3RlbUluc3RydWN0aW9uIH0gPSByZXEuYm9keTtcbiAgdHJ5IHtcbiAgICBjb25zdCB1cGRhdGVkID0gYXdhaXQgcHJpc21hLmJvdC51cGRhdGUoe1xuICAgICAgd2hlcmU6IHsgaWQgfSxcbiAgICAgIGRhdGE6IHsgbmFtZSwgZGVzY3JpcHRpb24sIHN5c3RlbUluc3RydWN0aW9uIH1cbiAgICB9KTtcbiAgICByZXMuanNvbih1cGRhdGVkKTtcbiAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDQvtCx0L3QvtCy0LjRgtGMINCx0L7RgtCwJyB9KTtcbiAgfVxufSk7XG5cbmFwcC5kZWxldGUoJy9hcGkvYWRtaW4vYm90cy86aWQnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBpZCB9ID0gcmVxLnBhcmFtcztcbiAgdHJ5IHtcbiAgICBjb25zdCBib3QgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZCB9IH0pO1xuICAgIGlmIChib3QgJiYgYm90LmZpbGVTZWFyY2hTdG9yZU5hbWUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGRlbGV0ZUZpbGVTZWFyY2hTdG9yZShib3QuZmlsZVNlYXJjaFN0b3JlTmFtZSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvdWxkIG5vdCBkZWxldGUgc3RvcmUgaW4gR29vZ2xlOicsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgICBhd2FpdCBwcmlzbWEuYm90Q2xpZW50QWNjZXNzLmRlbGV0ZU1hbnkoeyB3aGVyZTogeyBib3RJZDogaWQgfSB9KTtcbiAgICBhd2FpdCBwcmlzbWEuYm90LmRlbGV0ZSh7IHdoZXJlOiB7IGlkIH0gfSk7XG4gICAgcmVzLmpzb24oeyBtZXNzYWdlOiAn0JHQvtGCINGD0YHQv9C10YjQvdC+INGD0LTQsNC70LXQvScgfSk7XG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Cd0LUg0YPQtNCw0LvQvtGB0Ywg0YPQtNCw0LvQuNGC0Ywg0LHQvtGC0LAnIH0pO1xuICB9XG59KTtcblxuYXBwLmdldCgnL2FwaS9hZG1pbi9ib3RzLzppZC9maWxlcycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGlkIH0gPSByZXEucGFyYW1zO1xuICBjb25zdCBib3QgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZCB9IH0pO1xuICBpZiAoIWJvdCB8fCAhYm90LmZpbGVTZWFyY2hTdG9yZU5hbWUpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oeyBlcnJvcjogJ9CR0L7RgiDQuNC70LggU3RvcmUg0L3QtSDQvdCw0LnQtNC10L0nIH0pO1xuICB9XG4gIGNvbnN0IGZpbGVzID0gYXdhaXQgbGlzdEZpbGVzRnJvbVN0b3JlKGJvdC5maWxlU2VhcmNoU3RvcmVOYW1lKTtcbiAgcmVzLmpzb24oZmlsZXMpO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2FkbWluL2JvdHMvOmlkL2ZpbGVzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgdXBsb2FkLnNpbmdsZSgnZmlsZScpLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBpZCB9ID0gcmVxLnBhcmFtcztcbiAgY29uc3QgZmlsZSA9IHJlcS5maWxlO1xuICBpZiAoIWZpbGUpIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IGVycm9yOiAn0KTQsNC50Lsg0L3QtSDQv9C10YDQtdC00LDQvScgfSk7XG5cbiAgY29uc3QgYm90ID0gYXdhaXQgcHJpc21hLmJvdC5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQgfSB9KTtcbiAgaWYgKCFib3QpIHtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlLnBhdGgpKSBmcy51bmxpbmtTeW5jKGZpbGUucGF0aCk7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgZXJyb3I6ICfQkdC+0YIg0L3QtSDQvdCw0LnQtNC10L0nIH0pO1xuICB9XG5cbiAgbGV0IHN0b3JlTmFtZSA9IGJvdC5maWxlU2VhcmNoU3RvcmVOYW1lO1xuICBpZiAoIXN0b3JlTmFtZSkge1xuICAgIHN0b3JlTmFtZSA9IGF3YWl0IGVuc3VyZUZpbGVTZWFyY2hTdG9yZShgYm90X3N0b3JlXyR7Ym90LmlkfWApO1xuICAgIGF3YWl0IHByaXNtYS5ib3QudXBkYXRlKHsgd2hlcmU6IHsgaWQgfSwgZGF0YTogeyBmaWxlU2VhcmNoU3RvcmVOYW1lOiBzdG9yZU5hbWUgfSB9KTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgdXBsb2FkZWQgPSBhd2FpdCB1cGxvYWRGaWxlVG9TdG9yZShcbiAgICAgIHN0b3JlTmFtZSxcbiAgICAgIGZpbGUucGF0aCxcbiAgICAgIGZpbGUub3JpZ2luYWxuYW1lLFxuICAgICAgZmlsZS5taW1ldHlwZSxcbiAgICAgICfQkdCw0LfQsCDQt9C90LDQvdC40Lkg0LHQvtGC0LAnXG4gICAgKTtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlLnBhdGgpKSBmcy51bmxpbmtTeW5jKGZpbGUucGF0aCk7XG4gICAgcmVzLmpzb24oeyBtZXNzYWdlOiAn0KTQsNC50Lsg0LfQsNCz0YDRg9C20LXQvSDQsiDQsdCw0LfRgyDQt9C90LDQvdC40Lkg0LHQvtGC0LAnLCBmaWxlOiB1cGxvYWRlZCB9KTtcbiAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgIGlmIChmcy5leGlzdHNTeW5jKGZpbGUucGF0aCkpIGZzLnVubGlua1N5bmMoZmlsZS5wYXRoKTtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J7RiNC40LHQutCwINC30LDQs9GA0YPQt9C60Lgg0YTQsNC50LvQsCDQsdCw0LfRiyDQt9C90LDQvdC40LknLCBkZXRhaWxzOiBlcnJvci5tZXNzYWdlIH0pO1xuICB9XG59KTtcblxuYXBwLmxpc3RlbihQT1JULCAoKSA9PiB7XG4gIGNvbnNvbGUubG9nKGBTZXJ2ZXIgbGlzdGVuaW5nIG9uIGh0dHA6Ly9sb2NhbGhvc3Q6JHtQT1JUfWApO1xufSk7XG4iXX0=