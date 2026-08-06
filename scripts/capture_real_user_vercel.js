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
    console.log('1. User is opening https://krb-saa-s-mvp.vercel.app/ in Chrome...');
    const response = await page.goto('https://krb-saa-s-mvp.vercel.app/', { waitUntil: 'networkidle0', timeout: 30000 });

    console.log(`2. Response Status: ${response.status()} ${response.statusText()}`);
    
    // Wait extra 2 seconds for UI render
    await new Promise(r => setTimeout(r, 2000));

    const artifactPath = '/Users/ghost/.gemini/antigravity/brain/2fdf06ea-2281-486c-b17f-c8470f1d4f97/real_user_live_vercel_screenshot.png';
    await page.screenshot({ path: artifactPath, fullPage: false });
    console.log(`✅ Real User Screenshot saved to: ${artifactPath}`);

  } catch (err) {
    console.error('❌ User Opening Error:', err.message);
  } finally {
    await browser.close();
  }
})();
