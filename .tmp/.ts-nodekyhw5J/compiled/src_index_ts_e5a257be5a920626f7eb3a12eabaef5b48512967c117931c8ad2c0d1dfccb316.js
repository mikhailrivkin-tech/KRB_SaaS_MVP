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
    const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!existingAdmin) {
        const passwordHash = await bcryptjs_1.default.hash('admin123', 10);
        const secret = 'KRBSaaS2FAAdminSecretKey2026';
        await prisma.user.create({
            data: {
                email: 'admin@krb.ai',
                passwordHash,
                role: 'ADMIN',
                totpSecret: secret,
                totpEnabled: true
            }
        });
        console.log('Default Admin Created: email=admin@krb.ai, password=admin123, 2FA Secret=', secret);
    }
    // Create Default Client User for testing if not exists
    const existingClient = await prisma.user.findUnique({ where: { email: 'client@krb.ai' } });
    if (!existingClient) {
        const clientPasswordHash = await bcryptjs_1.default.hash('client123', 10);
        const newClient = await prisma.user.create({
            data: {
                email: 'client@krb.ai',
                passwordHash: clientPasswordHash,
                role: 'CLIENT'
            }
        });
        const storeDisplayName = `client_store_${newClient.id}`;
        try {
            const fileSearchStoreName = await (0, gemini_service_1.ensureFileSearchStore)(storeDisplayName);
            await prisma.userStore.create({
                data: { userId: newClient.id, fileSearchStoreName }
            });
        }
        catch (e) {
            console.warn('Store creation deferred until API key is active');
        }
    }
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
        const storeDisplayName = `client_store_${user.id}`;
        const fileSearchStoreName = await (0, gemini_service_1.ensureFileSearchStore)(storeDisplayName);
        userStore = await prisma.userStore.create({
            data: {
                userId: user.id,
                fileSearchStoreName
            }
        });
    }
    const token = (0, auth_1.generateToken)({ userId: user.id, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});
app.post('/api/auth/admin-login', async (req, res) => {
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
        const isValidTotp = otplib_1.authenticator.check(totpCode, user.totpSecret);
        if (!isValidTotp) {
            return res.status(401).json({ error: 'Неверный 2FA код двухфакторной аутентификации' });
        }
    }
    const token = (0, auth_1.generateToken)({ userId: user.id, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
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
app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL1VzZXJzL2dob3N0L0RvY3VtZW50cy9DbG91ZC9HRHJpdmUvbWlraGFpbF9yaXZraW4vQnVzaW5lc3MvUHJvamVjdHMvS1JCL0FudGlHcmF2aXR5L0tSQl9TYWFTX01WUC9zZXJ2ZXIvc3JjL2luZGV4LnRzIiwic291cmNlcyI6WyIvVXNlcnMvZ2hvc3QvRG9jdW1lbnRzL0Nsb3VkL0dEcml2ZS9taWtoYWlsX3Jpdmtpbi9CdXNpbmVzcy9Qcm9qZWN0cy9LUkIvQW50aUdyYXZpdHkvS1JCX1NhYVNfTVZQL3NlcnZlci9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxzREFBOEI7QUFDOUIsZ0RBQXdCO0FBQ3hCLG9EQUE0QjtBQUM1QixvREFBNEI7QUFDNUIsZ0RBQXdCO0FBQ3hCLDRDQUFvQjtBQUNwQix3REFBOEI7QUFDOUIsbUNBQXVDO0FBQ3ZDLG9EQUE0QjtBQUM1QiwyQ0FBOEM7QUFFOUMsNENBQWdHO0FBQ2hHLDhEQUEwRDtBQUMxRCw4REFNbUM7QUFFbkMsZ0JBQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQztBQUVoQixNQUFNLEdBQUcsR0FBRyxJQUFBLGlCQUFPLEdBQUUsQ0FBQztBQUN0QixNQUFNLE1BQU0sR0FBRyxJQUFJLHFCQUFZLEVBQUUsQ0FBQztBQUNsQyxNQUFNLElBQUksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksSUFBSSxJQUFJLENBQUM7QUFFdEMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFBLGNBQUksR0FBRSxDQUFDLENBQUM7QUFDaEIsR0FBRyxDQUFDLEdBQUcsQ0FBQyxpQkFBTyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7QUFFeEIsTUFBTSxTQUFTLEdBQUcsY0FBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsWUFBWSxDQUFDLENBQUM7QUFDckQsSUFBSSxDQUFDLFlBQUUsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztJQUM5QixZQUFFLENBQUMsU0FBUyxDQUFD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RSxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBRSxvQkFBb0IsRUFBRSxzQkFBc0IsRUFBRSxrQkFBa0IsRUFBRSxlQUFlLEVBQUU7S0FDaEksQ0FBQyxDQUFDO0lBQ0gsR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUNwQixDQUFDLENBQUMsQ0FBQztBQUVILEdBQUcsQ0FBQyxHQUFHLENBQUMsd0JBQXdCLEVBQUUsd0JBQWlCLEVBQUUsbUJBQVksRUFBRSxLQUFLLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFO0lBQ3BGLE1BQU0sSUFBSSxHQUFHLE1BQU0sTUFBTSxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUM7UUFDaEQsT0FBTyxFQUFFLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRTtRQUM5QixJQUFJLEVBQUUsR0FBRztLQUNWLENBQUMsQ0FBQztJQUNILEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDakIsQ0FBQyxDQUFDLENBQUM7QUFFSCxHQUFHLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUU7SUFDcEIsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3Q0FBd0MsSUFBSSxFQUFFLENBQUMsQ0FBQztBQUM5RCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBleHByZXNzIGZyb20gJ2V4cHJlc3MnO1xuaW1wb3J0IGNvcnMgZnJvbSAnY29ycyc7XG5pbXBvcnQgZG90ZW52IGZyb20gJ2RvdGVudic7XG5pbXBvcnQgbXVsdGVyIGZyb20gJ211bHRlcic7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG5pbXBvcnQgYmNyeXB0IGZyb20gJ2JjcnlwdGpzJztcbmltcG9ydCB7IGF1dGhlbnRpY2F0b3IgfSBmcm9tICdvdHBsaWInO1xuaW1wb3J0IFFSQ29kZSBmcm9tICdxcmNvZGUnO1xuaW1wb3J0IHsgUHJpc21hQ2xpZW50IH0gZnJvbSAnQHByaXNtYS9jbGllbnQnO1xuXG5pbXBvcnQgeyBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBnZW5lcmF0ZVRva2VuLCBBdXRoUmVxdWVzdCB9IGZyb20gJy4vbWlkZGxld2FyZS9hdXRoJztcbmltcG9ydCB7IGVuY3J5cHRBcGlLZXkgfSBmcm9tICcuL3NlcnZpY2VzL2NyeXB0by5zZXJ2aWNlJztcbmltcG9ydCB7XG4gIGVuc3VyZUZpbGVTZWFyY2hTdG9yZSxcbiAgdXBsb2FkRmlsZVRvU3RvcmUsXG4gIGxpc3RGaWxlc0Zyb21TdG9yZSxcbiAgZGVsZXRlRmlsZUZyb21TdG9yZSxcbiAgZ2VuZXJhdGVSQUdBbnN3ZXJcbn0gZnJvbSAnLi9zZXJ2aWNlcy9nZW1pbmkuc2VydmljZSc7XG5cbmRvdGVudi5jb25maWcoKTtcblxuY29uc3QgYXBwID0gZXhwcmVzcygpO1xuY29uc3QgcHJpc21hID0gbmV3IFByaXNtYUNsaWVudCgpO1xuY29uc3QgUE9SVCA9IHByb2Nlc3MuZW52LlBPUlQgfHwgNTAwMTtcblxuYXBwLnVzZShjb3JzKCkpO1xuYXBwLnVzZShleHByZXNzLmpzb24oKSk7XG5cbmNvbnN0IHVwbG9hZERpciA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi91cGxvYWRzJyk7XG5pZiAoIWZzLmV4aXN0c1N5bmModXBsb2FkRGlyKSkge1xuICBmcy5ta2RpclN5bmModXBsb2FkRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbn1cbmNvbnN0IHVwbG9hZCA9IG11bHRlcih7IGRlc3Q6IHVwbG9hZERpciB9KTtcblxuLy8gSW5pdCBEZWZhdWx0IFNldHRpbmdzIGFuZCBEZWZhdWx0IEFkbWluIGlmIG1pc3NpbmdcbmFzeW5jIGZ1bmN0aW9uIGluaXREZWZhdWx0cygpIHtcbiAgY29uc3QgZXhpc3RpbmdTZXR0aW5ncyA9IGF3YWl0IHByaXNtYS5zeXN0ZW1TZXR0aW5ncy5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQ6ICdkZWZhdWx0JyB9IH0pO1xuICBpZiAoIWV4aXN0aW5nU2V0dGluZ3MpIHtcbiAgICBhd2FpdCBwcmlzbWEuc3lzdGVtU2V0dGluZ3MuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgaWQ6ICdkZWZhdWx0JyxcbiAgICAgICAgc2xpZGluZ1dpbmRvd1NpemU6IDE1LFxuICAgICAgICBzdW1tYXJpemF0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgc3VtbWFyaXphdGlvblRocmVzaG9sZDogMzAsXG4gICAgICAgIHJhdGVMaW1pdFBlck1pbnV0ZTogMjAsXG4gICAgICAgIHJhdGVMaW1pdFBlckRheTogNTAwXG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBjb25zdCBleGlzdGluZ0FkbWluID0gYXdhaXQgcHJpc21hLnVzZXIuZmluZEZpcnN0KHsgd2hlcmU6IHsgcm9sZTogJ0FETUlOJyB9IH0pO1xuICBpZiAoIWV4aXN0aW5nQWRtaW4pIHtcbiAgICBjb25zdCBwYXNzd29yZEhhc2ggPSBhd2FpdCBiY3J5cHQuaGFzaCgnYWRtaW4xMjMnLCAxMCk7XG4gICAgY29uc3Qgc2VjcmV0ID0gJ0tSQlNhYVMyRkFBZG1pblNlY3JldEtleTIwMjYnO1xuICAgIGF3YWl0IHByaXNtYS51c2VyLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7XG4gICAgICAgIGVtYWlsOiAnYWRtaW5Aa3JiLmFpJyxcbiAgICAgICAgcGFzc3dvcmRIYXNoLFxuICAgICAgICByb2xlOiAnQURNSU4nLFxuICAgICAgICB0b3RwU2VjcmV0OiBzZWNyZXQsXG4gICAgICAgIHRvdHBFbmFibGVkOiB0cnVlXG4gICAgICB9XG4gICAgfSk7XG4gICAgY29uc29sZS5sb2coJ0RlZmF1bHQgQWRtaW4gQ3JlYXRlZDogZW1haWw9YWRtaW5Aa3JiLmFpLCBwYXNzd29yZD1hZG1pbjEyMywgMkZBIFNlY3JldD0nLCBzZWNyZXQpO1xuICB9XG5cbiAgLy8gQ3JlYXRlIERlZmF1bHQgQ2xpZW50IFVzZXIgZm9yIHRlc3RpbmcgaWYgbm90IGV4aXN0c1xuICBjb25zdCBleGlzdGluZ0NsaWVudCA9IGF3YWl0IHByaXNtYS51c2VyLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBlbWFpbDogJ2NsaWVudEBrcmIuYWknIH0gfSk7XG4gIGlmICghZXhpc3RpbmdDbGllbnQpIHtcbiAgICBjb25zdCBjbGllbnRQYXNzd29yZEhhc2ggPSBhd2FpdCBiY3J5cHQuaGFzaCgnY2xpZW50MTIzJywgMTApO1xuICAgIGNvbnN0IG5ld0NsaWVudCA9IGF3YWl0IHByaXNtYS51c2VyLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7XG4gICAgICAgIGVtYWlsOiAnY2xpZW50QGtyYi5haScsXG4gICAgICAgIHBhc3N3b3JkSGFzaDogY2xpZW50UGFzc3dvcmRIYXNoLFxuICAgICAgICByb2xlOiAnQ0xJRU5UJ1xuICAgICAgfVxuICAgIH0pO1xuICAgIGNvbnN0IHN0b3JlRGlzcGxheU5hbWUgPSBgY2xpZW50X3N0b3JlXyR7bmV3Q2xpZW50LmlkfWA7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGZpbGVTZWFyY2hTdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoc3RvcmVEaXNwbGF5TmFtZSk7XG4gICAgICBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmNyZWF0ZSh7XG4gICAgICAgIGRhdGE6IHsgdXNlcklkOiBuZXdDbGllbnQuaWQsIGZpbGVTZWFyY2hTdG9yZU5hbWUgfVxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKCdTdG9yZSBjcmVhdGlvbiBkZWZlcnJlZCB1bnRpbCBBUEkga2V5IGlzIGFjdGl2ZScpO1xuICAgIH1cbiAgfVxuXG4gIC8vIENyZWF0ZSBEZWZhdWx0IEJvdCBpZiBubyBib3QgZXhpc3RzXG4gIGNvbnN0IGV4aXN0aW5nQm90ID0gYXdhaXQgcHJpc21hLmJvdC5maW5kRmlyc3QoKTtcbiAgaWYgKCFleGlzdGluZ0JvdCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBib3RTdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoJ2JvdF9tYXJrZXRpbmdfZXhwZXJ0Jyk7XG4gICAgICBhd2FpdCBwcmlzbWEuYm90LmNyZWF0ZSh7XG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBuYW1lOiAn0JzQsNGA0LrQtdGC0L7Qu9C+0LMnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAn0K3QutGB0L/QtdGA0YIg0L/QviDRgdGC0YDQsNGC0LXQs9C40YfQtdGB0LrQvtC80YMg0LzQsNGA0LrQtdGC0LjQvdCz0YMg0Lgg0LDQvdCw0LvQuNC30YMg0L3QuNGI0LgnLFxuICAgICAgICAgIHN5c3RlbUluc3RydWN0aW9uOiAn0JLRiyDQvtC/0YvRgtC90YvQuSDQsdC40LfQvdC10YEt0LrQvtC90YHRg9C70YzRgtCw0L3RgiDQuCDRjdC60YHQv9C10YDRgiDQv9C+INC80LDRgNC60LXRgtC40L3Qs9GDLiDQmNC30YPRh9C40YLQtSDQstC+0L/RgNC+0YHRiyDQutC70LjQtdC90YLQsCDQuCDQvtGC0LLQtdGH0LDQudGC0LUg0LzQsNC60YHQuNC80LDQu9GM0L3QviDQv9GA0L7RhNC10YHRgdC40L7QvdCw0LvRjNC90L4g0Lgg0YLQvtGH0L3Qviwg0LDRgNCz0YPQvNC10L3RgtC40YDRg9GPINC+0YLQstC10YLRiyDQtNCw0L3QvdGL0LzQuCDQuNC3INC/0L7QtNC60LvRjtGH0LXQvdC90YvRhSDQsdCw0Lcg0LfQvdCw0L3QuNC5LicsXG4gICAgICAgICAgZmlsZVNlYXJjaFN0b3JlTmFtZTogYm90U3RvcmVOYW1lXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS53YXJuKCdBUEkgS2V5IG5vdCBzZXQgeWV0LiBEZWZhdWx0IGJvdCB3aWxsIGJlIGNyZWF0ZWQgYWZ0ZXIgQVBJIGtleSBpcyBhZGRlZCBpbiBBZG1pbiBQYW5lbC4nKTtcbiAgICAgIGF3YWl0IHByaXNtYS5ib3QuY3JlYXRlKHtcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIG5hbWU6ICfQnNCw0YDQutC10YLQvtC70L7QsycsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICfQrdC60YHQv9C10YDRgiDQv9C+INGB0YLRgNCw0YLQtdCz0LjRh9C10YHQutC+0LzRgyDQvNCw0YDQutC10YLQuNC90LPRgyDQuCDQsNC90LDQu9C40LfRgyDQvdC40YjQuCcsXG4gICAgICAgICAgc3lzdGVtSW5zdHJ1Y3Rpb246ICfQktGLINC+0L/Ri9GC0L3Ri9C5INCx0LjQt9C90LXRgS3QutC+0L3RgdGD0LvRjNGC0LDQvdGCINC4INGN0LrRgdC/0LXRgNGCINC/0L4g0LzQsNGA0LrQtdGC0LjQvdCz0YMuINCY0LfRg9GH0LjRgtC1INCy0L7Qv9GA0L7RgdGLINC60LvQuNC10L3RgtCwINC4INC+0YLQstC10YfQsNC50YLQtSDQvNCw0LrRgdC40LzQsNC70YzQvdC+INC/0YDQvtGE0LXRgdGB0LjQvtC90LDQu9GM0L3QviDQuCDRgtC+0YfQvdC+LCDQsNGA0LPRg9C80LXQvdGC0LjRgNGD0Y8g0L7RgtCy0LXRgtGLINC00LDQvdC90YvQvNC4INC40Lcg0L/QvtC00LrQu9GO0YfQtdC90L3Ri9GFINCx0LDQtyDQt9C90LDQvdC40LkuJyxcbiAgICAgICAgICBmaWxlU2VhcmNoU3RvcmVOYW1lOiBudWxsXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufVxuaW5pdERlZmF1bHRzKCkuY2F0Y2goY29uc29sZS5lcnJvcik7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFVVEggRU5EUE9JTlRTXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5hcHAucG9zdCgnL2FwaS9hdXRoL2xvZ2luJywgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgZW1haWwsIHBhc3N3b3JkIH0gPSByZXEuYm9keTtcbiAgY29uc3QgdXNlciA9IGF3YWl0IHByaXNtYS51c2VyLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBlbWFpbCB9IH0pO1xuICBpZiAoIXVzZXIgfHwgdXNlci5yb2xlICE9PSAnQ0xJRU5UJykge1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAn0J3QtdCy0LXRgNC90YvQtSDRg9GH0LXRgtC90YvQtSDQtNCw0L3QvdGL0LUnIH0pO1xuICB9XG5cbiAgY29uc3QgaXNWYWxpZCA9IGF3YWl0IGJjcnlwdC5jb21wYXJlKHBhc3N3b3JkLCB1c2VyLnBhc3N3b3JkSGFzaCk7XG4gIGlmICghaXNWYWxpZCkge1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAn0J3QtdCy0LXRgNC90YvQtSDRg9GH0LXRgtC90YvQtSDQtNCw0L3QvdGL0LUnIH0pO1xuICB9XG5cbiAgLy8gRW5zdXJlIHVzZXIgaGFzIGEgZGVkaWNhdGVkIEdvb2dsZSBGaWxlIFNlYXJjaCBTdG9yZSAoVmFyaWFudCBBKVxuICBsZXQgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5maW5kVW5pcXVlKHsgd2hlcmU6IHsgdXNlcklkOiB1c2VyLmlkIH0gfSk7XG4gIGlmICghdXNlclN0b3JlKSB7XG4gICAgY29uc3Qgc3RvcmVEaXNwbGF5TmFtZSA9IGBjbGllbnRfc3RvcmVfJHt1c2VyLmlkfWA7XG4gICAgY29uc3QgZmlsZVNlYXJjaFN0b3JlTmFtZSA9IGF3YWl0IGVuc3VyZUZpbGVTZWFyY2hTdG9yZShzdG9yZURpc3BsYXlOYW1lKTtcbiAgICB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7XG4gICAgICAgIHVzZXJJZDogdXNlci5pZCxcbiAgICAgICAgZmlsZVNlYXJjaFN0b3JlTmFtZVxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgY29uc3QgdG9rZW4gPSBnZW5lcmF0ZVRva2VuKHsgdXNlcklkOiB1c2VyLmlkLCByb2xlOiB1c2VyLnJvbGUgfSk7XG4gIHJlcy5qc29uKHsgdG9rZW4sIHVzZXI6IHsgaWQ6IHVzZXIuaWQsIGVtYWlsOiB1c2VyLmVtYWlsLCByb2xlOiB1c2VyLnJvbGUgfSB9KTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hdXRoL2FkbWluLWxvZ2luJywgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgZW1haWwsIHBhc3N3b3JkLCB0b3RwQ29kZSB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IHVzZXIgPSBhd2FpdCBwcmlzbWEudXNlci5maW5kVW5pcXVlKHsgd2hlcmU6IHsgZW1haWwgfSB9KTtcbiAgaWYgKCF1c2VyIHx8IHVzZXIucm9sZSAhPT0gJ0FETUlOJykge1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAn0J3QtdCy0LXRgNC90YvQuSDQu9C+0LPQuNC9INC40LvQuCDQv9Cw0YDQvtC70Ywg0LDQtNC80LjQvdC40YHRgtGA0LDRgtC+0YDQsCcgfSk7XG4gIH1cblxuICBjb25zdCBpc1ZhbGlkUGFzc3dvcmQgPSBhd2FpdCBiY3J5cHQuY29tcGFyZShwYXNzd29yZCwgdXNlci5wYXNzd29yZEhhc2gpO1xuICBpZiAoIWlzVmFsaWRQYXNzd29yZCkge1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAn0J3QtdCy0LXRgNC90YvQuSDQu9C+0LPQuNC9INC40LvQuCDQv9Cw0YDQvtC70Ywg0LDQtNC80LjQvdC40YHRgtGA0LDRgtC+0YDQsCcgfSk7XG4gIH1cblxuICBpZiAodXNlci50b3RwRW5hYmxlZCAmJiB1c2VyLnRvdHBTZWNyZXQpIHtcbiAgICBpZiAoIXRvdHBDb2RlKSB7XG4gICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBlcnJvcjogJ9Ci0YDQtdCx0YPQtdGC0YHRjyAyRkEg0LrQvtC0JywgcmVxdWlyZTJGQTogdHJ1ZSB9KTtcbiAgICB9XG4gICAgY29uc3QgaXNWYWxpZFRvdHAgPSBhdXRoZW50aWNhdG9yLmNoZWNrKHRvdHBDb2RlLCB1c2VyLnRvdHBTZWNyZXQpO1xuICAgIGlmICghaXNWYWxpZFRvdHApIHtcbiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7IGVycm9yOiAn0J3QtdCy0LXRgNC90YvQuSAyRkEg0LrQvtC0INC00LLRg9GF0YTQsNC60YLQvtGA0L3QvtC5INCw0YPRgtC10L3RgtC40YTQuNC60LDRhtC40LgnIH0pO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHRva2VuID0gZ2VuZXJhdGVUb2tlbih7IHVzZXJJZDogdXNlci5pZCwgcm9sZTogdXNlci5yb2xlIH0pO1xuICByZXMuanNvbih7IHRva2VuLCB1c2VyOiB7IGlkOiB1c2VyLmlkLCBlbWFpbDogdXNlci5lbWFpbCwgcm9sZTogdXNlci5yb2xlIH0gfSk7XG59KTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ0xJRU5UIEVORFBPSU5UUyAoQ0hBVCAmIEZJTEVTKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuYXBwLmdldCgnL2FwaS9ib3RzJywgYXV0aGVudGljYXRlVG9rZW4sIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgdXNlcklkID0gcmVxLnVzZXIhLnVzZXJJZDtcbiAgLy8gSWYgdXNlciBpcyBBRE1JTiwgZ2l2ZSBhbGwgYm90czsgaWYgQ0xJRU5ULCBnaXZlIGFsbG93ZWQgYm90cyBvciBhbGwgaWYgbm9uZSBhc3NpZ25lZCB5ZXRcbiAgY29uc3QgdXNlckFjY2VzcyA9IGF3YWl0IHByaXNtYS5ib3RDbGllbnRBY2Nlc3MuZmluZE1hbnkoeyB3aGVyZTogeyB1c2VySWQgfSB9KTtcbiAgbGV0IGJvdHM7XG4gIGlmICh1c2VyQWNjZXNzLmxlbmd0aCA+IDApIHtcbiAgICBib3RzID0gYXdhaXQgcHJpc21hLmJvdC5maW5kTWFueSh7XG4gICAgICB3aGVyZTogeyBpZDogeyBpbjogdXNlckFjY2Vzcy5tYXAoYSA9PiBhLmJvdElkKSB9IH1cbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICBib3RzID0gYXdhaXQgcHJpc21hLmJvdC5maW5kTWFueSgpO1xuICB9XG4gIHJlcy5qc29uKGJvdHMpO1xufSk7XG5cbmFwcC5nZXQoJy9hcGkvY2hhdC9oaXN0b3J5Lzpib3RJZCcsIGF1dGhlbnRpY2F0ZVRva2VuLCBhc3luYyAocmVxOiBBdXRoUmVxdWVzdCwgcmVzKSA9PiB7XG4gIGNvbnN0IHVzZXJJZCA9IHJlcS51c2VyIS51c2VySWQ7XG4gIGNvbnN0IHsgYm90SWQgfSA9IHJlcS5wYXJhbXM7XG5cbiAgY29uc3QgbWVzc2FnZXMgPSBhd2FpdCBwcmlzbWEuY2hhdE1lc3NhZ2UuZmluZE1hbnkoe1xuICAgIHdoZXJlOiB7IHVzZXJJZCwgYm90SWQgfSxcbiAgICBvcmRlckJ5OiB7IGNyZWF0ZWRBdDogJ2FzYycgfVxuICB9KTtcbiAgcmVzLmpzb24obWVzc2FnZXMpO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2NoYXQnLCBhdXRoZW50aWNhdGVUb2tlbiwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCB1c2VySWQgPSByZXEudXNlciEudXNlcklkO1xuICBjb25zdCB7IGJvdElkLCBtZXNzYWdlIH0gPSByZXEuYm9keTtcbiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICBjb25zdCBib3QgPSBhd2FpdCBwcmlzbWEuYm90LmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZDogYm90SWQgfSB9KTtcbiAgaWYgKCFib3QpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oeyBlcnJvcjogJ9CR0L7RgiDQvdC1INC90LDQudC00LXQvScgfSk7XG4gIH1cblxuICBjb25zdCB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmZpbmRVbmlxdWUoeyB3aGVyZTogeyB1c2VySWQgfSB9KTtcblxuICBjb25zdCBzZXR0aW5ncyA9IChhd2FpdCBwcmlzbWEuc3lzdGVtU2V0dGluZ3MuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGlkOiAnZGVmYXVsdCcgfSB9KSkgfHwge1xuICAgIHNsaWRpbmdXaW5kb3dTaXplOiAxNSxcbiAgICBzdW1tYXJpemF0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgICBzdW1tYXJpemF0aW9uVGhyZXNob2xkOiAzMFxuICB9O1xuXG4gIC8vIEZldGNoIGxhc3QgTiBtZXNzYWdlcyBhY2NvcmRpbmcgdG8gc2xpZGluZyB3aW5kb3dcbiAgY29uc3QgcGFzdE1lc3NhZ2VzID0gYXdhaXQgcHJpc21hLmNoYXRNZXNzYWdlLmZpbmRNYW55KHtcbiAgICB3aGVyZTogeyB1c2VySWQsIGJvdElkIH0sXG4gICAgb3JkZXJCeTogeyBjcmVhdGVkQXQ6ICdhc2MnIH0sXG4gICAgdGFrZTogc2V0dGluZ3Muc2xpZGluZ1dpbmRvd1NpemVcbiAgfSk7XG5cbiAgY29uc3QgaGlzdG9yeU1lc3NhZ2VzID0gcGFzdE1lc3NhZ2VzLm1hcChtID0+ICh7XG4gICAgcm9sZTogbS5yb2xlIGFzICd1c2VyJyB8ICdtb2RlbCcsXG4gICAgY29udGVudDogbS5jb250ZW50XG4gIH0pKTtcblxuICB0cnkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGdlbmVyYXRlUkFHQW5zd2VyKHtcbiAgICAgIHN5c3RlbUluc3RydWN0aW9uOiBib3Quc3lzdGVtSW5zdHJ1Y3Rpb24sXG4gICAgICBib3RTdG9yZU5hbWU6IGJvdC5maWxlU2VhcmNoU3RvcmVOYW1lIHx8IHVuZGVmaW5lZCxcbiAgICAgIGNsaWVudFN0b3JlTmFtZTogdXNlclN0b3JlPy5maWxlU2VhcmNoU3RvcmVOYW1lIHx8IHVuZGVmaW5lZCxcbiAgICAgIGhpc3RvcnlNZXNzYWdlcyxcbiAgICAgIGN1cnJlbnRRdWVzdGlvbjogbWVzc2FnZVxuICAgIH0pO1xuXG4gICAgLy8gU2F2ZSBVc2VyIG1lc3NhZ2UgYW5kIE1vZGVsIHJlc3BvbnNlIHRvIERCXG4gICAgYXdhaXQgcHJpc21hLmNoYXRNZXNzYWdlLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7IHVzZXJJZCwgYm90SWQsIHJvbGU6ICd1c2VyJywgY29udGVudDogbWVzc2FnZSB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBib3RNZXNzYWdlID0gYXdhaXQgcHJpc21hLmNoYXRNZXNzYWdlLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7XG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgYm90SWQsXG4gICAgICAgIHJvbGU6ICdtb2RlbCcsXG4gICAgICAgIGNvbnRlbnQ6IHJlc3VsdC50ZXh0LFxuICAgICAgICBncm91bmRpbmdNZXRhZGF0YTogcmVzdWx0Lmdyb3VuZGluZ01ldGFkYXRhID8gSlNPTi5zdHJpbmdpZnkocmVzdWx0Lmdyb3VuZGluZ01ldGFkYXRhKSA6IG51bGxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIExvZyBkaWFnbm9zdGljXG4gICAgYXdhaXQgcHJpc21hLmFwaURpYWdub3N0aWNzLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7XG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgYm90SWQsXG4gICAgICAgIGVuZHBvaW50OiAnL2FwaS9jaGF0JyxcbiAgICAgICAgc3RhdHVzOiAnU1VDQ0VTUycsXG4gICAgICAgIHJlc3BvbnNlVGltZTogcmVzdWx0LnJlc3BvbnNlVGltZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmVzLmpzb24oYm90TWVzc2FnZSk7XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICBjb25zdCByZXNwb25zZVRpbWUgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgIGF3YWl0IHByaXNtYS5hcGlEaWFnbm9zdGljcy5jcmVhdGUoe1xuICAgICAgZGF0YToge1xuICAgICAgICB1c2VySWQsXG4gICAgICAgIGJvdElkLFxuICAgICAgICBlbmRwb2ludDogJy9hcGkvY2hhdCcsXG4gICAgICAgIHN0YXR1czogJ0VSUk9SJyxcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBlcnJvci5tZXNzYWdlIHx8ICfQntGI0LjQsdC60LAg0LPQtdC90LXRgNCw0YbQuNC4IEdlbWluaSBBUEknLFxuICAgICAgICByZXNwb25zZVRpbWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHtcbiAgICAgIGVycm9yOiAn0J3QtSDRg9C00LDQu9C+0YHRjCDQv9C+0LvRg9GH0LjRgtGMINC+0YLQstC10YIg0L7RgiDQsNGB0YHQuNGB0YLQtdC90YLQsC4g0J/QvtC/0YDQvtCx0YPQudGC0LUg0LXRidC1INGA0LDQtyDQv9C+0LfQttC1LicsXG4gICAgICB0ZWNobmljYWxSZWFzb246IGVycm9yLm1lc3NhZ2VcbiAgICB9KTtcbiAgfVxufSk7XG5cbi8vIEZJTEVTIChCdXNpbmVzcyBMaWJyYXJ5KSAtIEdvb2dsZSBGaWxlIFNlYXJjaCBpcyBTaW5nbGUgU291cmNlIG9mIFRydXRoXG5hcHAuZ2V0KCcvYXBpL2ZpbGVzJywgYXV0aGVudGljYXRlVG9rZW4sIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgdXNlcklkID0gcmVxLnVzZXIhLnVzZXJJZDtcbiAgbGV0IHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IHVzZXJJZCB9IH0pO1xuICBpZiAoIXVzZXJTdG9yZSkge1xuICAgIGNvbnN0IHN0b3JlRGlzcGxheU5hbWUgPSBgY2xpZW50X3N0b3JlXyR7dXNlcklkfWA7XG4gICAgY29uc3QgZmlsZVNlYXJjaFN0b3JlTmFtZSA9IGF3YWl0IGVuc3VyZUZpbGVTZWFyY2hTdG9yZShzdG9yZURpc3BsYXlOYW1lKTtcbiAgICB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7IHVzZXJJZCwgZmlsZVNlYXJjaFN0b3JlTmFtZSB9XG4gICAgfSk7XG4gIH1cblxuICBjb25zdCBmaWxlcyA9IGF3YWl0IGxpc3RGaWxlc0Zyb21TdG9yZSh1c2VyU3RvcmUuZmlsZVNlYXJjaFN0b3JlTmFtZSk7XG4gIHJlcy5qc29uKGZpbGVzKTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9maWxlcy91cGxvYWQnLCBhdXRoZW50aWNhdGVUb2tlbiwgdXBsb2FkLnNpbmdsZSgnZmlsZScpLCBhc3luYyAocmVxOiBBdXRoUmVxdWVzdCwgcmVzKSA9PiB7XG4gIGNvbnN0IHVzZXJJZCA9IHJlcS51c2VyIS51c2VySWQ7XG4gIGNvbnN0IHsgZm9sZGVyVGFnIH0gPSByZXEuYm9keTtcbiAgY29uc3QgZmlsZSA9IHJlcS5maWxlO1xuXG4gIGlmICghZmlsZSkge1xuICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IGVycm9yOiAn0KTQsNC50Lsg0L3QtSDQv9C10YDQtdC00LDQvScgfSk7XG4gIH1cblxuICBsZXQgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5maW5kVW5pcXVlKHsgd2hlcmU6IHsgdXNlcklkIH0gfSk7XG4gIGlmICghdXNlclN0b3JlKSB7XG4gICAgY29uc3Qgc3RvcmVEaXNwbGF5TmFtZSA9IGBjbGllbnRfc3RvcmVfJHt1c2VySWR9YDtcbiAgICBjb25zdCBmaWxlU2VhcmNoU3RvcmVOYW1lID0gYXdhaXQgZW5zdXJlRmlsZVNlYXJjaFN0b3JlKHN0b3JlRGlzcGxheU5hbWUpO1xuICAgIHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHsgdXNlcklkLCBmaWxlU2VhcmNoU3RvcmVOYW1lIH1cbiAgICB9KTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgdXBsb2FkZWQgPSBhd2FpdCB1cGxvYWRGaWxlVG9TdG9yZShcbiAgICAgIHVzZXJTdG9yZS5maWxlU2VhcmNoU3RvcmVOYW1lLFxuICAgICAgZmlsZS5wYXRoLFxuICAgICAgZmlsZS5vcmlnaW5hbG5hbWUsXG4gICAgICBmaWxlLm1pbWV0eXBlLFxuICAgICAgZm9sZGVyVGFnXG4gICAgKTtcblxuICAgIC8vIENsZWFuIHRlbXAgdXBsb2FkIGZpbGVcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlLnBhdGgpKSBmcy51bmxpbmtTeW5jKGZpbGUucGF0aCk7XG5cbiAgICByZXMuanNvbih7IG1lc3NhZ2U6ICfQpNCw0LnQuyDRg9GB0L/QtdGI0L3QviDQt9Cw0LPRgNGD0LbQtdC9INCyIEdvb2dsZSBGaWxlIFNlYXJjaCBTdG9yZScsIGZpbGU6IHVwbG9hZGVkIH0pO1xuICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgaWYgKGZpbGUgJiYgZnMuZXhpc3RzU3luYyhmaWxlLnBhdGgpKSBmcy51bmxpbmtTeW5jKGZpbGUucGF0aCk7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Ce0YjQuNCx0LrQsCDQuNC90LTQtdC60YHQsNGG0LjQuCDRhNCw0LnQu9CwJywgZGV0YWlsczogZXJyb3IubWVzc2FnZSB9KTtcbiAgfVxufSk7XG5cbmFwcC5kZWxldGUoJy9hcGkvZmlsZXMvOmdvb2dsZUZpbGVOYW1lJywgYXV0aGVudGljYXRlVG9rZW4sIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgeyBnb29nbGVGaWxlTmFtZSB9ID0gcmVxLnBhcmFtcztcbiAgdHJ5IHtcbiAgICBhd2FpdCBkZWxldGVGaWxlRnJvbVN0b3JlKGRlY29kZVVSSUNvbXBvbmVudChnb29nbGVGaWxlTmFtZSkpO1xuICAgIHJlcy5qc29uKHsgbWVzc2FnZTogJ9Ck0LDQudC7INGD0YHQv9C10YjQvdC+INGD0LTQsNC70LXQvSDQuNC3IEdvb2dsZSBGaWxlIFNlYXJjaCBTdG9yZScgfSk7XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycm9yOiAn0J7RiNC40LHQutCwINGD0LTQsNC70LXQvdC40Y8g0YTQsNC50LvQsCDQuNC3IEdvb2dsZSBTdG9yZScsIGRldGFpbHM6IGVycm9yLm1lc3NhZ2UgfSk7XG4gIH1cbn0pO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBRE1JTiBFTkRQT0lOVFNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmFwcC5nZXQoJy9hcGkvYWRtaW4vMmZhLWluZm8nLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgYWRtaW4gPSBhd2FpdCBwcmlzbWEudXNlci5maW5kRmlyc3QoeyB3aGVyZTogeyByb2xlOiAnQURNSU4nIH0gfSk7XG4gIGlmICghYWRtaW4pIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7IGVycm9yOiAnQWRtaW4gbm90IGZvdW5kJyB9KTtcbiAgY29uc3Qgb3RwYXV0aCA9IGF1dGhlbnRpY2F0b3Iua2V5dXJpKCdhZG1pbkBrcmIuYWknLCAnS1JCIFNhYVMnLCBhZG1pbi50b3RwU2VjcmV0IHx8ICdLUkJTYWFTMkZBQWRtaW5TZWNyZXRLZXkyMDI2Jyk7XG4gIGNvbnN0IHFyQ29kZVVybCA9IGF3YWl0IFFSQ29kZS50b0RhdGFVUkwob3RwYXV0aCk7XG4gIHJlcy5qc29uKHtcbiAgICB0b3RwRW5hYmxlZDogYWRtaW4udG90cEVuYWJsZWQsXG4gICAgdG90cFNlY3JldDogYWRtaW4udG90cFNlY3JldCxcbiAgICBxckNvZGVVcmxcbiAgfSk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4vdG9nZ2xlLTJmYScsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGVuYWJsZWQgfSA9IHJlcS5ib2R5O1xuICBjb25zdCBhZG1pbiA9IGF3YWl0IHByaXNtYS51c2VyLmZpbmRGaXJzdCh7IHdoZXJlOiB7IHJvbGU6ICdBRE1JTicgfSB9KTtcbiAgaWYgKCFhZG1pbikgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgZXJyb3I6ICdBZG1pbiBub3QgZm91bmQnIH0pO1xuXG4gIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBwcmlzbWEudXNlci51cGRhdGUoe1xuICAgIHdoZXJlOiB7IGlkOiBhZG1pbi5pZCB9LFxuICAgIGRhdGE6IHsgdG90cEVuYWJsZWQ6IGVuYWJsZWQgfVxuICB9KTtcbiAgcmVzLmpzb24oeyB0b3RwRW5hYmxlZDogdXBkYXRlZC50b3RwRW5hYmxlZCB9KTtcbn0pO1xuXG5hcHAuZ2V0KCcvYXBpL2FkbWluL2tleXMnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3Qga2V5cyA9IGF3YWl0IHByaXNtYS5hcGlLZXkuZmluZE1hbnkoeyBzZWxlY3Q6IHsgaWQ6IHRydWUsIHNlcnZpY2U6IHRydWUsIGlzQWN0aXZlOiB0cnVlLCBjcmVhdGVkQXQ6IHRydWUgfSB9KTtcbiAgcmVzLmpzb24oa2V5cyk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYWRtaW4va2V5cycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IHNlcnZpY2UsIGFwaUtleSB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IGVuY3J5cHRlZCA9IGVuY3J5cHRBcGlLZXkoYXBpS2V5KTtcbiAgY29uc3QgY3JlYXRlZCA9IGF3YWl0IHByaXNtYS5hcGlLZXkuY3JlYXRlKHtcbiAgICBkYXRhOiB7XG4gICAgICBzZXJ2aWNlLFxuICAgICAgZW5jcnlwdGVkS2V5OiBlbmNyeXB0ZWQuZW5jcnlwdGVkS2V5LFxuICAgICAgaXY6IGVuY3J5cHRlZC5pdixcbiAgICAgIGlzQWN0aXZlOiB0cnVlXG4gICAgfVxuICB9KTtcbiAgcmVzLmpzb24oeyBpZDogY3JlYXRlZC5pZCwgc2VydmljZTogY3JlYXRlZC5zZXJ2aWNlLCBpc0FjdGl2ZTogY3JlYXRlZC5pc0FjdGl2ZSB9KTtcbn0pO1xuXG5hcHAucGF0Y2goJy9hcGkvYWRtaW4va2V5cy86aWQnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBpZCB9ID0gcmVxLnBhcmFtcztcbiAgY29uc3QgeyBpc0FjdGl2ZSB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBwcmlzbWEuYXBpS2V5LnVwZGF0ZSh7XG4gICAgd2hlcmU6IHsgaWQgfSxcbiAgICBkYXRhOiB7IGlzQWN0aXZlIH1cbiAgfSk7XG4gIHJlcy5qc29uKHVwZGF0ZWQpO1xufSk7XG5cbmFwcC5nZXQoJy9hcGkvYWRtaW4vc2V0dGluZ3MnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3Qgc2V0dGluZ3MgPSBhd2FpdCBwcmlzbWEuc3lzdGVtU2V0dGluZ3MuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGlkOiAnZGVmYXVsdCcgfSB9KTtcbiAgcmVzLmpzb24oc2V0dGluZ3MpO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2FkbWluL3NldHRpbmdzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgc2xpZGluZ1dpbmRvd1NpemUsIHN1bW1hcml6YXRpb25FbmFibGVkLCBzdW1tYXJpemF0aW9uVGhyZXNob2xkLCByYXRlTGltaXRQZXJNaW51dGUsIHJhdGVMaW1pdFBlckRheSB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBwcmlzbWEuc3lzdGVtU2V0dGluZ3MudXBzZXJ0KHtcbiAgICB3aGVyZTogeyBpZDogJ2RlZmF1bHQnIH0sXG4gICAgdXBkYXRlOiB7IHNsaWRpbmdXaW5kb3dTaXplLCBzdW1tYXJpemF0aW9uRW5hYmxlZCwgc3VtbWFyaXphdGlvblRocmVzaG9sZCwgcmF0ZUxpbWl0UGVyTWludXRlLCByYXRlTGltaXRQZXJEYXkgfSxcbiAgICBjcmVhdGU6IHsgaWQ6ICdkZWZhdWx0Jywgc2xpZGluZ1dpbmRvd1NpemUsIHN1bW1hcml6YXRpb25FbmFibGVkLCBzdW1tYXJpemF0aW9uVGhyZXNob2xkLCByYXRlTGltaXRQZXJNaW51dGUsIHJhdGVMaW1pdFBlckRheSB9XG4gIH0pO1xuICByZXMuanNvbih1cGRhdGVkKTtcbn0pO1xuXG5hcHAuZ2V0KCcvYXBpL2FkbWluL2RpYWdub3N0aWNzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IGxvZ3MgPSBhd2FpdCBwcmlzbWEuYXBpRGlhZ25vc3RpY3MuZmluZE1hbnkoe1xuICAgIG9yZGVyQnk6IHsgY3JlYXRlZEF0OiAnZGVzYycgfSxcbiAgICB0YWtlOiAxMDBcbiAgfSk7XG4gIHJlcy5qc29uKGxvZ3MpO1xufSk7XG5cbmFwcC5saXN0ZW4oUE9SVCwgKCkgPT4ge1xuICBjb25zb2xlLmxvZyhgU2VydmVyIGxpc3RlbmluZyBvbiBodHRwOi8vbG9jYWxob3N0OiR7UE9SVH1gKTtcbn0pO1xuIl19