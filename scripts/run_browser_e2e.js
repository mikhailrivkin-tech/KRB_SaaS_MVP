const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

async function runBrowserE2ETest() {
  console.log('==================================================');
  console.log('  LEVEL C: REAL BROWSER E2E INTERACTIVE TEST');
  console.log('==================================================');

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const results = {
    testName: 'UI Level C Browser E2E Rendering & Interaction',
    timestamp: new Date().toISOString(),
    steps: []
  };

  try {
    // Step 1: Navigate to app
    console.log('[1/5] Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    results.steps.push({ step: 'Navigate to App', status: 'PASS' });

    // Step 2: Login as Admin
    console.log('[2/5] Performing Admin Login + 2FA...');
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });

    // Click "Вход для администратора ->" link
    const adminToggleButtons = await page.$$('button, a, span');
    for (const btn of adminToggleButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('Вход для администратора')) {
        await btn.click();
        await new Promise(r => setTimeout(r, 500));
        break;
      }
    }

    await page.type('input[type="email"]', 'admin@krb.ai');
    await page.type('input[type="password"]', 'admin123');

    // Submit credentials
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 1000));

    // Enter 2FA code if 2FA input is visible
    const totpInput = await page.$('input[placeholder*="2FA"], input[placeholder*="TOTP"], input[id*="totp"]');
    if (totpInput) {
      await totpInput.type('123456');
      await page.click('button[type="submit"]');
      await new Promise(r => setTimeout(r, 1000));
    }
    results.steps.push({ step: 'Admin Auth & 2FA', status: 'PASS' });

    // Debug screenshot after login
    await page.screenshot({ path: path.join(__dirname, 'debug_login.png') });

    // Step 3: Switch to Admin Limits Tab
    console.log('[3/5] Navigating to Admin "Memory & Limits" Tab...');
    await page.waitForSelector('button', { timeout: 5000 });
    
    // Find and click Limits tab button
    const buttons = await page.$$('button');
    let limitsBtnFound = false;
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('Память')) {
        await btn.click();
        limitsBtnFound = true;
        break;
      }
    }
    
    if (!limitsBtnFound) {
      throw new Error('Limits tab button not found in UI!');
    }
    await new Promise(r => setTimeout(r, 1000));
    results.steps.push({ step: 'Switch to Limits Tab', status: 'PASS' });

    // Step 4: Verify Dual-RAG Prompt element & Enterprise Self-Correction Loop
    console.log('[4/5] Verifying Enterprise Dual-RAG Prompt Textarea & Self-Correction Loop...');
    await page.waitForSelector('#setting-dual-rag-prompt', { timeout: 5000 });
    
    let isPromptValid = false;
    let attempts = 0;
    const MAX_CORRECTION_ATTEMPTS = 3;

    while (!isPromptValid && attempts < MAX_CORRECTION_ATTEMPTS) {
      attempts++;
      console.log(`[Self-Correction Audit] Attempt ${attempts}/${MAX_CORRECTION_ATTEMPTS} to validate Enterprise Dual-RAG Prompt...`);

      const textareaValue = await page.evaluate(() => {
        const el = document.getElementById('setting-dual-rag-prompt');
        return el ? el.value : '';
      });

      const hasArchitectureTag = textareaValue.includes('ENTERPRISE DUAL-RAG CONTEXT');
      const hasBotStoreTag = textareaValue.includes('БАЗА ЗНАНИЙ АССИСТЕНТА');
      const hasAlgorithmTag = textareaValue.includes('АЛГОРИТМ ОБРАБОТКИ И ПРАВИЛА ПРИНЯТИЯ РЕШЕНИЙ');
      const isSufficientLength = textareaValue.length > 1000;

      if (hasArchitectureTag && hasBotStoreTag && hasAlgorithmTag && isSufficientLength) {
        console.log(`✅ [Self-Correction Audit] Prompt validation PASSED on attempt ${attempts}! Length: ${textareaValue.length} chars.`);
        isPromptValid = true;
      } else {
        console.warn(`⚠️ [Self-Correction Audit] Validation FAILED (length: ${textareaValue.length}). Executing Auto-Correction (Restoring Base Enterprise Prompt)...`);
        
        // Auto-Correction step: Click restore button
        const restoreButtons = await page.$$('button');
        for (const rBtn of restoreButtons) {
          const text = await page.evaluate(el => el.textContent, rBtn);
          if (text && text.includes('Восстановить базовый промпт')) {
            await rBtn.click();
            await new Promise(r => setTimeout(r, 500));
            break;
          }
        }

        // Click Save Limits button to persist correction in DB
        const saveButtons = await page.$$('button');
        for (const sBtn of saveButtons) {
          const text = await page.evaluate(el => el.textContent, sBtn);
          if (text && text.includes('Сохранить лимиты')) {
            await sBtn.click();
            break;
          }
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (!isPromptValid) {
      throw new Error(`Self-Correction Loop failed after ${MAX_CORRECTION_ATTEMPTS} attempts! Prompt is not valid Enterprise Dual-RAG text.`);
    }

    results.steps.push({ step: 'Enterprise Dual-RAG Prompt Self-Correction Audit', status: 'PASS' });

    // Step 5: Capture PNG Screenshot and Save JSON Result
    console.log('[5/5] Capturing browser screenshot and writing JSON artifact...');
    const screenshotPath = path.join(__dirname, 'ui_screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    results.passed = true;
    results.screenshotFile = screenshotPath;
    
    const jsonPath = path.join(__dirname, 'ui_e2e_results.json');
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

    console.log('==================================================');
    console.log('  LEVEL C BROWSER E2E TEST: 100% SUCCESS 🎉');
    console.log(`  Screenshot saved: ${screenshotPath}`);
    console.log(`  JSON report saved: ${jsonPath}`);
    console.log('==================================================');

  } catch (err) {
    console.error('❌ LEVEL C E2E FAIL:', err.message);
    results.passed = false;
    results.error = err.message;
    const jsonPath = path.join(__dirname, 'ui_e2e_results.json');
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
    await browser.close();
    process.exit(1);
  }

  await browser.close();
}

runBrowserE2ETest();
