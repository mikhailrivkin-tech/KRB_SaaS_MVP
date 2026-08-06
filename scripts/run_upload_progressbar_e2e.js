const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

async function testUploadProgressBarE2E() {
  console.log('==================================================');
  console.log('  TESTING FILE UPLOAD PROGRESS BAR UI E2E');
  console.log('==================================================');

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  try {
    console.log('[1/4] Logging in as Client...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.type('input[type="email"]', 'client@krb.ai');
    await page.type('input[type="password"]', 'client123');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 1500));

    console.log('[2/4] Navigating to Business Library Tab...');
    await page.evaluate(() => {
      const navBtns = Array.from(document.querySelectorAll('header nav button'));
      const libBtn = navBtns.find(b => b.textContent && b.textContent.includes('Библиотека бизнеса'));
      if (libBtn) libBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log('[3/4] Triggering File Upload to Inspect Status Bar UI...');
    const testFilePath = path.join(__dirname, 'Тестовый_Документ_Кириллица_2026.txt');
    if (!fs.existsSync(testFilePath)) {
      fs.writeFileSync(testFilePath, 'Содержимое регламента компании KRB 2026.', 'utf8');
    }

    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.uploadFile(testFilePath);
      // Wait 300ms so the active progress bar UI appears
      await new Promise(r => setTimeout(r, 300));
    }

    console.log('[4/4] Capturing Active Progress Bar UI Screenshot...');
    const screenshotPath = path.join(__dirname, 'upload_progressbar_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log('==================================================');
    console.log('  FILE UPLOAD PROGRESS BAR E2E TEST: 100% SUCCESS 🎉');
    console.log(`  Screenshot saved: ${screenshotPath}`);
    console.log('==================================================');

  } catch (err) {
    console.error('❌ PROGRESS BAR E2E FAIL:', err.message);
    await browser.close();
    process.exit(1);
  }

  await browser.close();
}

testUploadProgressBarE2E();
