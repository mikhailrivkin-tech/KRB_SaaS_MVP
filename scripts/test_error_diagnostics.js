const puppeteer = require('puppeteer-core');
const path = require('path');

async function testErrorDiagnostics() {
  console.log('Testing Rich Error Diagnostics UI...');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: `/tmp/puppeteer_diag_profile_${Date.now()}`,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  try {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    // Switch to Admin Login
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a, span'));
      const adminToggle = btns.find(b => b.textContent && b.textContent.includes('Вход для администратора'));
      if (adminToggle) adminToggle.click();
    });
    await new Promise(r => setTimeout(r, 800));

    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.type('input[type="email"]', 'admin@krb.ai');
    await page.type('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 2000));

    // Navigate to Logs Tab
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const logsBtn = btns.find(b => b.textContent && b.textContent.includes('Системные Логи'));
      if (logsBtn) logsBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    const screenshotPath = path.join(__dirname, 'admin_logs_rich_diagnostics.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log('✅ Admin logs screenshot saved:', screenshotPath);
  } catch (err) {
    console.error('Test error:', err.message);
  } finally {
    await browser.close();
  }
}

testErrorDiagnostics();
