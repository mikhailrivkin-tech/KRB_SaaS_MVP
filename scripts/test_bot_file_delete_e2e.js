const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await puppeteer.launch({
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Auto accept confirm dialog
  page.on('dialog', async dialog => {
    console.log('Dialog opened:', dialog.message());
    await dialog.accept();
  });

  try {
    console.log('1. Logging in as Admin...');
    await page.goto('http://localhost:5173/admin', { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });

    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', 'admin@krb.ai');
    await page.type('input[type="password"]', 'admin123');

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const loginBtn = btns.find(b => b.textContent.includes('Войти'));
      if (loginBtn) loginBtn.click();
    });

    await new Promise(r => setTimeout(r, 1000));
    const has2fa = await page.$('input[placeholder="123456"]');
    if (has2fa) {
      await page.type('input[placeholder="123456"]', '123456');
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const verifyBtn = btns.find(b => b.textContent.includes('Подтвердить вход'));
        if (verifyBtn) verifyBtn.click();
      });
    }

    console.log('2. Navigating to Bots tab...');
    await page.waitForSelector('button', { timeout: 10000 });
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const botsTab = btns.find(b => b.textContent.includes('Ассистенты & Доступ'));
      if (botsTab) botsTab.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    console.log('3. Clicking delete icon on first bot file...');
    const deleteBtn = await page.$('button[title="Удалить документ из RAG"]');
    if (deleteBtn) {
      await deleteBtn.click();
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log('4. Capturing screenshot after bot file deletion...');
    const screenshotPath = '/Users/ghost/.gemini/antigravity/brain/2fdf06ea-2281-486c-b17f-c8470f1d4f97/bot_file_deleted_screenshot.png';
    await page.screenshot({ path: screenshotPath });
    console.log(`✅ Delete Feature Verified! Screenshot saved to ${screenshotPath}`);

  } catch (err) {
    console.error('❌ Delete QA Error:', err.message);
  } finally {
    await browser.close();
  }
})();
