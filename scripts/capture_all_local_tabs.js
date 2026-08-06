const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

async function run() {
  const artifactsDir = '/Users/ghost/.gemini/antigravity/brain/2fdf06ea-2281-486c-b17f-c8470f1d4f97';

  console.log('[E2E Protocol] Launching Puppeteer Core with Google Chrome...');
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Get token via direct node fetch to backend
  const res = await fetch('http://127.0.0.1:5001/api/auth/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@krb.ai', password: 'admin123' })
  });
  const data = await res.json();
  console.log('[E2E Protocol] Got direct token:', data.token ? 'YES' : 'NO');

  await page.goto('http://localhost:5173/admin', { waitUntil: 'domcontentloaded' });
  await page.evaluate((token, user) => {
    localStorage.setItem('krb_token', token);
    localStorage.setItem('krb_role', 'ADMIN');
    localStorage.setItem('krb_user', JSON.stringify(user));
    window.location.href = '/admin';
  }, data.token, data.user);

  await page.waitForSelector('aside', { timeout: 15000 });

  // 1. Bots Tab
  console.log('[E2E Protocol] Navigating to Bots Tab...');
  const buttons1 = await page.$$('aside button');
  for (const btn of buttons1) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Ассистенты')) {
      await btn.click();
      break;
    }
  }
  await page.evaluate(() => new Promise(r => setTimeout(r, 4000)));
  await page.screenshot({ path: path.join(artifactsDir, 'local_e2e_bots_tab.png'), fullPage: true });

  // 2. Users Tab
  console.log('[E2E Protocol] Navigating to Users Tab...');
  const buttons2 = await page.$$('aside button');
  for (const btn of buttons2) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Пользователи')) {
      await btn.click();
      break;
    }
  }
  await page.evaluate(() => new Promise(r => setTimeout(r, 4000)));
  await page.screenshot({ path: path.join(artifactsDir, 'local_e2e_users_tab.png'), fullPage: true });

  // 3. Diagnostics Tab
  console.log('[E2E Protocol] Navigating to Diagnostics Tab...');
  const buttons3 = await page.$$('aside button');
  for (const btn of buttons3) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Диагностика')) {
      await btn.click();
      break;
    }
  }
  await page.evaluate(() => new Promise(r => setTimeout(r, 4000)));
  await page.screenshot({ path: path.join(artifactsDir, 'local_e2e_diagnostics_tab.png'), fullPage: true });

  console.log('✅ ALL ADMIN TAB SCREENSHOTS CAPTURED PERFECTLY!');
  await browser.close();
}

run().catch(err => {
  console.error('❌ E2E PROTOCOL TEST FAILED:', err);
  process.exit(1);
});
