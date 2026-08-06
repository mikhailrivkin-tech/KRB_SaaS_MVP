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
            totpEnabled: true
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiL1VzZXJzL2dob3N0L0RvY3VtZW50cy9DbG91ZC9HRHJpdmUvbWlraGFpbF9yaXZraW4vQnVzaW5lc3MvUHJvamVjdHMvS1JCL0FudGlHcmF2aXR5L0tSQl9TYWFTX01WUC9zZXJ2ZXIvc3JjL2luZGV4LnRzIiwic291cmNlcyI6WyIvVXNlcnMvZ2hvc3QvRG9jdW1lbnRzL0Nsb3VkL0dEcml2ZS9taWtoYWlsX3Jpdmtpbi9CdXNpbmVzcy9Qcm9qZWN0cy9LUkIvQW50aUdyYXZpdHkvS1JCX1NhYVNfTVZQL3NlcnZlci9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxzREFBOEI7QUFDOUIsZ0RBQXdCO0FBQ3hCLG9EQUE0QjtBQUM1QixvREFBNEI7QUFDNUIsZ0RBQXdCO0FBQ3hCLDRDQUFvQjtBQUNwQix3REFBOEI7QUFDOUIsbUNBQXVDO0FBQ3ZDLG9EQUE0QjtBQUM1QiwyQ0FBOEM7QUFFOUMsNENBQWdHO0FBQ2hHLDhEQUEwRDtBQUMxRCw4REFNbUM7QUFFbkMsZ0JBQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQztBQUVoQixNQUFNLEdBQUcsR0FBRyxJQUFBLGlCQUFPLEdBQUUsQ0FBQztBQUN0QixNQUFNLE1BQU0sR0FBRyxJQUFJLHFCQUFZLEVBQUUsQ0FBQztBQUNsQyxNQUFNLElBQUksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksSUFBSSxJQUFJLENBQUM7QUFFdEMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFBLGNBQUksR0FBRSxDQUFDLENBQUM7QUFDaEIsR0FBRyxDQUFDLEdBQUcsQ0FBQyxpQkFBTyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7QUFFeEIsTUFBTSxTQUFTLEdBQUcsY0FBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsWUFBWSxDQUFDLENBQUM7QUFDckQsSUFBSSxDQUFDLFlBQUUsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztJQUM5QixZQUFFLENBQUMsU0FBUyxDQUFD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QyxJQUFJLENBQUMsQ0FBQztBQUNqQixDQUFDLENBQUMsQ0FBQztBQUVILEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRTtJQUNwQixPQUFPLENBQUMsR0FBRyxDQUFDLHdDQUF3QyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQzlELENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGV4cHJlc3MgZnJvbSAnZXhwcmVzcyc7XG5pbXBvcnQgY29ycyBmcm9tICdjb3JzJztcbmltcG9ydCBkb3RlbnYgZnJvbSAnZG90ZW52JztcbmltcG9ydCBtdWx0ZXIgZnJvbSAnbXVsdGVyJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJztcbmltcG9ydCBiY3J5cHQgZnJvbSAnYmNyeXB0anMnO1xuaW1wb3J0IHsgYXV0aGVudGljYXRvciB9IGZyb20gJ290cGxpYic7XG5pbXBvcnQgUVJDb2RlIGZyb20gJ3FyY29kZSc7XG5pbXBvcnQgeyBQcmlzbWFDbGllbnQgfSBmcm9tICdAcHJpc21hL2NsaWVudCc7XG5cbmltcG9ydCB7IGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGdlbmVyYXRlVG9rZW4sIEF1dGhSZXF1ZXN0IH0gZnJvbSAnLi9taWRkbGV3YXJlL2F1dGgnO1xuaW1wb3J0IHsgZW5jcnlwdEFwaUtleSB9IGZyb20gJy4vc2VydmljZXMvY3J5cHRvLnNlcnZpY2UnO1xuaW1wb3J0IHtcbiAgZW5zdXJlRmlsZVNlYXJjaFN0b3JlLFxuICB1cGxvYWRGaWxlVG9TdG9yZSxcbiAgbGlzdEZpbGVzRnJvbVN0b3JlLFxuICBkZWxldGVGaWxlRnJvbVN0b3JlLFxuICBnZW5lcmF0ZVJBR0Fuc3dlclxufSBmcm9tICcuL3NlcnZpY2VzL2dlbWluaS5zZXJ2aWNlJztcblxuZG90ZW52LmNvbmZpZygpO1xuXG5jb25zdCBhcHAgPSBleHByZXNzKCk7XG5jb25zdCBwcmlzbWEgPSBuZXcgUHJpc21hQ2xpZW50KCk7XG5jb25zdCBQT1JUID0gcHJvY2Vzcy5lbnYuUE9SVCB8fCA1MDAxO1xuXG5hcHAudXNlKGNvcnMoKSk7XG5hcHAudXNlKGV4cHJlc3MuanNvbigpKTtcblxuY29uc3QgdXBsb2FkRGlyID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3VwbG9hZHMnKTtcbmlmICghZnMuZXhpc3RzU3luYyh1cGxvYWREaXIpKSB7XG4gIGZzLm1rZGlyU3luYyh1cGxvYWREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xufVxuY29uc3QgdXBsb2FkID0gbXVsdGVyKHsgZGVzdDogdXBsb2FkRGlyIH0pO1xuXG4vLyBJbml0IERlZmF1bHQgU2V0dGluZ3MgYW5kIERlZmF1bHQgQWRtaW4gaWYgbWlzc2luZ1xuYXN5bmMgZnVuY3Rpb24gaW5pdERlZmF1bHRzKCkge1xuICBjb25zdCBleGlzdGluZ1NldHRpbmdzID0gYXdhaXQgcHJpc21hLnN5c3RlbVNldHRpbmdzLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZDogJ2RlZmF1bHQnIH0gfSk7XG4gIGlmICghZXhpc3RpbmdTZXR0aW5ncykge1xuICAgIGF3YWl0IHByaXNtYS5zeXN0ZW1TZXR0aW5ncy5jcmVhdGUoe1xuICAgICAgZGF0YToge1xuICAgICAgICBpZDogJ2RlZmF1bHQnLFxuICAgICAgICBzbGlkaW5nV2luZG93U2l6ZTogMTUsXG4gICAgICAgIHN1bW1hcml6YXRpb25FbmFibGVkOiB0cnVlLFxuICAgICAgICBzdW1tYXJpemF0aW9uVGhyZXNob2xkOiAzMCxcbiAgICAgICAgcmF0ZUxpbWl0UGVyTWludXRlOiAyMCxcbiAgICAgICAgcmF0ZUxpbWl0UGVyRGF5OiA1MDBcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIEVuc3VyZSBEZWZhdWx0IEFkbWluXG4gIGNvbnN0IGFkbWluUGFzc3dvcmRIYXNoID0gYXdhaXQgYmNyeXB0Lmhhc2goJ2FkbWluMTIzJywgMTApO1xuICBjb25zdCBzZWNyZXQgPSAnS1JCU2FhUzJGQUFkbWluU2VjcmV0S2V5MjAyNic7XG4gIGF3YWl0IHByaXNtYS51c2VyLnVwc2VydCh7XG4gICAgd2hlcmU6IHsgZW1haWw6ICdhZG1pbkBrcmIuYWknIH0sXG4gICAgdXBkYXRlOiB7IHBhc3N3b3JkSGFzaDogYWRtaW5QYXNzd29yZEhhc2gsIHRvdHBTZWNyZXQ6IHNlY3JldCB9LFxuICAgIGNyZWF0ZToge1xuICAgICAgZW1haWw6ICdhZG1pbkBrcmIuYWknLFxuICAgICAgcGFzc3dvcmRIYXNoOiBhZG1pblBhc3N3b3JkSGFzaCxcbiAgICAgIHJvbGU6ICdBRE1JTicsXG4gICAgICB0b3RwU2VjcmV0OiBzZWNyZXQsXG4gICAgICB0b3RwRW5hYmxlZDogdHJ1ZVxuICAgIH1cbiAgfSk7XG4gIGNvbnNvbGUubG9nKCdBZG1pbiB1c2VyIGd1YXJhbnRlZWQ6IGVtYWlsPWFkbWluQGtyYi5haSwgcGFzc3dvcmQ9YWRtaW4xMjMnKTtcblxuICAvLyBFbnN1cmUgRGVmYXVsdCBDbGllbnRcbiAgY29uc3QgY2xpZW50UGFzc3dvcmRIYXNoID0gYXdhaXQgYmNyeXB0Lmhhc2goJ2NsaWVudDEyMycsIDEwKTtcbiAgY29uc3QgY2xpZW50ID0gYXdhaXQgcHJpc21hLnVzZXIudXBzZXJ0KHtcbiAgICB3aGVyZTogeyBlbWFpbDogJ2NsaWVudEBrcmIuYWknIH0sXG4gICAgdXBkYXRlOiB7IHBhc3N3b3JkSGFzaDogY2xpZW50UGFzc3dvcmRIYXNoIH0sXG4gICAgY3JlYXRlOiB7XG4gICAgICBlbWFpbDogJ2NsaWVudEBrcmIuYWknLFxuICAgICAgcGFzc3dvcmRIYXNoOiBjbGllbnRQYXNzd29yZEhhc2gsXG4gICAgICByb2xlOiAnQ0xJRU5UJ1xuICAgIH1cbiAgfSk7XG4gIGNvbnNvbGUubG9nKCdDbGllbnQgdXNlciBndWFyYW50ZWVkOiBlbWFpbD1jbGllbnRAa3JiLmFpLCBwYXNzd29yZD1jbGllbnQxMjMnKTtcblxuICAvLyBDcmVhdGUgRGVmYXVsdCBCb3QgaWYgbm8gYm90IGV4aXN0c1xuICBjb25zdCBleGlzdGluZ0JvdCA9IGF3YWl0IHByaXNtYS5ib3QuZmluZEZpcnN0KCk7XG4gIGlmICghZXhpc3RpbmdCb3QpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYm90U3RvcmVOYW1lID0gYXdhaXQgZW5zdXJlRmlsZVNlYXJjaFN0b3JlKCdib3RfbWFya2V0aW5nX2V4cGVydCcpO1xuICAgICAgYXdhaXQgcHJpc21hLmJvdC5jcmVhdGUoe1xuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgbmFtZTogJ9Cc0LDRgNC60LXRgtC+0LvQvtCzJyxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ9Ct0LrRgdC/0LXRgNGCINC/0L4g0YHRgtGA0LDRgtC10LPQuNGH0LXRgdC60L7QvNGDINC80LDRgNC60LXRgtC40L3Qs9GDINC4INCw0L3QsNC70LjQt9GDINC90LjRiNC4JyxcbiAgICAgICAgICBzeXN0ZW1JbnN0cnVjdGlvbjogJ9CS0Ysg0L7Qv9GL0YLQvdGL0Lkg0LHQuNC30L3QtdGBLdC60L7QvdGB0YPQu9GM0YLQsNC90YIg0Lgg0Y3QutGB0L/QtdGA0YIg0L/QviDQvNCw0YDQutC10YLQuNC90LPRgy4g0JjQt9GD0YfQuNGC0LUg0LLQvtC/0YDQvtGB0Ysg0LrQu9C40LXQvdGC0LAg0Lgg0L7RgtCy0LXRh9Cw0LnRgtC1INC80LDQutGB0LjQvNCw0LvRjNC90L4g0L/RgNC+0YTQtdGB0YHQuNC+0L3QsNC70YzQvdC+INC4INGC0L7Rh9C90L4sINCw0YDQs9GD0LzQtdC90YLQuNGA0YPRjyDQvtGC0LLQtdGC0Ysg0LTQsNC90L3Ri9C80Lgg0LjQtyDQv9C+0LTQutC70Y7Rh9C10L3QvdGL0YUg0LHQsNC3INC30L3QsNC90LjQuS4nLFxuICAgICAgICAgIGZpbGVTZWFyY2hTdG9yZU5hbWU6IGJvdFN0b3JlTmFtZVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUud2FybignQVBJIEtleSBub3Qgc2V0IHlldC4gRGVmYXVsdCBib3Qgd2lsbCBiZSBjcmVhdGVkIGFmdGVyIEFQSSBrZXkgaXMgYWRkZWQgaW4gQWRtaW4gUGFuZWwuJyk7XG4gICAgICBhd2FpdCBwcmlzbWEuYm90LmNyZWF0ZSh7XG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBuYW1lOiAn0JzQsNGA0LrQtdGC0L7Qu9C+0LMnLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAn0K3QutGB0L/QtdGA0YIg0L/QviDRgdGC0YDQsNGC0LXQs9C40YfQtdGB0LrQvtC80YMg0LzQsNGA0LrQtdGC0LjQvdCz0YMg0Lgg0LDQvdCw0LvQuNC30YMg0L3QuNGI0LgnLFxuICAgICAgICAgIHN5c3RlbUluc3RydWN0aW9uOiAn0JLRiyDQvtC/0YvRgtC90YvQuSDQsdC40LfQvdC10YEt0LrQvtC90YHRg9C70YzRgtCw0L3RgiDQuCDRjdC60YHQv9C10YDRgiDQv9C+INC80LDRgNC60LXRgtC40L3Qs9GDLiDQmNC30YPRh9C40YLQtSDQstC+0L/RgNC+0YHRiyDQutC70LjQtdC90YLQsCDQuCDQvtGC0LLQtdGH0LDQudGC0LUg0LzQsNC60YHQuNC80LDQu9GM0L3QviDQv9GA0L7RhNC10YHRgdC40L7QvdCw0LvRjNC90L4g0Lgg0YLQvtGH0L3Qviwg0LDRgNCz0YPQvNC10L3RgtC40YDRg9GPINC+0YLQstC10YLRiyDQtNCw0L3QvdGL0LzQuCDQuNC3INC/0L7QtNC60LvRjtGH0LXQvdC90YvRhSDQsdCw0Lcg0LfQvdCw0L3QuNC5LicsXG4gICAgICAgICAgZmlsZVNlYXJjaFN0b3JlTmFtZTogbnVsbFxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cbmluaXREZWZhdWx0cygpLmNhdGNoKGNvbnNvbGUuZXJyb3IpO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBVVRIIEVORFBPSU5UU1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuYXBwLnBvc3QoJy9hcGkvYXV0aC9sb2dpbicsIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGVtYWlsLCBwYXNzd29yZCB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IHVzZXIgPSBhd2FpdCBwcmlzbWEudXNlci5maW5kVW5pcXVlKHsgd2hlcmU6IHsgZW1haWwgfSB9KTtcbiAgaWYgKCF1c2VyIHx8IHVzZXIucm9sZSAhPT0gJ0NMSUVOVCcpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0LUg0YPRh9C10YLQvdGL0LUg0LTQsNC90L3Ri9C1JyB9KTtcbiAgfVxuXG4gIGNvbnN0IGlzVmFsaWQgPSBhd2FpdCBiY3J5cHQuY29tcGFyZShwYXNzd29yZCwgdXNlci5wYXNzd29yZEhhc2gpO1xuICBpZiAoIWlzVmFsaWQpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0LUg0YPRh9C10YLQvdGL0LUg0LTQsNC90L3Ri9C1JyB9KTtcbiAgfVxuXG4gIC8vIEVuc3VyZSB1c2VyIGhhcyBhIGRlZGljYXRlZCBHb29nbGUgRmlsZSBTZWFyY2ggU3RvcmUgKFZhcmlhbnQgQSlcbiAgbGV0IHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IHVzZXJJZDogdXNlci5pZCB9IH0pO1xuICBpZiAoIXVzZXJTdG9yZSkge1xuICAgIGNvbnN0IHN0b3JlRGlzcGxheU5hbWUgPSBgY2xpZW50X3N0b3JlXyR7dXNlci5pZH1gO1xuICAgIGNvbnN0IGZpbGVTZWFyY2hTdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoc3RvcmVEaXNwbGF5TmFtZSk7XG4gICAgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5jcmVhdGUoe1xuICAgICAgZGF0YToge1xuICAgICAgICB1c2VySWQ6IHVzZXIuaWQsXG4gICAgICAgIGZpbGVTZWFyY2hTdG9yZU5hbWVcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGNvbnN0IHRva2VuID0gZ2VuZXJhdGVUb2tlbih7IHVzZXJJZDogdXNlci5pZCwgcm9sZTogdXNlci5yb2xlIH0pO1xuICByZXMuanNvbih7IHRva2VuLCB1c2VyOiB7IGlkOiB1c2VyLmlkLCBlbWFpbDogdXNlci5lbWFpbCwgcm9sZTogdXNlci5yb2xlIH0gfSk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvYXV0aC9hZG1pbi1sb2dpbicsIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IGVtYWlsLCBwYXNzd29yZCwgdG90cENvZGUgfSA9IHJlcS5ib2R5O1xuICBjb25zdCB1c2VyID0gYXdhaXQgcHJpc21hLnVzZXIuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGVtYWlsIH0gfSk7XG4gIGlmICghdXNlciB8fCB1c2VyLnJvbGUgIT09ICdBRE1JTicpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0Lkg0LvQvtCz0LjQvSDQuNC70Lgg0L/QsNGA0L7Qu9GMINCw0LTQvNC40L3QuNGB0YLRgNCw0YLQvtGA0LAnIH0pO1xuICB9XG5cbiAgY29uc3QgaXNWYWxpZFBhc3N3b3JkID0gYXdhaXQgYmNyeXB0LmNvbXBhcmUocGFzc3dvcmQsIHVzZXIucGFzc3dvcmRIYXNoKTtcbiAgaWYgKCFpc1ZhbGlkUGFzc3dvcmQpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0Lkg0LvQvtCz0LjQvSDQuNC70Lgg0L/QsNGA0L7Qu9GMINCw0LTQvNC40L3QuNGB0YLRgNCw0YLQvtGA0LAnIH0pO1xuICB9XG5cbiAgaWYgKHVzZXIudG90cEVuYWJsZWQgJiYgdXNlci50b3RwU2VjcmV0KSB7XG4gICAgaWYgKCF0b3RwQ29kZSkge1xuICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsgZXJyb3I6ICfQotGA0LXQsdGD0LXRgtGB0Y8gMkZBINC60L7QtCcsIHJlcXVpcmUyRkE6IHRydWUgfSk7XG4gICAgfVxuICAgIGNvbnN0IGlzVmFsaWRUb3RwID0gYXV0aGVudGljYXRvci5jaGVjayh0b3RwQ29kZSwgdXNlci50b3RwU2VjcmV0KTtcbiAgICBpZiAoIWlzVmFsaWRUb3RwKSB7XG4gICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDEpLmpzb24oeyBlcnJvcjogJ9Cd0LXQstC10YDQvdGL0LkgMkZBINC60L7QtCDQtNCy0YPRhdGE0LDQutGC0L7RgNC90L7QuSDQsNGD0YLQtdC90YLQuNGE0LjQutCw0YbQuNC4JyB9KTtcbiAgICB9XG4gIH1cblxuICBjb25zdCB0b2tlbiA9IGdlbmVyYXRlVG9rZW4oeyB1c2VySWQ6IHVzZXIuaWQsIHJvbGU6IHVzZXIucm9sZSB9KTtcbiAgcmVzLmpzb24oeyB0b2tlbiwgdXNlcjogeyBpZDogdXNlci5pZCwgZW1haWw6IHVzZXIuZW1haWwsIHJvbGU6IHVzZXIucm9sZSB9IH0pO1xufSk7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENMSUVOVCBFTkRQT0lOVFMgKENIQVQgJiBGSUxFUylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmFwcC5nZXQoJy9hcGkvYm90cycsIGF1dGhlbnRpY2F0ZVRva2VuLCBhc3luYyAocmVxOiBBdXRoUmVxdWVzdCwgcmVzKSA9PiB7XG4gIGNvbnN0IHVzZXJJZCA9IHJlcS51c2VyIS51c2VySWQ7XG4gIC8vIElmIHVzZXIgaXMgQURNSU4sIGdpdmUgYWxsIGJvdHM7IGlmIENMSUVOVCwgZ2l2ZSBhbGxvd2VkIGJvdHMgb3IgYWxsIGlmIG5vbmUgYXNzaWduZWQgeWV0XG4gIGNvbnN0IHVzZXJBY2Nlc3MgPSBhd2FpdCBwcmlzbWEuYm90Q2xpZW50QWNjZXNzLmZpbmRNYW55KHsgd2hlcmU6IHsgdXNlcklkIH0gfSk7XG4gIGxldCBib3RzO1xuICBpZiAodXNlckFjY2Vzcy5sZW5ndGggPiAwKSB7XG4gICAgYm90cyA9IGF3YWl0IHByaXNtYS5ib3QuZmluZE1hbnkoe1xuICAgICAgd2hlcmU6IHsgaWQ6IHsgaW46IHVzZXJBY2Nlc3MubWFwKGEgPT4gYS5ib3RJZCkgfSB9XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgYm90cyA9IGF3YWl0IHByaXNtYS5ib3QuZmluZE1hbnkoKTtcbiAgfVxuICByZXMuanNvbihib3RzKTtcbn0pO1xuXG5hcHAuZ2V0KCcvYXBpL2NoYXQvaGlzdG9yeS86Ym90SWQnLCBhdXRoZW50aWNhdGVUb2tlbiwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCB1c2VySWQgPSByZXEudXNlciEudXNlcklkO1xuICBjb25zdCB7IGJvdElkIH0gPSByZXEucGFyYW1zO1xuXG4gIGNvbnN0IG1lc3NhZ2VzID0gYXdhaXQgcHJpc21hLmNoYXRNZXNzYWdlLmZpbmRNYW55KHtcbiAgICB3aGVyZTogeyB1c2VySWQsIGJvdElkIH0sXG4gICAgb3JkZXJCeTogeyBjcmVhdGVkQXQ6ICdhc2MnIH1cbiAgfSk7XG4gIHJlcy5qc29uKG1lc3NhZ2VzKTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9jaGF0JywgYXV0aGVudGljYXRlVG9rZW4sIGFzeW5jIChyZXE6IEF1dGhSZXF1ZXN0LCByZXMpID0+IHtcbiAgY29uc3QgdXNlcklkID0gcmVxLnVzZXIhLnVzZXJJZDtcbiAgY29uc3QgeyBib3RJZCwgbWVzc2FnZSB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgY29uc3QgYm90ID0gYXdhaXQgcHJpc21hLmJvdC5maW5kVW5pcXVlKHsgd2hlcmU6IHsgaWQ6IGJvdElkIH0gfSk7XG4gIGlmICghYm90KSB7XG4gICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgZXJyb3I6ICfQkdC+0YIg0L3QtSDQvdCw0LnQtNC10L0nIH0pO1xuICB9XG5cbiAgY29uc3QgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5maW5kVW5pcXVlKHsgd2hlcmU6IHsgdXNlcklkIH0gfSk7XG5cbiAgY29uc3Qgc2V0dGluZ3MgPSAoYXdhaXQgcHJpc21hLnN5c3RlbVNldHRpbmdzLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZDogJ2RlZmF1bHQnIH0gfSkpIHx8IHtcbiAgICBzbGlkaW5nV2luZG93U2l6ZTogMTUsXG4gICAgc3VtbWFyaXphdGlvbkVuYWJsZWQ6IHRydWUsXG4gICAgc3VtbWFyaXphdGlvblRocmVzaG9sZDogMzBcbiAgfTtcblxuICAvLyBGZXRjaCBsYXN0IE4gbWVzc2FnZXMgYWNjb3JkaW5nIHRvIHNsaWRpbmcgd2luZG93XG4gIGNvbnN0IHBhc3RNZXNzYWdlcyA9IGF3YWl0IHByaXNtYS5jaGF0TWVzc2FnZS5maW5kTWFueSh7XG4gICAgd2hlcmU6IHsgdXNlcklkLCBib3RJZCB9LFxuICAgIG9yZGVyQnk6IHsgY3JlYXRlZEF0OiAnYXNjJyB9LFxuICAgIHRha2U6IHNldHRpbmdzLnNsaWRpbmdXaW5kb3dTaXplXG4gIH0pO1xuXG4gIGNvbnN0IGhpc3RvcnlNZXNzYWdlcyA9IHBhc3RNZXNzYWdlcy5tYXAobSA9PiAoe1xuICAgIHJvbGU6IG0ucm9sZSBhcyAndXNlcicgfCAnbW9kZWwnLFxuICAgIGNvbnRlbnQ6IG0uY29udGVudFxuICB9KSk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBnZW5lcmF0ZVJBR0Fuc3dlcih7XG4gICAgICBzeXN0ZW1JbnN0cnVjdGlvbjogYm90LnN5c3RlbUluc3RydWN0aW9uLFxuICAgICAgYm90U3RvcmVOYW1lOiBib3QuZmlsZVNlYXJjaFN0b3JlTmFtZSB8fCB1bmRlZmluZWQsXG4gICAgICBjbGllbnRTdG9yZU5hbWU6IHVzZXJTdG9yZT8uZmlsZVNlYXJjaFN0b3JlTmFtZSB8fCB1bmRlZmluZWQsXG4gICAgICBoaXN0b3J5TWVzc2FnZXMsXG4gICAgICBjdXJyZW50UXVlc3Rpb246IG1lc3NhZ2VcbiAgICB9KTtcblxuICAgIC8vIFNhdmUgVXNlciBtZXNzYWdlIGFuZCBNb2RlbCByZXNwb25zZSB0byBEQlxuICAgIGF3YWl0IHByaXNtYS5jaGF0TWVzc2FnZS5jcmVhdGUoe1xuICAgICAgZGF0YTogeyB1c2VySWQsIGJvdElkLCByb2xlOiAndXNlcicsIGNvbnRlbnQ6IG1lc3NhZ2UgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgYm90TWVzc2FnZSA9IGF3YWl0IHByaXNtYS5jaGF0TWVzc2FnZS5jcmVhdGUoe1xuICAgICAgZGF0YToge1xuICAgICAgICB1c2VySWQsXG4gICAgICAgIGJvdElkLFxuICAgICAgICByb2xlOiAnbW9kZWwnLFxuICAgICAgICBjb250ZW50OiByZXN1bHQudGV4dCxcbiAgICAgICAgZ3JvdW5kaW5nTWV0YWRhdGE6IHJlc3VsdC5ncm91bmRpbmdNZXRhZGF0YSA/IEpTT04uc3RyaW5naWZ5KHJlc3VsdC5ncm91bmRpbmdNZXRhZGF0YSkgOiBudWxsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBMb2cgZGlhZ25vc3RpY1xuICAgIGF3YWl0IHByaXNtYS5hcGlEaWFnbm9zdGljcy5jcmVhdGUoe1xuICAgICAgZGF0YToge1xuICAgICAgICB1c2VySWQsXG4gICAgICAgIGJvdElkLFxuICAgICAgICBlbmRwb2ludDogJy9hcGkvY2hhdCcsXG4gICAgICAgIHN0YXR1czogJ1NVQ0NFU1MnLFxuICAgICAgICByZXNwb25zZVRpbWU6IHJlc3VsdC5yZXNwb25zZVRpbWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJlcy5qc29uKGJvdE1lc3NhZ2UpO1xuICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgY29uc3QgcmVzcG9uc2VUaW1lID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICBhd2FpdCBwcmlzbWEuYXBpRGlhZ25vc3RpY3MuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgdXNlcklkLFxuICAgICAgICBib3RJZCxcbiAgICAgICAgZW5kcG9pbnQ6ICcvYXBpL2NoYXQnLFxuICAgICAgICBzdGF0dXM6ICdFUlJPUicsXG4gICAgICAgIGVycm9yTWVzc2FnZTogZXJyb3IubWVzc2FnZSB8fCAn0J7RiNC40LHQutCwINCz0LXQvdC10YDQsNGG0LjQuCBHZW1pbmkgQVBJJyxcbiAgICAgICAgcmVzcG9uc2VUaW1lXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7XG4gICAgICBlcnJvcjogJ9Cd0LUg0YPQtNCw0LvQvtGB0Ywg0L/QvtC70YPRh9C40YLRjCDQvtGC0LLQtdGCINC+0YIg0LDRgdGB0LjRgdGC0LXQvdGC0LAuINCf0L7Qv9GA0L7QsdGD0LnRgtC1INC10YnQtSDRgNCw0Lcg0L/QvtC30LbQtS4nLFxuICAgICAgdGVjaG5pY2FsUmVhc29uOiBlcnJvci5tZXNzYWdlXG4gICAgfSk7XG4gIH1cbn0pO1xuXG4vLyBGSUxFUyAoQnVzaW5lc3MgTGlicmFyeSkgLSBHb29nbGUgRmlsZSBTZWFyY2ggaXMgU2luZ2xlIFNvdXJjZSBvZiBUcnV0aFxuYXBwLmdldCgnL2FwaS9maWxlcycsIGF1dGhlbnRpY2F0ZVRva2VuLCBhc3luYyAocmVxOiBBdXRoUmVxdWVzdCwgcmVzKSA9PiB7XG4gIGNvbnN0IHVzZXJJZCA9IHJlcS51c2VyIS51c2VySWQ7XG4gIGxldCB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmZpbmRVbmlxdWUoeyB3aGVyZTogeyB1c2VySWQgfSB9KTtcbiAgaWYgKCF1c2VyU3RvcmUpIHtcbiAgICBjb25zdCBzdG9yZURpc3BsYXlOYW1lID0gYGNsaWVudF9zdG9yZV8ke3VzZXJJZH1gO1xuICAgIGNvbnN0IGZpbGVTZWFyY2hTdG9yZU5hbWUgPSBhd2FpdCBlbnN1cmVGaWxlU2VhcmNoU3RvcmUoc3RvcmVEaXNwbGF5TmFtZSk7XG4gICAgdXNlclN0b3JlID0gYXdhaXQgcHJpc21hLnVzZXJTdG9yZS5jcmVhdGUoe1xuICAgICAgZGF0YTogeyB1c2VySWQsIGZpbGVTZWFyY2hTdG9yZU5hbWUgfVxuICAgIH0pO1xuICB9XG5cbiAgY29uc3QgZmlsZXMgPSBhd2FpdCBsaXN0RmlsZXNGcm9tU3RvcmUodXNlclN0b3JlLmZpbGVTZWFyY2hTdG9yZU5hbWUpO1xuICByZXMuanNvbihmaWxlcyk7XG59KTtcblxuYXBwLnBvc3QoJy9hcGkvZmlsZXMvdXBsb2FkJywgYXV0aGVudGljYXRlVG9rZW4sIHVwbG9hZC5zaW5nbGUoJ2ZpbGUnKSwgYXN5bmMgKHJlcTogQXV0aFJlcXVlc3QsIHJlcykgPT4ge1xuICBjb25zdCB1c2VySWQgPSByZXEudXNlciEudXNlcklkO1xuICBjb25zdCB7IGZvbGRlclRhZyB9ID0gcmVxLmJvZHk7XG4gIGNvbnN0IGZpbGUgPSByZXEuZmlsZTtcblxuICBpZiAoIWZpbGUpIHtcbiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBlcnJvcjogJ9Ck0LDQudC7INC90LUg0L/QtdGA0LXQtNCw0L0nIH0pO1xuICB9XG5cbiAgbGV0IHVzZXJTdG9yZSA9IGF3YWl0IHByaXNtYS51c2VyU3RvcmUuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IHVzZXJJZCB9IH0pO1xuICBpZiAoIXVzZXJTdG9yZSkge1xuICAgIGNvbnN0IHN0b3JlRGlzcGxheU5hbWUgPSBgY2xpZW50X3N0b3JlXyR7dXNlcklkfWA7XG4gICAgY29uc3QgZmlsZVNlYXJjaFN0b3JlTmFtZSA9IGF3YWl0IGVuc3VyZUZpbGVTZWFyY2hTdG9yZShzdG9yZURpc3BsYXlOYW1lKTtcbiAgICB1c2VyU3RvcmUgPSBhd2FpdCBwcmlzbWEudXNlclN0b3JlLmNyZWF0ZSh7XG4gICAgICBkYXRhOiB7IHVzZXJJZCwgZmlsZVNlYXJjaFN0b3JlTmFtZSB9XG4gICAgfSk7XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IHVwbG9hZGVkID0gYXdhaXQgdXBsb2FkRmlsZVRvU3RvcmUoXG4gICAgICB1c2VyU3RvcmUuZmlsZVNlYXJjaFN0b3JlTmFtZSxcbiAgICAgIGZpbGUucGF0aCxcbiAgICAgIGZpbGUub3JpZ2luYWxuYW1lLFxuICAgICAgZmlsZS5taW1ldHlwZSxcbiAgICAgIGZvbGRlclRhZ1xuICAgICk7XG5cbiAgICAvLyBDbGVhbiB0ZW1wIHVwbG9hZCBmaWxlXG4gICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZS5wYXRoKSkgZnMudW5saW5rU3luYyhmaWxlLnBhdGgpO1xuXG4gICAgcmVzLmpzb24oeyBtZXNzYWdlOiAn0KTQsNC50Lsg0YPRgdC/0LXRiNC90L4g0LfQsNCz0YDRg9C20LXQvSDQsiBHb29nbGUgRmlsZSBTZWFyY2ggU3RvcmUnLCBmaWxlOiB1cGxvYWRlZCB9KTtcbiAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgIGlmIChmaWxlICYmIGZzLmV4aXN0c1N5bmMoZmlsZS5wYXRoKSkgZnMudW5saW5rU3luYyhmaWxlLnBhdGgpO1xuICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyb3I6ICfQntGI0LjQsdC60LAg0LjQvdC00LXQutGB0LDRhtC40Lgg0YTQsNC50LvQsCcsIGRldGFpbHM6IGVycm9yLm1lc3NhZ2UgfSk7XG4gIH1cbn0pO1xuXG5hcHAuZGVsZXRlKCcvYXBpL2ZpbGVzLzpnb29nbGVGaWxlTmFtZScsIGF1dGhlbnRpY2F0ZVRva2VuLCBhc3luYyAocmVxOiBBdXRoUmVxdWVzdCwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgZ29vZ2xlRmlsZU5hbWUgfSA9IHJlcS5wYXJhbXM7XG4gIHRyeSB7XG4gICAgYXdhaXQgZGVsZXRlRmlsZUZyb21TdG9yZShkZWNvZGVVUklDb21wb25lbnQoZ29vZ2xlRmlsZU5hbWUpKTtcbiAgICByZXMuanNvbih7IG1lc3NhZ2U6ICfQpNCw0LnQuyDRg9GB0L/QtdGI0L3QviDRg9C00LDQu9C10L0g0LjQtyBHb29nbGUgRmlsZSBTZWFyY2ggU3RvcmUnIH0pO1xuICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnJvcjogJ9Ce0YjQuNCx0LrQsCDRg9C00LDQu9C10L3QuNGPINGE0LDQudC70LAg0LjQtyBHb29nbGUgU3RvcmUnLCBkZXRhaWxzOiBlcnJvci5tZXNzYWdlIH0pO1xuICB9XG59KTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQURNSU4gRU5EUE9JTlRTXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5hcHAuZ2V0KCcvYXBpL2FkbWluLzJmYS1pbmZvJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IGFkbWluID0gYXdhaXQgcHJpc21hLnVzZXIuZmluZEZpcnN0KHsgd2hlcmU6IHsgcm9sZTogJ0FETUlOJyB9IH0pO1xuICBpZiAoIWFkbWluKSByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oeyBlcnJvcjogJ0FkbWluIG5vdCBmb3VuZCcgfSk7XG4gIGNvbnN0IG90cGF1dGggPSBhdXRoZW50aWNhdG9yLmtleXVyaSgnYWRtaW5Aa3JiLmFpJywgJ0tSQiBTYWFTJywgYWRtaW4udG90cFNlY3JldCB8fCAnS1JCU2FhUzJGQUFkbWluU2VjcmV0S2V5MjAyNicpO1xuICBjb25zdCBxckNvZGVVcmwgPSBhd2FpdCBRUkNvZGUudG9EYXRhVVJMKG90cGF1dGgpO1xuICByZXMuanNvbih7XG4gICAgdG90cEVuYWJsZWQ6IGFkbWluLnRvdHBFbmFibGVkLFxuICAgIHRvdHBTZWNyZXQ6IGFkbWluLnRvdHBTZWNyZXQsXG4gICAgcXJDb2RlVXJsXG4gIH0pO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2FkbWluL3RvZ2dsZS0yZmEnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBlbmFibGVkIH0gPSByZXEuYm9keTtcbiAgY29uc3QgYWRtaW4gPSBhd2FpdCBwcmlzbWEudXNlci5maW5kRmlyc3QoeyB3aGVyZTogeyByb2xlOiAnQURNSU4nIH0gfSk7XG4gIGlmICghYWRtaW4pIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7IGVycm9yOiAnQWRtaW4gbm90IGZvdW5kJyB9KTtcblxuICBjb25zdCB1cGRhdGVkID0gYXdhaXQgcHJpc21hLnVzZXIudXBkYXRlKHtcbiAgICB3aGVyZTogeyBpZDogYWRtaW4uaWQgfSxcbiAgICBkYXRhOiB7IHRvdHBFbmFibGVkOiBlbmFibGVkIH1cbiAgfSk7XG4gIHJlcy5qc29uKHsgdG90cEVuYWJsZWQ6IHVwZGF0ZWQudG90cEVuYWJsZWQgfSk7XG59KTtcblxuYXBwLmdldCgnL2FwaS9hZG1pbi9rZXlzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IGtleXMgPSBhd2FpdCBwcmlzbWEuYXBpS2V5LmZpbmRNYW55KHsgc2VsZWN0OiB7IGlkOiB0cnVlLCBzZXJ2aWNlOiB0cnVlLCBpc0FjdGl2ZTogdHJ1ZSwgY3JlYXRlZEF0OiB0cnVlIH0gfSk7XG4gIHJlcy5qc29uKGtleXMpO1xufSk7XG5cbmFwcC5wb3N0KCcvYXBpL2FkbWluL2tleXMnLCBhdXRoZW50aWNhdGVUb2tlbiwgcmVxdWlyZUFkbWluLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgY29uc3QgeyBzZXJ2aWNlLCBhcGlLZXkgfSA9IHJlcS5ib2R5O1xuICBjb25zdCBlbmNyeXB0ZWQgPSBlbmNyeXB0QXBpS2V5KGFwaUtleSk7XG4gIGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCBwcmlzbWEuYXBpS2V5LmNyZWF0ZSh7XG4gICAgZGF0YToge1xuICAgICAgc2VydmljZSxcbiAgICAgIGVuY3J5cHRlZEtleTogZW5jcnlwdGVkLmVuY3J5cHRlZEtleSxcbiAgICAgIGl2OiBlbmNyeXB0ZWQuaXYsXG4gICAgICBpc0FjdGl2ZTogdHJ1ZVxuICAgIH1cbiAgfSk7XG4gIHJlcy5qc29uKHsgaWQ6IGNyZWF0ZWQuaWQsIHNlcnZpY2U6IGNyZWF0ZWQuc2VydmljZSwgaXNBY3RpdmU6IGNyZWF0ZWQuaXNBY3RpdmUgfSk7XG59KTtcblxuYXBwLnBhdGNoKCcvYXBpL2FkbWluL2tleXMvOmlkJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHsgaWQgfSA9IHJlcS5wYXJhbXM7XG4gIGNvbnN0IHsgaXNBY3RpdmUgfSA9IHJlcS5ib2R5O1xuICBjb25zdCB1cGRhdGVkID0gYXdhaXQgcHJpc21hLmFwaUtleS51cGRhdGUoe1xuICAgIHdoZXJlOiB7IGlkIH0sXG4gICAgZGF0YTogeyBpc0FjdGl2ZSB9XG4gIH0pO1xuICByZXMuanNvbih1cGRhdGVkKTtcbn0pO1xuXG5hcHAuZ2V0KCcvYXBpL2FkbWluL3NldHRpbmdzJywgYXV0aGVudGljYXRlVG9rZW4sIHJlcXVpcmVBZG1pbiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gIGNvbnN0IHNldHRpbmdzID0gYXdhaXQgcHJpc21hLnN5c3RlbVNldHRpbmdzLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZDogJ2RlZmF1bHQnIH0gfSk7XG4gIHJlcy5qc29uKHNldHRpbmdzKTtcbn0pO1xuXG5hcHAucG9zdCgnL2FwaS9hZG1pbi9zZXR0aW5ncycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCB7IHNsaWRpbmdXaW5kb3dTaXplLCBzdW1tYXJpemF0aW9uRW5hYmxlZCwgc3VtbWFyaXphdGlvblRocmVzaG9sZCwgcmF0ZUxpbWl0UGVyTWludXRlLCByYXRlTGltaXRQZXJEYXkgfSA9IHJlcS5ib2R5O1xuICBjb25zdCB1cGRhdGVkID0gYXdhaXQgcHJpc21hLnN5c3RlbVNldHRpbmdzLnVwc2VydCh7XG4gICAgd2hlcmU6IHsgaWQ6ICdkZWZhdWx0JyB9LFxuICAgIHVwZGF0ZTogeyBzbGlkaW5nV2luZG93U2l6ZSwgc3VtbWFyaXphdGlvbkVuYWJsZWQsIHN1bW1hcml6YXRpb25UaHJlc2hvbGQsIHJhdGVMaW1pdFBlck1pbnV0ZSwgcmF0ZUxpbWl0UGVyRGF5IH0sXG4gICAgY3JlYXRlOiB7IGlkOiAnZGVmYXVsdCcsIHNsaWRpbmdXaW5kb3dTaXplLCBzdW1tYXJpemF0aW9uRW5hYmxlZCwgc3VtbWFyaXphdGlvblRocmVzaG9sZCwgcmF0ZUxpbWl0UGVyTWludXRlLCByYXRlTGltaXRQZXJEYXkgfVxuICB9KTtcbiAgcmVzLmpzb24odXBkYXRlZCk7XG59KTtcblxuYXBwLmdldCgnL2FwaS9hZG1pbi9kaWFnbm9zdGljcycsIGF1dGhlbnRpY2F0ZVRva2VuLCByZXF1aXJlQWRtaW4sIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICBjb25zdCBsb2dzID0gYXdhaXQgcHJpc21hLmFwaURpYWdub3N0aWNzLmZpbmRNYW55KHtcbiAgICBvcmRlckJ5OiB7IGNyZWF0ZWRBdDogJ2Rlc2MnIH0sXG4gICAgdGFrZTogMTAwXG4gIH0pO1xuICByZXMuanNvbihsb2dzKTtcbn0pO1xuXG5hcHAubGlzdGVuKFBPUlQsICgpID0+IHtcbiAgY29uc29sZS5sb2coYFNlcnZlciBsaXN0ZW5pbmcgb24gaHR0cDovL2xvY2FsaG9zdDoke1BPUlR9YCk7XG59KTtcbiJdfQ==