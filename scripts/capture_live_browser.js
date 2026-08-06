const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

async function captureLiveBrowser() {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  try {
    console.log('[1/4] Connecting to http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    console.log('[2/4] Logging in as client@krb.ai...');
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.type('input[type="email"]', 'client@krb.ai');
    await page.type('input[type="password"]', 'client123');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 1500));

    console.log('[3/4] Navigating to Business Library & Uploading file...');
    await page.evaluate(() => {
      const navBtns = Array.from(document.querySelectorAll('header nav button'));
      const libBtn = navBtns.find(b => b.textContent && b.textContent.includes('Библиотека бизнеса'));
      if (libBtn) libBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    const testFilePath = path.join(__dirname, 'Тестовый_Документ_Кириллица_2026.txt');
    if (!fs.existsSync(testFilePath)) {
      fs.writeFileSync(testFilePath, 'Тест регламента.', 'utf8');
    }

    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.uploadFile(testFilePath);
      // Wait 400ms for status bar to render
      await new Promise(r => setTimeout(r, 400));
    }

    console.log('[4/4] Capturing screenshot of Active Upload Status Bar...');
    const liveUploadScreenshot = path.join(__dirname, 'live_upload_statusbar.png');
    await page.screenshot({ path: liveUploadScreenshot, fullPage: true });
    console.log('Saved live upload screenshot:', liveUploadScreenshot);

    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('DOM Text on screen:', bodyText.substring(0, 500));

  } catch (err) {
    console.error('Capture Live Error:', err.message);
  } finally {
    await browser.close();
  }
}

captureLiveBrowser();
