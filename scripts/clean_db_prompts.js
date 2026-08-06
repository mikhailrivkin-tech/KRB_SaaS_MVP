const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    console.log('--- Cleaning System Settings dualRagPrompt ---');
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    if (settings && settings.dualRagPrompt) {
      let cleanedPrompt = settings.dualRagPrompt
        .replace(/`\*\(Источник:.*?\)\*`/g, '')
        .replace(/\*\(Источник:.*?\)\*/g, '')
        .replace(/\(Источник:.*?\)/g, '');

      // Append strict formatting rule
      cleanedPrompt += `\n\n--- [ПРАВИЛА ОФОРМЛЕНИЯ И ИСТОЧНИКОВ] ---
КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО вставлять в текст ответа скобки вида *(Источник: ...)* или технические имена файлов в кавычках.
Пиши чистый, эстетичный бизнес-текст без встроенных технических ссылок — все цитируемые источники автоматически выводятся в нижней панели интерфейса.`;

      await prisma.systemSettings.update({
        where: { id: 'default' },
        data: { dualRagPrompt: cleanedPrompt }
      });
      console.log('✅ SystemSettings.dualRagPrompt successfully cleaned!');
    }

    console.log('--- Cleaning Bot System Instructions ---');
    const bots = await prisma.bot.findMany();
    for (const b of bots) {
      if (b.systemInstruction) {
        let cleanedBotInst = b.systemInstruction
          .replace(/`\*\(Источник:.*?\)\*`/g, '')
          .replace(/\*\(Источник:.*?\)\*/g, '')
          .replace(/\(Источник:.*?\)/g, '');

        await prisma.bot.update({
          where: { id: b.id },
          data: { systemInstruction: cleanedBotInst }
        });
        console.log(`✅ Bot "${b.name}" systemInstruction cleaned!`);
      }
    }
  } catch (err) {
    console.error('Error cleaning DB prompts:', err);
  } finally {
    await prisma.$disconnect();
  }
})();
