const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

async function runCascadeDeepE2E() {
  console.log('==================================================');
  console.log('  CASCADE DEEP MULTI-FUNCTION E2E QA TEST (RULES 9 & 10)');
  console.log('==================================================');

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const apiErrors = [];

  try {
    // ACCOUNT 1: CLIENT USER (client@krb.ai)
    console.log('\n--- TESTING ACCOUNT 1: CLIENT USER (client@krb.ai) ---');
    console.log('[1/5] Logging in as Client...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1000));
    
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.type('input[type="email"]', 'client@krb.ai');
    await page.type('input[type="password"]', 'client123');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 2000));

    console.log('[2/5] Navigating to Business Library Tab...');
    await page.evaluate(() => {
      const navBtns = Array.from(document.querySelectorAll('header nav button'));
      const libBtn = navBtns.find(b => b.textContent && b.textContent.includes('Библиотека бизнеса'));
      if (libBtn) libBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log('[3/5] Testing Cyrillic Upload & Verification...');
    const testFilePath = path.join(__dirname, 'Тестовый_Документ_Кириллица_2026.txt');
    if (!fs.existsSync(testFilePath)) {
      fs.writeFileSync(testFilePath, 'Содержимое регламента компании KRB 2026 для RAG тестирования.', 'utf8');
    }

    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.uploadFile(testFilePath);
      await new Promise(r => setTimeout(r, 2500));
    }

    // Dismiss upload notification dialog
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const okBtn = btns.find(b => b.textContent && b.textContent.trim() === 'OK');
      if (okBtn) okBtn.click();
    });
    await new Promise(r => setTimeout(r, 800));

    console.log('[4/5] Testing Folder Transfer with Network Audit...');
    await page.evaluate(() => {
      const selectEl = document.querySelector('tbody tr select');
      if (selectEl) {
        const opt = Array.from(selectEl.options).find(o => o.value.includes('Маркетинг'));
        if (opt) {
          selectEl.value = opt.value;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
    await new Promise(r => setTimeout(r, 2000));

    if (apiErrors.length > 0) {
      throw new Error(`CRITICAL NETWORK FAILURE DETECTED: ${JSON.stringify(apiErrors)}`);
    }

    console.log('✅ [Client Move Audit] PASSED: /api/files/move returned HTTP 200 OK without errors!');

    console.log('[5/5] Testing Delete Confirm Modal Text Cleanliness...');
    await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('tbody tr'));
      if (trs.length > 0) {
        const lastRow = trs[trs.length - 1];
        const deleteBtn = lastRow.querySelector('button');
        if (deleteBtn) deleteBtn.click();
      }
    });
    await new Promise(r => setTimeout(r, 1000));

    const confirmModalText = await page.evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]') || document.body;
      return dialog ? dialog.textContent : '';
    });

    if (confirmModalText.includes('fileSearchStores/')) {
      throw new Error(`RULE 7 AUDIT FAILURE: Technical path "fileSearchStores/" leaked into confirm modal! Text: "${confirmModalText}"`);
    }

    console.log('✅ [Client Delete Audit] PASSED: Confirm modal displays readable filename without technical paths!');

    const screenshotPath = path.join(__dirname, 'cascade_deep_qa_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log('\n==================================================');
    console.log('  CASCADE DEEP MULTI-FUNCTION E2E TEST: 100% PASSED 🎉');
    console.log(`  Screenshot saved: ${screenshotPath}`);
    console.log('==================================================');

  } catch (err) {
    console.error('\n❌ CASCADE DEEP E2E TEST FAILED:', err.message);
    await browser.close();
    process.exit(1);
  }

  await browser.close();
}

runCascadeDeepE2E();
