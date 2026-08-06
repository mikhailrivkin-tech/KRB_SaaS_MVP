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
    console.log('1. Navigating to Admin login...');
    await page.goto('http://localhost:5173/admin', { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });

    console.log('2. Logging in as Admin...');
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
      await page.type('input[placeholder="123456"]', '123456');
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const verifyBtn = btns.find(b => b.textContent.includes('Подтвердить вход'));
        if (verifyBtn) verifyBtn.click();
      });
    }

    console.log('3. Navigating to Bots tab...');
    await page.waitForSelector('button', { timeout: 10000 });
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const botsTab = btns.find(b => b.textContent.includes('Ассистенты & Доступ'));
      if (botsTab) botsTab.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log('4. Entering fake model name "gemini-non-existent-99"...');
    await page.evaluate(() => {
      const select = document.querySelector('select');
      if (select) {
        select.value = 'custom';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const customInput = document.querySelector('input[placeholder*="gemini"]');
      if (customInput) {
        customInput.value = 'gemini-non-existent-99';
        customInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    console.log('5. Clicking "⚡ Проверить отклик"...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const pingBtn = btns.find(b => b.textContent.includes('Проверить отклик'));
      if (pingBtn) pingBtn.click();
    });

    console.log('6. Waiting for Google API response modal...');
    await new Promise(r => setTimeout(r, 4500));

    console.log('7. Verifying Modal Text Assertion...');
    const modalCheck = await page.evaluate(() => {
      const modal = document.querySelector('.fixed');
      const text = modal ? modal.textContent : '';
      return {
        hasModal: !!modal,
        text,
        containsGoogleError: text.includes('Google API') || text.includes('models/gemini-non-existent-99') || text.includes('not found')
      };
    });

    console.log('Modal Check Result:', modalCheck);

    if (!modalCheck.hasModal || !modalCheck.containsGoogleError) {
      throw new Error(`ASSERTION FAIL: Modal did not display real Google API error text! Text received: "${modalCheck.text}"`);
    }

    console.log('✅ GOOGLE API ERROR TEXT VERIFIED 100%!');

    await page.screenshot({ path: 'scripts/google_error_text_verified_screenshot.png' });
    console.log('Screenshot saved to scripts/google_error_text_verified_screenshot.png');
  } catch (err) {
    console.error('❌ ERROR TEXT ASSERTION FAILED:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
