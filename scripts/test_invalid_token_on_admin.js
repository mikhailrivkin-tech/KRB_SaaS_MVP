const puppeteer = require('puppeteer-core');
const path = require('path');

async function testInvalidTokenOnAdmin() {
  console.log('Testing Client/Corrupted Token Navigation to /admin...');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: `/tmp/puppeteer_invalid_token_${Date.now()}`,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  try {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    
    // Inject CLIENT token & role into localStorage
    await page.evaluate(() => {
      localStorage.setItem('krb_token', 'fake_invalid_client_token');
      localStorage.setItem('krb_role', 'CLIENT');
    });

    console.log('Navigating directly to http://localhost:5173/admin with CLIENT token...');
    await page.goto('http://localhost:5173/admin', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2000));

    const screenshotPath = path.join(__dirname, 'invalid_token_auto_cleaned_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Verify localStorage was auto-cleaned
    const remainingToken = await page.evaluate(() => localStorage.getItem('krb_token'));
    console.log('Remaining token in localStorage:', remainingToken);

    if (remainingToken === null) {
      console.log('🎉 SUCCESS: Invalid/Client token was automatically purged upon accessing /admin!');
    } else {
      console.log('⚠️ WARNING: Token was not purged!');
    }

    console.log('✅ Screenshot saved:', screenshotPath);
  } catch (err) {
    console.error('Test Error:', err.message);
  } finally {
    await browser.close();
  }
}

testInvalidTokenOnAdmin();
