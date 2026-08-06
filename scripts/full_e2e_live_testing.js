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

  const networkLogs = [];
  page.on('response', async res => {
    if (res.url().includes('/api/')) {
      let bodyText = '';
      try { bodyText = await res.text(); } catch (e) {}
      networkLogs.push({ url: res.url(), status: res.status(), bodyText });
    }
  });

  try {
    console.log('1. Awakening Render backend via API ping...');
    try {
      await fetch('https://krb-saas-mvp.onrender.com/api/admin/bots');
    } catch (e) {}

    console.log('2. Testing Admin Login on https://krb-saa-s-mvp.vercel.app/admin...');
    await page.goto('https://krb-saa-s-mvp.vercel.app/admin', { waitUntil: 'networkidle0' });

    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', 'admin@krb.ai');
    await page.type('input[type="password"]', 'admin123');

    console.log('3. Clicking "Войти в систему"...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const loginBtn = btns.find(b => b.textContent.includes('Войти'));
      if (loginBtn) loginBtn.click();
    });

    console.log('4. Waiting for Render Cold-Start response (25s)...');
    await new Promise(r => setTimeout(r, 25000));

    const has2fa = await page.$('input[placeholder="123456"]');
    console.log('Has 2FA modal:', !!has2fa);
    if (has2fa) {
      await page.type('input[placeholder="123456"]', '123456');
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const verifyBtn = btns.find(b => b.textContent.includes('Подтвердить вход'));
        if (verifyBtn) verifyBtn.click();
      });
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log('5. Capturing Admin Dashboard Screenshot...');
    await page.screenshot({ path: '/Users/ghost/.gemini/antigravity/brain/2fdf06ea-2281-486c-b17f-c8470f1d4f97/real_live_admin_dashboard_screenshot.png' });

    console.log('6. Switching Tabs in Admin Panel...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const botsTab = btns.find(b => b.textContent.includes('Ассистенты & Доступ'));
      if (botsTab) botsTab.click();
    });
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: '/Users/ghost/.gemini/antigravity/brain/2fdf06ea-2281-486c-b17f-c8470f1d4f97/real_live_bots_tab_screenshot.png' });

    console.log('API Network Logs:', JSON.stringify(networkLogs, null, 2));

  } catch (err) {
    console.error('❌ E2E Cold-Start Testing Error:', err.message);
  } finally {
    await browser.close();
  }
})();
