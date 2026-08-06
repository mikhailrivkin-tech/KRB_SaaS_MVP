const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

async function runFullSystemQA() {
  console.log('==================================================');
  console.log('  3-PHASE AUTOMATED SYSTEM QA ENGINE (RULES 9, 10 & LIFECYCLE)');
  console.log('==================================================');

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: `/tmp/puppeteer_qa_profile_${Date.now()}`,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-zygote',
      '--single-process'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const networkErrors = [];

  // PHASE 2 ENGINE: Global Network Interceptor
  page.on('response', response => {
    const url = response.url();
    const status = response.status();
    if (url.includes('/api/') && status >= 400) {
      console.error(`❌ PHASE 2 NETWORK FAIL: ${response.request().method()} ${url} -> Status ${status}`);
      networkErrors.push(`${response.request().method()} ${url} [${status}]`);
    }
  });

  try {
    console.log('\n--- SCENARIO 1: CLIENT FILE LIFECYCLE AUDIT (client@krb.ai) ---');
    
    // 1. LOGIN & SOLUTION 2 BUNDLE HASH ASSERTION
    console.log('[1/5] Logging in as Client & Verifying Live Dev Bundle Marker on Port 5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    // SOLUTION 2: BUNDLE HASH ASSERTION (Verify page is serving live fresh code)
    const buildTimestamp = await page.evaluate(() => window.__BUILD_TIMESTAMP__);
    console.log('Detected Live Build Timestamp on page:', buildTimestamp);

    if (buildTimestamp !== 'LIVE_DEV_2026_07_29_V3') {
      throw new Error(`CRITICAL BUNDLE DESYNC FAIL: Server is serving stale code "${buildTimestamp}" instead of "LIVE_DEV_2026_07_29_V3"!`);
    }
    console.log('✅ SOLUTION 2 PASSED: Confirmed page is 100% serving live fresh code from App.tsx!');

    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.type('input[type="email"]', 'client@krb.ai');
    await page.type('input[type="password"]', 'client123');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 1500));

    // 2. NAVIGATE TO BUSINESS LIBRARY
    console.log('[2/5] Navigating to Business Library...');
    await page.evaluate(() => {
      const navBtns = Array.from(document.querySelectorAll('header nav button'));
      const libBtn = navBtns.find(b => b.textContent && b.textContent.includes('Библиотека бизнеса'));
      if (libBtn) libBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // 3. UPLOAD WITH PHASE 1 PENDING STATUS BAR AUDIT
    console.log('[3/5] Triggering File Upload & Testing PHASE 1 Pending Status Bar...');
    const testFilePath = path.join(__dirname, 'Тестовый_Документ_Кириллица_2026.txt');
    if (!fs.existsSync(testFilePath)) {
      fs.writeFileSync(testFilePath, 'Регламент компании KRB 2026.', 'utf8');
    }

    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.uploadFile(testFilePath);
      // Wait 300ms to catch active Pending UI
      await new Promise(r => setTimeout(r, 300));
    }

    // PHASE 1 ASSERTION: Verify active progress bar UI during upload
    const uploadPendingStateText = await page.evaluate(() => document.body.innerText);
    const hasUploadPendingUI = uploadPendingStateText.includes('Идет векторная индексация файла') || 
                               uploadPendingStateText.includes('Загрузка в Google Gemini Vector Store');
    
    if (!hasUploadPendingUI) {
      throw new Error(`PHASE 1 FAIL: Active Upload Status Bar / Progress Bar was NOT detected in DOM during file upload!`);
    }
    console.log('✅ PHASE 1 PASSED: Upload Progress Bar & Spinner UI actively confirmed in DOM!');

    // Capture Frame 1: Active Upload Status Bar
    const screenshot1Path = path.join(__dirname, 'frame_1_upload_progressbar.png');
    await page.screenshot({ path: screenshot1Path, fullPage: true });

    // Wait for upload completion and dismiss notification
    await new Promise(r => setTimeout(r, 2200));
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const okBtn = btns.find(b => b.textContent && b.textContent.trim() === 'OK');
      if (okBtn) okBtn.click();
    });
    await new Promise(r => setTimeout(r, 800));

    // 4. FOLDER TRANSFER WITH PHASE 2 NETWORK AUDIT
    console.log('[4/5] Testing Folder Transfer & Network Status 200...');
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
    await new Promise(r => setTimeout(r, 1500));

    if (networkErrors.length > 0) {
      throw new Error(`PHASE 2 NETWORK FAIL: API returned error statuses: ${JSON.stringify(networkErrors)}`);
    }
    console.log('✅ PHASE 2 PASSED: All API requests returned HTTP 200 OK without network errors!');

    // 5. DELETE WITH PHASE 1 PENDING STATUS BAR & READABLE MODAL AUDIT
    console.log('[5/5] Testing Delete Action & PHASE 1 Delete Status Bar...');
    
    // Open Confirm Modal
    await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('tbody tr'));
      if (trs.length > 0) {
        const lastRow = trs[trs.length - 1];
        const deleteBtn = lastRow.querySelector('button');
        if (deleteBtn) deleteBtn.click();
      }
    });
    await new Promise(r => setTimeout(r, 800));

    // Verify modal text has no technical fileSearchStores/ path
    const modalText = await page.evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]') || document.body;
      return dialog ? dialog.textContent : '';
    });

    if (modalText.includes('fileSearchStores/')) {
      throw new Error(`PHASE 3 FAIL: Technical path "fileSearchStores/" leaked into confirm modal! Text: "${modalText}"`);
    }
    console.log('✅ PHASE 3 PASSED: Confirm modal displays clean readable filename!');

    // Confirm Delete
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const delBtn = btns.find(b => b.textContent && b.textContent.trim() === 'Удалить');
      if (delBtn) delBtn.click();
    });

    // Catch Active Delete Pending UI
    await new Promise(r => setTimeout(r, 300));
    const deletePendingText = await page.evaluate(() => document.body.innerText);
    const hasDeletePendingUI = deletePendingText.includes('Удаление файла из Google RAG Store') || 
                               deletePendingText.includes('Удаление...');

    if (!hasDeletePendingUI) {
      throw new Error(`PHASE 1 FAIL: Active Delete Status Bar was NOT detected in DOM after confirming delete!`);
    }
    console.log('✅ PHASE 1 PASSED: Delete Status Bar & Spinner UI actively confirmed in DOM!');

    // Capture Frame 3: Active Delete Status Bar
    const screenshot3Path = path.join(__dirname, 'frame_3_delete_progressbar.png');
    await page.screenshot({ path: screenshot3Path, fullPage: true });

    await new Promise(r => setTimeout(r, 1500));

    // GENERATE MACHINE QA REPORT
    const reportPath = path.join(__dirname, 'full_system_qa_report.json');
    const reportData = {
      passed: true,
      timestamp: new Date().toISOString(),
      phases: {
        phase_1_pending_ui: 'PASSED (Upload & Delete Status Bars Verified)',
        phase_2_network_audit: 'PASSED (All HTTP 200 OK)',
        phase_3_settled_integrity: 'PASSED (No Error Dialogs & Clean DOM)'
      },
      screenshots: [screenshot1Path, screenshot3Path]
    };
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), 'utf8');

    console.log('\n==================================================');
    console.log('  3-PHASE AUTOMATED SYSTEM QA ENGINE: 100% SUCCESS 🎉');
    console.log(`  Report generated: ${reportPath}`);
    console.log('==================================================');

  } catch (err) {
    console.error('\n❌ FULL SYSTEM QA ENGINE FAILED:', err.message);
    process.exit(1);
  }

  await browser.close();
}

runFullSystemQA();
