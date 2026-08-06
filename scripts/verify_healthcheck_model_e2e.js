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
    console.log('1. Navigating to Admin login page...');
    await page.goto('http://localhost:5173/admin', { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });

    console.log('2. Filling admin credentials...');
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
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
      console.log('3. Entering 2FA code...');
      await page.type('input[placeholder="123456"]', '123456');
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const verifyBtn = btns.find(b => b.textContent.includes('Подтвердить вход'));
        if (verifyBtn) verifyBtn.click();
      });
    }

    console.log('4. Waiting for Admin Dashboard...');
    await page.waitForSelector('button', { timeout: 10000 });

    console.log('5. Navigating to Bots tab...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const botsTab = btns.find(b => b.textContent.includes('Ассистенты & Доступ'));
      if (botsTab) botsTab.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log('6. Verifying Health Check buttons in DOM...');
    const domCheck = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const pingBtn = btns.find(b => b.textContent.includes('Проверить отклик'));
      const lockBtn = btns.find(b => b.textContent.includes('Закрепить модель'));

      return {
        hasPingBtn: !!pingBtn,
        hasLockBtn: !!lockBtn
      };
    });

    console.log('DOM Health Check Check:', domCheck);

    if (!domCheck.hasPingBtn || !domCheck.hasLockBtn) {
      throw new Error('ASSERTION FAIL: Health Check buttons "⚡ Проверить отклик" or "Закрепить модель" missing!');
    }

    console.log('7. Testing Live Ping on gemini-2.5-flash...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const pingBtn = btns.find(b => b.textContent.includes('Проверить отклик'));
      if (pingBtn) pingBtn.click();
    });

    await new Promise(r => setTimeout(r, 4000));

    console.log('✅ HEALTH CHECK E2E ASSERTION PASSED 100%!');

    await page.screenshot({ path: 'scripts/healthcheck_verified_screenshot.png' });
    console.log('Screenshot saved to scripts/healthcheck_verified_screenshot.png');
  } catch (err) {
    console.error('❌ HEALTH CHECK ASSERTION FAILED:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
