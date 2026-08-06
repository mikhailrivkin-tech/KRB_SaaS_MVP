const puppeteer = require('puppeteer-core');
const path = require('path');

async function verifyMaskedAdminLogin() {
  console.log('Verifying Masked Admin Login Security...');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: `/tmp/puppeteer_masked_admin_${Date.now()}`,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  try {
    // 1. Open Root Page /
    console.log('1. Checking Main Client Login Page (http://localhost:5173/)...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1500));

    const rootScreenshotPath = path.join(__dirname, 'masked_root_login_screenshot.png');
    await page.screenshot({ path: rootScreenshotPath, fullPage: true });

    const rootContent = await page.content();
    const hasPublicAdminBtn = rootContent.includes('Вход для администратора');
    console.log('Public Admin Toggle on / :', hasPublicAdminBtn ? '⚠️ VISIBLE' : '✅ HIDDEN (Secure)');

    // 2. Open Direct /admin Route
    console.log('2. Checking Direct Admin Gateway (http://localhost:5173/admin)...');
    await page.goto('http://localhost:5173/admin', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1500));

    const adminScreenshotPath = path.join(__dirname, 'masked_admin_route_screenshot.png');
    await page.screenshot({ path: adminScreenshotPath, fullPage: true });

    const adminContent = await page.content();
    const isGatewayActive = adminContent.includes('Вход в Админ-панель');
    console.log('Admin Gateway on /admin :', isGatewayActive ? '✅ ACTIVE' : '❌ INACTIVE');

    console.log('🎉 VERIFICATION COMPLETE: Screenshots saved.');
  } catch (err) {
    console.error('Verification Error:', err.message);
  } finally {
    await browser.close();
  }
}

verifyMaskedAdminLogin();
