const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    console.log('--- 1. Checking Local Database Bots & BotFiles ---');
    const bots = await prisma.bot.findMany({
      include: { files: true }
    });
    console.log('Bots in Local DB:', JSON.stringify(bots, null, 2));

    console.log('--- 2. Checking ApiKeys in Local DB ---');
    const keys = await prisma.apiKey.findMany();
    console.log('API Keys in Local DB:', keys.map(k => ({ id: k.id, service: k.service, isActive: k.isActive })));

  } catch (err) {
    console.error('Debug Error:', err);
  } finally {
    await prisma.$disconnect();
  }
})();
