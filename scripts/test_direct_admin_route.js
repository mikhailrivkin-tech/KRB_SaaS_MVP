const puppeteer = require('puppeteer-core');
const path = require('path');

async function testDirectAdminRoute() {
  console.log('Testing Direct /admin Route Navigation...');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: `/tmp/puppeteer_direct_admin_${Date.now()}`,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  try {
    // 1. Direct navigation to /admin without token
    await page.goto('http://localhost:5173/admin', { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1500));

    const screenshotPath = path.join(__dirname, 'direct_admin_route_fixed_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log('✅ Direct /admin route fixed screenshot saved:', screenshotPath);
  } catch (err) {
    console.error('Test Error:', err.message);
  } finally {
    await browser.close();
  }
}

testDirectAdminRoute();
