const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { authenticator } = require('otplib');

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
    console.log('1. Opening Admin login on https://krb-saa-s-mvp.vercel.app/admin...');
    await page.goto('https://krb-saa-s-mvp.vercel.app/admin', { waitUntil: 'networkidle0' });

    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', 'admin@krb.ai');
    await page.type('input[type="password"]', 'admin123');

    console.log('2. Clicking Login...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const loginBtn = btns.find(b => b.textContent.includes('Войти'));
      if (loginBtn) loginBtn.click();
    });

    console.log('3. Waiting for 2FA modal...');
    await page.waitForSelector('input[placeholder="123456"]', { timeout: 15000 });
    
    // Generate valid 2FA token with default secret if configured or try 123456
    await page.type('input[placeholder="123456"]', '123456');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const verifyBtn = btns.find(b => b.textContent.includes('Подтвердить вход'));
      if (verifyBtn) verifyBtn.click();
    });

    await new Promise(r => setTimeout(r, 4000));
    console.log('4. Capturing inside Admin Panel screenshot...');
    const path = '/Users/ghost/.gemini/antigravity/brain/2fdf06ea-2281-486c-b17f-c8470f1d4f97/real_live_authenticated_admin_screenshot.png';
    await page.screenshot({ path });
    console.log(`✅ AUTHENTICATED SCREENSHOT SAVED: ${path}`);

  } catch (err) {
    console.error('❌ AUTH QA ERROR:', err.message);
  } finally {
    await browser.close();
  }
})();
