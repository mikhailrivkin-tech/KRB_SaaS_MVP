const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

async function runProdAuditor() {
  const artifactsDir = '/Users/ghost/.gemini/antigravity/brain/2fdf06ea-2281-486c-b17f-c8470f1d4f97';
  const resultsPath = path.join(artifactsDir, 'ui_e2e_results.json');
  const screenshotPath = path.join(artifactsDir, 'ui_screenshot.png');
  const liveAdminScreenshot = path.join(artifactsDir, 'prod_admin_dashboard.png');
  const liveUsersScreenshot = path.join(artifactsDir, 'prod_users_tab.png');
  
  const violations = [];
  let isPassed = false;

  console.log('====================================================');
  console.log('🛡️ RUNNING PRODUCTION STRICT AUDITOR (LIVE VERIFICATION)');
  console.log('====================================================');

  const prodBaseUrl = 'https://krb-saas-api.onrender.com';
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // Step 1: Health check & Auth API check on production
    console.log('[Prod Auditor] Step 1: Checking Production API health & Auth...');
    const loginRes = await fetch(`${prodBaseUrl}/api/auth/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@krb.ai', password: 'admin123' })
    });
    
    if (!loginRes.ok) {
      violations.push(`Production Admin Auth failed with HTTP status ${loginRes.status}`);
    }
    const loginData = await loginRes.json();
    if (!loginData.token) {
      violations.push('No JWT token returned from Production /api/auth/admin-login');
    }

    // Step 2: Open Production Web App
    console.log('[Prod Auditor] Step 2: Loading Production Web App UI...');
    await page.goto(`${prodBaseUrl}/admin/login`, { waitUntil: 'networkidle0', timeout: 30000 });
    
    // Inject admin session directly
    await page.evaluate((token, user) => {
      localStorage.setItem('krb_token', token);
      localStorage.setItem('krb_role', 'ADMIN');
      localStorage.setItem('krb_user', JSON.stringify(user));
    }, loginData.token, loginData.user);

    await page.goto(`${prodBaseUrl}/admin`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('aside', { timeout: 20000 });
    await page.evaluate(() => new Promise(r => setTimeout(r, 3000)));

    // Step 3: Audit Assistants & RAG Store Tab
    console.log('[Prod Auditor] Step 3: Auditing Assistants Tab on Production...');
    const botsTabText = await page.evaluate(() => document.body.innerText);
    
    if (botsTabText.includes('Ошибка сети') || botsTabText.includes('Ошибка сервера')) {
      violations.push('Production Assistants Tab displays Network Error modal / banner');
    }
    if (!botsTabText.includes('Маркетолог')) {
      violations.push('Production Assistants Tab is EMPTY: Bot list (e.g. Маркетолог) is missing in DOM');
    }

    await page.screenshot({ path: liveAdminScreenshot, fullPage: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Step 4: Audit Users Tab on Production
    console.log('[Prod Auditor] Step 4: Auditing Users Tab on Production...');
    const userButtons = await page.$$('aside button');
    for (const btn of userButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('Пользователи')) {
        await btn.click();
        break;
      }
    }
    await page.evaluate(() => new Promise(r => setTimeout(r, 4000)));

    const usersTabText = await page.evaluate(() => document.body.innerText);
    if (usersTabText.includes('Загрузка списка пользователей...')) {
      violations.push('Production Users Tab stuck in "Загрузка списка пользователей..." state');
    }
    if (!usersTabText.includes('admin@krb.ai') && !usersTabText.includes('client@krb.ai')) {
      violations.push('Production Users Tab is EMPTY: Registered users table is not populated with real accounts');
    }

    await page.screenshot({ path: liveUsersScreenshot, fullPage: true });

    // Final Verdict Determination
    isPassed = violations.length === 0;

  } catch (err) {
    violations.push(`Production Auditor Exception: ${err.message}`);
    isPassed = false;
  } finally {
    if (browser) await browser.close();
  }

  const resultPayload = {
    timestamp: new Date().toISOString(),
    passed: isPassed,
    violations: violations,
    screenshots: [
      liveAdminScreenshot,
      liveUsersScreenshot,
      screenshotPath
    ]
  };

  fs.writeFileSync(resultsPath, JSON.stringify(resultPayload, null, 2));

  console.log('\n====================================================');
  console.log(`🛡️ PRODUCTION AUDITOR VERDICT: ${isPassed ? '✅ PASSED' : '❌ FAILED'}`);
  if (violations.length > 0) {
    console.log('VIOLATIONS FOUND:');
    violations.forEach((v, idx) => console.log(`  ${idx + 1}. ❌ ${v}`));
  }
  console.log('====================================================\n');

  if (!isPassed) {
    process.exit(1);
  }
}

runProdAuditor();
