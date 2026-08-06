const puppeteer = require('puppeteer-core');
const path = require('path');

async function capturePerplexityChat() {
  console.log('Capturing Perplexity AI Style Chat Screenshot...');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: `/tmp/puppeteer_perplexity_profile_${Date.now()}`,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  try {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.type('input[type="email"]', 'client@krb.ai');
    await page.type('input[type="password"]', 'client123');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 2000));

    const screenshotPath = path.join(__dirname, 'perplexity_style_chat_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log('✅ Perplexity style chat screenshot saved:', screenshotPath);
  } catch (err) {
    console.error('Screenshot Capture Error:', err.message);
  } finally {
    await browser.close();
  }
}

capturePerplexityChat();
