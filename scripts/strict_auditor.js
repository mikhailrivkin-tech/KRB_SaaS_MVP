const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

async function runAuditor() {
  const artifactsDir = '/Users/ghost/.gemini/antigravity/brain/2fdf06ea-2281-486c-b17f-c8470f1d4f97';
  const resultsPath = path.join(artifactsDir, 'ui_e2e_results.json');
  
  const violations = [];
  let isPassed = false;

  console.log('====================================================');
  console.log('🛡️ RUNNING AUTONOMOUS STRICT AUDITOR (E2E ASSERTION)');
  console.log('====================================================');

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // Step 1: Direct Admin Login Token acquisition
    console.log('[Auditor] Step 1: Fetching Admin Auth Token directly...');
    const loginRes = await fetch('http://127.0.0.1:5001/api/auth/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@krb.ai', password: 'admin123' })
    });
    
    if (!loginRes.ok) {
      violations.push(`Backend Admin Auth failed with HTTP status ${loginRes.status}`);
    }
    const loginData = await loginRes.json();
    if (!loginData.token) {
      violations.push('No JWT token returned from /api/auth/admin-login');
    }

    // Set token directly BEFORE navigating so initial App boot renders Admin state
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await page.evaluate((token, user) => {
      localStorage.setItem('krb_token', token);
      localStorage.setItem('krb_role', 'ADMIN');
      localStorage.setItem('krb_user', JSON.stringify(user));
    }, loginData.token, loginData.user);

    await page.goto('http://localhost:5173/admin', { waitUntil: 'networkidle0' });

    await page.waitForSelector('aside', { timeout: 15000 });
    await page.evaluate(() => new Promise(r => setTimeout(r, 2000)));

    // Step 2: Audit API Keys Tab
    console.log('[Auditor] Step 2: Auditing API Keys Tab...');
    const navButtons = await page.$$('aside button');
    for (const btn of navButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('API-ключи')) {
        await btn.click();
        break;
      }
    }
    await page.evaluate(() => new Promise(r => setTimeout(r, 2000)));

    const keysTabText = await page.evaluate(() => document.body.innerText);
    if (!keysTabText.includes('GEMINI')) {
      violations.push('API Keys Tab is EMPTY: Active GEMINI API key is missing in database table!');
    }
    await page.screenshot({ path: path.join(artifactsDir, 'auditor_keys_tab.png'), fullPage: true });

    // Step 3: Audit Bots / Assistants Tab
    console.log('[Auditor] Step 3: Auditing Assistants Tab...');
    for (const btn of navButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('Ассистенты')) {
        await btn.click();
        break;
      }
    }
    await page.evaluate(() => new Promise(r => setTimeout(r, 4000)));

    const botsTabText = await page.evaluate(() => document.body.innerText);
    if (botsTabText.includes('Ошибка сети') || botsTabText.includes('Ошибка сервера')) {
      violations.push('Assistants Tab displays Network Error modal / banner');
    }
    
    if (!botsTabText.includes('Маркетолог')) {
      violations.push('Assistants Tab is EMPTY: Bot list (e.g. Маркетолог) is not rendered in DOM');
    }

    await page.screenshot({ path: path.join(artifactsDir, 'auditor_bots_tab.png'), fullPage: true });

    // Step 4: Audit Users Tab
    console.log('[Auditor] Step 4: Auditing Users Tab...');
    for (const btn of navButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('Пользователи')) {
        await btn.click();
        break;
      }
    }
    await page.evaluate(() => new Promise(r => setTimeout(r, 4000)));

    const usersTabText = await page.evaluate(() => document.body.innerText);
    if (usersTabText.includes('Загрузка списка пользователей...')) {
      violations.push('Users Tab stuck in "Загрузка списка пользователей..." state');
    }
    if (!usersTabText.includes('admin@krb.ai') && !usersTabText.includes('client@krb.ai')) {
      violations.push('Users Tab is EMPTY: Registered users table is not populated with real accounts');
    }

    await page.screenshot({ path: path.join(artifactsDir, 'auditor_users_tab.png'), fullPage: true });

    // Final Verdict Determination
    isPassed = violations.length === 0;

  } catch (err) {
    violations.push(`Auditor Execution Exception: ${err.message}`);
    isPassed = false;
  } finally {
    if (browser) await browser.close();
  }

  const resultPayload = {
    timestamp: new Date().toISOString(),
    passed: isPassed,
    violations: violations,
    screenshots: [
      path.join(artifactsDir, 'auditor_keys_tab.png'),
      path.join(artifactsDir, 'auditor_bots_tab.png'),
      path.join(artifactsDir, 'auditor_users_tab.png')
    ]
  };

  fs.writeFileSync(resultsPath, JSON.stringify(resultPayload, null, 2));

  console.log('\n====================================================');
  console.log(`🛡️ AUDITOR VERDICT: ${isPassed ? '✅ PASSED' : '❌ FAILED'}`);
  if (violations.length > 0) {
    console.log('VIOLATIONS FOUND:');
    violations.forEach((v, idx) => console.log(`  ${idx + 1}. ❌ ${v}`));
  }
  console.log('====================================================\n');

  if (!isPassed) {
    process.exit(1);
  }
}

runAuditor();
