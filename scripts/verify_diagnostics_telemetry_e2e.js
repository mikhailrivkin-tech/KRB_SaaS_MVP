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

    console.log('5. Navigating to Diagnostics tab...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const diagTab = btns.find(b => b.textContent.includes('Диагностика Gemini'));
      if (diagTab) diagTab.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log('6. Verifying Diagnostics Table Headers in DOM...');
    const domCheck = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('th')).map(th => th.textContent.trim());
      return {
        headers: ths,
        hasLatencyHeader: ths.some(h => h.includes('Latency')),
        hasModelHeader: ths.some(h => h.includes('Модель Gemini'))
      };
    });

    console.log('Diagnostics Table DOM Check:', domCheck);

    if (!domCheck.hasLatencyHeader || !domCheck.hasModelHeader) {
      throw new Error('ASSERTION FAIL: Table headers for "Latency (мс)" or "Модель Gemini" missing in Diagnostics tab!');
    }

    console.log('✅ DIAGNOSTICS TELEMETRY ASSERTION PASSED 100%!');

    await page.screenshot({ path: 'scripts/diagnostics_verified_screenshot.png' });
    console.log('Screenshot saved to scripts/diagnostics_verified_screenshot.png');
  } catch (err) {
    console.error('❌ DIAGNOSTICS ASSERTION FAILED:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
