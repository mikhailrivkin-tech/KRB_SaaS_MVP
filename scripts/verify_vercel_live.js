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

  const apiLogs = [];
  page.on('response', async res => {
    if (res.url().includes('/api/')) {
      let bodyText = '';
      try { bodyText = await res.text(); } catch (e) {}
      apiLogs.push({
        url: res.url(),
        status: res.status(),
        statusText: res.statusText(),
        bodyText
      });
    }
  });

  try {
    console.log('1. Navigating to Vercel Admin URL...');
    await page.goto('https://krb-saa-s-mvp.vercel.app/admin', { waitUntil: 'networkidle0', timeout: 30000 });

    console.log('2. Typing Admin login credentials...');
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.type('input[type="email"]', 'admin@krb.ai');
    await page.type('input[type="password"]', 'admin123');

    console.log('3. Clicking "Войти"...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const loginBtn = btns.find(b => b.textContent.includes('Войти'));
      if (loginBtn) loginBtn.click();
    });

    await new Promise(r => setTimeout(r, 4000));
    console.log('API Responses:', JSON.stringify(apiLogs, null, 2));

    await page.screenshot({ path: 'scripts/vercel_admin_api_error_screenshot.png' });
    console.log('Screenshot saved to scripts/vercel_admin_api_error_screenshot.png');
  } catch (err) {
    console.error('❌ Vercel Admin Inspection Error:', err.message);
  } finally {
    await browser.close();
  }
})();
