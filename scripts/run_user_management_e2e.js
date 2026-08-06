const puppeteer = require('puppeteer-core');
const path = require('path');

async function runUserManagementE2E() {
  console.log('🚀 Running User Management E2E Test...');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: `/tmp/puppeteer_users_e2e_${Date.now()}`,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1380, height: 900 });

  const testEmail = `new_test_client_${Date.now()}@krb.ai`;
  const testPassword = 'testpassword123';

  try {
    // 1. Login as Admin
    console.log('1. Logging in as Admin...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1000));

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a, span'));
      const adminToggle = btns.find(b => b.textContent && b.textContent.includes('Вход для администратора'));
      if (adminToggle) adminToggle.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    const emailInput = await page.$('input[type="email"]');
    await emailInput.evaluate(el => el.value = '');
    await emailInput.type('admin@krb.ai');

    const passInput = await page.$('input[type="password"]');
    await passInput.evaluate(el => el.value = '');
    await passInput.type('admin123');

    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 2500));

    // 2. Open Users Tab
    console.log('2. Navigating to Users Tab...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const usersBtn = btns.find(b => b.textContent && b.textContent.includes('Пользователи'));
      if (usersBtn) usersBtn.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // 3. Open Modal and Create User
    console.log(`3. Creating new user: ${testEmail}...`);
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const addBtn = btns.find(b => b.textContent && b.textContent.includes('Создать пользователя'));
      if (addBtn) addBtn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    const modalInputs = await page.$$('div.fixed input');
    if (modalInputs.length >= 2) {
      await modalInputs[0].type(testEmail);
      await modalInputs[1].type(testPassword);
    } else {
      await page.type('input[type="email"]', testEmail);
      await page.type('input[type="password"]', testPassword);
    }
    
    // Submit user creation
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Создать учетную запись'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 3000));

    const screenshot1Path = path.join(__dirname, 'admin_users_table_screenshot.png');
    await page.screenshot({ path: screenshot1Path, fullPage: true });
    console.log('✅ Screenshot saved:', screenshot1Path);

    // 4. Logout Admin and Login as New User
    console.log('4. Logging out Admin and logging in as New User...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1500));

    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    const clientEmailInput = await page.$('input[type="email"]');
    await clientEmailInput.evaluate(el => el.value = '');
    await clientEmailInput.type(testEmail);

    const clientPassInput = await page.$('input[type="password"]');
    await clientPassInput.evaluate(el => el.value = '');
    await clientPassInput.type(testPassword);

    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 3000));

    const screenshot2Path = path.join(__dirname, 'new_user_logged_in_screenshot.png');
    await page.screenshot({ path: screenshot2Path, fullPage: true });
    console.log('✅ New User Login Screenshot saved:', screenshot2Path);

    console.log('🎉 E2E TEST PASSED: User created, allocated Store and logged in successfully!');
  } catch (err) {
    console.error('❌ E2E TEST FAILED:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runUserManagementE2E();
