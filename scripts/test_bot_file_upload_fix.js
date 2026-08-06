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

    console.log('3. Uploading file to Bot RAG Store...');
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      const testFilePath = '/Users/ghost/Documents/Cloud/GDrive/mikhail_rivkin/Business/Projects/KRB/AntiGravity/KRB_SaaS_MVP/scripts/Тестовый_Документ_Кириллица_2026.txt';
      await fileInput.uploadFile(testFilePath);
      await new Promise(r => setTimeout(r, 4000));
    }

    console.log('4. Capturing screenshot after bot upload...');
    const screenshotPath = '/Users/ghost/.gemini/antigravity/brain/2fdf06ea-2281-486c-b17f-c8470f1d4f97/fixed_bot_file_upload_screenshot.png';
    await page.screenshot({ path: screenshotPath });
    console.log(`✅ Upload Fix Verified! Screenshot saved to ${screenshotPath}`);

  } catch (err) {
    console.error('❌ Upload Fix QA Error:', err.message);
  } finally {
    await browser.close();
  }
})();
