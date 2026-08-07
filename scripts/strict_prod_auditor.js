const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

async function runAuditor(targetEnv = 'local') {
  const artifactsDir = '/Users/ghost/.gemini/antigravity/brain/2fdf06ea-2281-486c-b17f-c8470f1d4f97';
  const resultsPath = path.join(artifactsDir, 'ui_e2e_results.json');
  
  const violations = [];
  let isPassed = false;

  const isProd = targetEnv === 'prod' || process.env.AUDIT_ENV === 'prod';
  const appBaseUrl = isProd ? 'https://krb-saa-s-mvp.vercel.app' : 'http://localhost:5173';
  const apiBaseUrl = isProd ? 'https://krb-saas-mvp.onrender.com' : 'http://127.0.0.1:5001';

  console.log('====================================================');
  console.log(`🛡️ RUNNING AUDITOR ON [${isProd ? 'PRODUCTION (VERCEL+RENDER)' : 'LOCAL (DEV)'}]`);
  console.log(`🌐 App URL: ${appBaseUrl}`);
  console.log(`⚙️  API URL: ${apiBaseUrl}`);
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
    const loginRes = await fetch(`${apiBaseUrl}/api/auth/admin-login`, {
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
    await page.goto(`${appBaseUrl}/admin/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate((token, user) => {
      localStorage.setItem('krb_token', token);
      localStorage.setItem('krb_role', 'ADMIN');
      localStorage.setItem('krb_user', JSON.stringify(user));
    }, loginData.token, loginData.user);

    await page.goto(`${appBaseUrl}/admin`, { waitUntil: 'networkidle0', timeout: 30000 });

    await page.waitForSelector('aside', { timeout: 20000 });
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

    // Step 3: Audit Bots / Assistants Tab & Active Google API Ping
    console.log('[Auditor] Step 3: Auditing Assistants Tab & Testing Model Ping...');
    const botNavButtons = await page.$$('aside button');
    for (const btn of botNavButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('Ассистенты')) {
        await btn.click();
        break;
      }
    }
    await page.evaluate(() => new Promise(r => setTimeout(r, 4000)));

    // Actively click "⚡ Проверить отклик" button
    const testPingButtons = await page.$$('button');
    for (const btn of testPingButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('Проверить отклик')) {
        console.log('[Auditor] Clicking "⚡ Проверить отклик" button to test live Google API key...');
        await btn.click();
        await page.evaluate(() => new Promise(r => setTimeout(r, 4000)));
        break;
      }
    }

    const botsTabText = await page.evaluate(() => document.body.innerText);
    if (botsTabText.includes('Ошибка сети') || botsTabText.includes('Ошибка сервера')) {
      violations.push('Assistants Tab displays Network Error modal / banner');
    }
    if (botsTabText.includes('API key not valid') || botsTabText.includes('INVALID_ARGUMENT')) {
      violations.push('CRITICAL: Assistants Tab displays "API key not valid" Google Gemini Error modal upon active model test!');
    }
    
    if (!botsTabText.includes('Маркетолог')) {
      violations.push('Assistants Tab is EMPTY: Bot list (e.g. Маркетолог) is not rendered in DOM');
    }

    await page.screenshot({ path: path.join(artifactsDir, 'auditor_bots_tab.png'), fullPage: true });

    // Step 4: Audit Users Tab
    console.log('[Auditor] Step 4: Auditing Users Tab...');
    const userNavButtons = await page.$$('aside button');
    for (const btn of userNavButtons) {
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
    env: isProd ? 'production' : 'local',
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
  console.log(`🛡️ AUDITOR VERDICT [${isProd ? 'PROD' : 'LOCAL'}]: ${isPassed ? '✅ PASSED' : '❌ FAILED'}`);
  if (violations.length > 0) {
    console.log('VIOLATIONS FOUND:');
    violations.forEach((v, idx) => console.log(`  ${idx + 1}. ❌ ${v}`));
  }
  console.log('====================================================\n');

  if (!isPassed) {
    process.exit(1);
  }
}

const targetEnv = process.argv[2] || 'local';
runAuditor(targetEnv);
