const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

// Helper: click aside nav button by text content from within the page context (avoids stale handles)
async function clickNavTab(page, tabText) {
  const clicked = await page.evaluate((text) => {
    const buttons = [...document.querySelectorAll('aside button')];
    const btn = buttons.find(b => b.textContent && b.textContent.includes(text));
    if (btn) { btn.click(); return true; }
    return false;
  }, tabText);
  return clicked;
}

// Helper: get all text visible in page including input/textarea values
async function getFullPageText(page) {
  return page.evaluate(() => {
    const bodyText = document.body.textContent || '';
    const inputVals = [...document.querySelectorAll('input, textarea')].map(el => el.value).join(' ');
    return bodyText + ' ' + inputVals;
  });
}

async function runAuditor(targetEnv = 'local') {
  const artifactsDir = '/Users/ghost/.gemini/antigravity/brain/2fdf06ea-2281-486c-b17f-c8470f1d4f97';
  const resultsPath = path.join(artifactsDir, 'ui_e2e_results.json');

  const violations = [];
  let isPassed = false;

  const isProd = targetEnv === 'prod' || process.env.AUDIT_ENV === 'prod';
  const appBaseUrl = isProd ? 'https://krb-saa-s-mvp.vercel.app' : 'http://localhost:5173';
  const apiBaseUrl = isProd ? 'https://krb-saas-mvp.onrender.com' : 'http://127.0.0.1:5001';
  const WAIT = isProd ? 8000 : 4000; // prod needs more time for Render cold-start

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

    // ── Step 1: Admin Login ──────────────────────────────────────────────────
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

    // Inject token before page load so React boots as admin
    await page.goto(`${appBaseUrl}/admin/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate((token, user) => {
      localStorage.setItem('krb_token', token);
      localStorage.setItem('krb_role', 'ADMIN');
      localStorage.setItem('krb_user', JSON.stringify(user));
    }, loginData.token, loginData.user);

    await page.goto(`${appBaseUrl}/admin`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('aside', { timeout: 20000 });
    await page.evaluate(() => new Promise(r => setTimeout(r, 2000)));

    // ── Step 2: API Keys Tab ─────────────────────────────────────────────────
    console.log('[Auditor] Step 2: Auditing API Keys Tab...');
    await clickNavTab(page, 'API-ключи');
    await page.evaluate(() => new Promise(r => setTimeout(r, 3000)));

    const keysText = await getFullPageText(page);
    if (!keysText.includes('GEMINI')) {
      violations.push('API Keys Tab is EMPTY: Active GEMINI API key is missing in database table!');
    }
    await page.screenshot({ path: path.join(artifactsDir, 'auditor_keys_tab.png'), fullPage: true });

    // ── Step 3: Assistants Tab + Active Ping ─────────────────────────────────
    console.log('[Auditor] Step 3: Auditing Assistants Tab & Testing Model Ping...');
    await clickNavTab(page, 'Ассистенты');
    await page.evaluate((ms) => new Promise(r => setTimeout(r, ms)), WAIT);

    // Check bot list BEFORE clicking ping (modal will aria-hide background)
    // Bot name is in <input value=...> not text nodes — use getFullPageText
    const botsTextBefore = await getFullPageText(page);
    if (!botsTextBefore.includes('Маркетолог')) {
      violations.push('Assistants Tab is EMPTY: Bot list (e.g. Маркетолог) is not rendered in DOM');
    }

    // Click ⚡ ping button via page.evaluate to avoid stale handles
    console.log('[Auditor] Clicking "⚡ Проверить отклик" button to test live Google API key...');
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const btn = buttons.find(b => b.textContent && b.textContent.includes('Проверить отклик'));
      if (btn) btn.click();
    });
    // Wait for model API response (can take 2–6s)
    await page.evaluate(() => new Promise(r => setTimeout(r, 7000)));

    // Check for API errors in modal/page text
    const botsTextAfter = await getFullPageText(page);
    if (botsTextAfter.includes('Ошибка сети') || botsTextAfter.includes('Ошибка сервера')) {
      violations.push('Assistants Tab displays Network Error modal / banner');
    }
    if (botsTextAfter.includes('API key not valid') || botsTextAfter.includes('INVALID_ARGUMENT')) {
      violations.push('CRITICAL: Assistants Tab displays "API key not valid" Google Gemini Error modal upon active model test!');
    }
    await page.screenshot({ path: path.join(artifactsDir, 'auditor_bots_tab.png'), fullPage: true });

    // ── Step 4: Users Tab ─────────────────────────────────────────────────────
    console.log('[Auditor] Step 4: Auditing Users Tab...');
    // Close any open modal first by pressing Escape
    await page.keyboard.press('Escape');
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

    // Navigate via page.evaluate to avoid stale handles after React re-render
    await clickNavTab(page, 'Пользователи');
    await page.evaluate((ms) => new Promise(r => setTimeout(r, ms)), WAIT);

    const usersText = await getFullPageText(page);
    if (usersText.includes('Загрузка списка пользователей...')) {
      violations.push('Users Tab stuck in "Загрузка списка пользователей..." state');
    }
    if (!usersText.includes('admin@krb.ai') && !usersText.includes('client@krb.ai')) {
      violations.push('Users Tab is EMPTY: Registered users table is not populated with real accounts');
    }
    await page.screenshot({ path: path.join(artifactsDir, 'auditor_users_tab.png'), fullPage: true });

    // ── Final Verdict ─────────────────────────────────────────────────────────
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
