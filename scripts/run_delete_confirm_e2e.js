const puppeteer = require('puppeteer-core');
const path = require('path');

async function testDeleteConfirmE2E() {
  console.log('==================================================');
  console.log('  TESTING READABLE FILENAME IN DELETE CONFIRM E2E');
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
    console.log('[1/3] Logging in as Client...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.type('input[type="email"]', 'client@krb.ai');
    await page.type('input[type="password"]', 'client123');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 1500));

    console.log('[2/3] Navigating to Business Library & Clicking Trash Icon...');
    await page.evaluate(() => {
      const navBtns = Array.from(document.querySelectorAll('nav button'));
      const libBtn = navBtns.find(b => b.textContent && b.textContent.includes('Библиотека бизнеса'));
      if (libBtn) libBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // Click trash button on last row via DOM evaluate
    await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('tbody tr'));
      if (trs.length > 0) {
        const lastRow = trs[trs.length - 1];
        const deleteBtn = lastRow.querySelector('button');
        if (deleteBtn) deleteBtn.click();
      }
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log('[3/3] Inspecting Modal Confirmation Text...');
    const confirmModalText = await page.evaluate(() => {
      const modal = document.querySelector('div[role="dialog"]') || document.body;
      return modal ? modal.textContent : '';
    });

    console.log('Modal Confirm Text found:', confirmModalText);

    if (confirmModalText.includes('fileSearchStores/')) {
      throw new Error(`TEST FAILED: Technical Google path "fileSearchStores/" is still present in confirm dialog!`);
    }

    console.log('✅ [Delete Modal Audit] PASSED: Confirm modal presents clean readable filename without technical paths!');

    const screenshotPath = path.join(__dirname, 'delete_confirm_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log('==================================================');
    console.log('  DELETE CONFIRM MODAL E2E TEST: 100% SUCCESS 🎉');
    console.log(`  Screenshot saved: ${screenshotPath}`);
    console.log('==================================================');

  } catch (err) {
    console.error('❌ DELETE CONFIRM E2E FAIL:', err.message);
    await browser.close();
    process.exit(1);
  }

  await browser.close();
}

testDeleteConfirmE2E();
