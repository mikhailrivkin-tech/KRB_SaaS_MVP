const puppeteer = require('puppeteer-core');
const path = require('path');

async function captureUpdatedBotLabels() {
  console.log('Capturing Updated Bot Labels Screenshot...');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: `/tmp/puppeteer_bot_labels_${Date.now()}`,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  try {
    await page.goto('http://localhost:5173/admin', { waitUntil: 'networkidle0' });
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });

    const emailInput = await page.$('input[type="email"]');
    await emailInput.evaluate(el => el.value = '');
    await emailInput.type('admin@krb.ai');

    const passInput = await page.$('input[type="password"]');
    await passInput.evaluate(el => el.value = '');
    await passInput.type('admin123');

    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 2500));

    // Open Bots tab
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const botsBtn = btns.find(b => b.textContent && b.textContent.includes('Ассистенты'));
      if (botsBtn) botsBtn.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    const screenshotPath = path.join(__dirname, 'updated_bot_labels_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log('✅ Screenshot saved:', screenshotPath);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

captureUpdatedBotLabels();
