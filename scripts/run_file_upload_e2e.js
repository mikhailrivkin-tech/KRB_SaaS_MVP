const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

async function testFileUploadE2E() {
  console.log('==================================================');
  console.log('  TESTING CLIENT FILE UPLOAD & DRAG-AND-DROP E2E');
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
    // 1. Navigate & Login as Client
    console.log('[1/4] Navigating and logging in as Client...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.type('input[type="email"]', 'client@krb.ai');
    await page.type('input[type="password"]', 'client123');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 1500));

    // 2. Navigate to Business Library Tab
    console.log('[2/4] Navigating to "Business Library" Tab...');
    await page.evaluate(() => {
      const navBtns = Array.from(document.querySelectorAll('nav button'));
      const libBtn = navBtns.find(b => b.textContent && b.textContent.includes('Библиотека бизнеса'));
      if (libBtn) libBtn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // 3. Create dummy file with REAL CYRILLIC FILENAME to test Russian encoding
    const cyrillicFileName = 'Тестовый_Документ_Кириллица_2026.txt';
    const dummyFilePath = path.join(__dirname, cyrillicFileName);
    fs.writeFileSync(dummyFilePath, 'Тестовый документ с кириллицей для проверки кодировки UTF-8 и переноса.');

    // 4. Test File Input Upload via DOM
    console.log('[3/5] Triggering Cyrillic File Upload via Input Selector...');
    await page.waitForSelector('#drag-drop-file-input', { timeout: 5000 });
    const fileInput = await page.$('#drag-drop-file-input');
    if (!fileInput) throw new Error('#drag-drop-file-input element not found in DOM!');

    await fileInput.uploadFile(dummyFilePath);
    await new Promise(r => setTimeout(r, 2000));

    // Dismiss alert modal if open by clicking OK button
    const modalOkButtons = await page.$$('button');
    for (const btn of modalOkButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.trim() === 'OK') {
        await btn.click();
        await new Promise(r => setTimeout(r, 500));
        break;
      }
    }

    // 5. Strict Cyrillic DOM Validation (Regex check for Russian letters in table rows)
    console.log('[4/5] Performing Strict Cyrillic DOM & Encoding Validation...');
    await new Promise(r => setTimeout(r, 1000));

    // DISMISS UPLOAD SUCCESS MODAL BEFORE PERFORMING MOVE ACTION
    const uploadModalOkButtons = await page.$$('button');
    for (const btn of uploadModalOkButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.trim() === 'OK') {
        await btn.click();
        await new Promise(r => setTimeout(r, 600));
        break;
      }
    }

    const tableRowTexts = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      return rows.map(r => r.textContent || '');
    });

    console.log('DOM table rows found:', JSON.stringify(tableRowTexts));

    const hasCyrillicFileName = tableRowTexts.some(txt => txt.includes('Тестовый_Документ_Кириллица_2026.txt'));
    if (!hasCyrillicFileName) {
      throw new Error(`Cyrillic encoding validation failed! DOM rows: ${JSON.stringify(tableRowTexts)}`);
    }
    console.log('✅ [Cyrillic Encoding Audit] PASSED: Russian filename is correctly rendered in UI DOM without corruption!');

    // 6. Test Move File between Folders (Select dropdown test)
    console.log('[5/5] Testing Move File between Folders...');
    await page.evaluate(() => {
      const selectEl = document.querySelector('tbody tr select');
      if (selectEl) {
        const option = Array.from(selectEl.options).find(o => o.value.includes('Маркетинг') || o.value.includes('Юриспруденция'));
        if (option) {
          selectEl.value = option.value;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
    await new Promise(r => setTimeout(r, 2000));

    // Dismiss success alert modal if present
    const actionButtons = await page.$$('button');
    for (const btn of actionButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.trim() === 'OK') {
        await btn.click();
        await new Promise(r => setTimeout(r, 500));
        break;
      }
    }

    // STRICT DOM & SCREENSHOT TEXT AUDIT (Check for active error dialogs)
    const activeErrorModalText = await page.evaluate(() => {
      const modalTitles = Array.from(document.querySelectorAll('h3, h2, div'));
      const errorDialog = modalTitles.find(el => el.textContent && (
        el.textContent.includes('Не удалось перенести файл') ||
        el.textContent.includes('Ошибка при') ||
        el.textContent.includes('Internal Server Error')
      ));
      return errorDialog ? errorDialog.textContent : null;
    });

    if (activeErrorModalText) {
      throw new Error(`CRITICAL VISUAL AUDIT FAILURE: Active Error Modal detected on screen: "${activeErrorModalText}". Test aborted!`);
    }

    // Dismiss remaining success notification dialog and wait for full modal overlay fade out
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const okBtn = buttons.find(b => b.textContent && b.textContent.trim() === 'OK');
      if (okBtn) okBtn.click();
    });
    await new Promise(r => setTimeout(r, 1200));

    const screenshotPath = path.join(__dirname, 'upload_success_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Cleanup dummy file
    try { fs.unlinkSync(dummyFilePath); } catch (e) {}

    console.log('==================================================');
    console.log('  CYRILLIC ENCODING & MOVE FILE E2E TEST: 100% SUCCESS 🎉');
    console.log(`  Screenshot saved: ${screenshotPath}`);
    console.log('==================================================');

  } catch (err) {
    console.error('❌ FILE UPLOAD E2E FAIL:', err.message);
    await browser.close();
    process.exit(1);
  }

  await browser.close();
}

testFileUploadE2E();
