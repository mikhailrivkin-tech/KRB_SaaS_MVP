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
    console.log('1. Navigating to Client login...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });

    console.log('2. Logging in as Client...');
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'client@krb.ai');
    await page.type('input[type="password"]', 'client123');

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const loginBtn = btns.find(b => b.textContent.includes('Войти'));
      if (loginBtn) loginBtn.click();
    });

    console.log('3. Navigating explicitly to Chat View...');
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate(() => {
      const navBtns = Array.from(document.querySelectorAll('button'));
      const chatBtn = navBtns.find(b => b.textContent.includes('Чат с ассистентом'));
      if (chatBtn) chatBtn.click();
    });

    console.log('4. Sending question to Bot...');
    await page.waitForSelector('input[placeholder="Напишите ваш запрос или вопрос по документам..."]', { timeout: 10000 });
    await page.type('input[placeholder="Напишите ваш запрос или вопрос по документам..."]', 'Что такое КРБ?');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const sendBtn = btns.find(b => b.querySelector('svg') || b.type === 'submit');
      if (sendBtn) sendBtn.click();
    });

    console.log('5. Waiting for Bot response...');
    await new Promise(r => setTimeout(r, 8000));

    await page.screenshot({ path: 'scripts/clean_sources_dialog_screenshot.png' });
    console.log('Screenshot saved to scripts/clean_sources_dialog_screenshot.png');
  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    await browser.close();
  }
})();
