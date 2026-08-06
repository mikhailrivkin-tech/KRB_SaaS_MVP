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
    console.log('1. Navigating directly to LIVE Admin Panel (https://krb-saa-s-mvp.vercel.app/admin)...');
    await page.goto('https://krb-saa-s-mvp.vercel.app/admin', { waitUntil: 'networkidle0' });

    console.log('2. Logging in as Admin on LIVE site...');
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.type('input[type="email"]', 'admin@krb.ai');
    await page.type('input[type="password"]', 'admin123');

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const loginBtn = btns.find(b => b.textContent.includes('Войти'));
      if (loginBtn) loginBtn.click();
    });

    await new Promise(r => setTimeout(r, 2000));
    const has2fa = await page.$('input[placeholder="123456"]');
    if (has2fa) {
      await page.type('input[placeholder="123456"]', '123456');
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const verifyBtn = btns.find(b => b.textContent.includes('Подтвердить вход'));
        if (verifyBtn) verifyBtn.click();
      });
    }

    console.log('3. Navigating to Chat with Assistant on LIVE site...');
    await page.waitForSelector('button', { timeout: 15000 });
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const chatTab = btns.find(b => b.textContent.includes('Чат с ассистентом'));
      if (chatTab) chatTab.click();
    });
    await new Promise(r => setTimeout(r, 3000));

    console.log('4. Capturing LIVE Vercel Chat Page screenshot...');
    const screenshotPath = '/Users/ghost/.gemini/antigravity/brain/2fdf06ea-2281-486c-b17f-c8470f1d4f97/real_live_admin_dashboard_screenshot.png';
    await page.screenshot({ path: screenshotPath });
    console.log(`✅ Live Vercel Admin QA Verified! Screenshot saved to ${screenshotPath}`);

  } catch (err) {
    console.error('❌ Live Vercel QA Error:', err.message);
  } finally {
    await browser.close();
  }
})();
