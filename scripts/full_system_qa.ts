import http from 'http';

async function request(options: http.RequestOptions, postData?: string): Promise<{ statusCode?: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runFullQA() {
  console.log('==================================================');
  console.log('  AUTOMATED FULL SYSTEM REGRESSION QA SUITE');
  console.log('==================================================');
  
  let passed = 0;
  let failed = 0;

  // 1. Root page health check
  try {
    const rootRes = await request({ hostname: 'localhost', port: 3000, path: '/', method: 'GET' });
    if (rootRes.statusCode === 200) {
      console.log('✅ [PASS] GET / (Root Web Server Health Check - 200 OK)');
      passed++;
    } else {
      console.error(`❌ [FAIL] GET / returned status ${rootRes.statusCode}`);
      failed++;
    }
  } catch (e: any) {
    console.error(`❌ [FAIL] GET / failed: ${e.message}`);
    failed++;
  }

  // 2. Demo Page health check
  try {
    const demoRes = await request({ hostname: 'localhost', port: 3000, path: '/design-system-demo', method: 'GET' });
    if (demoRes.statusCode === 200) {
      console.log('✅ [PASS] GET /design-system-demo (Design System Demo Page - 200 OK)');
      passed++;
    } else {
      console.error(`❌ [FAIL] GET /design-system-demo returned status ${demoRes.statusCode}`);
      failed++;
    }
  } catch (e: any) {
    console.error(`❌ [FAIL] GET /design-system-demo failed: ${e.message}`);
    failed++;
  }

  // 3. Client Login check
  let clientToken = '';
  try {
    const loginRes = await request(
      { hostname: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      JSON.stringify({ email: 'client@krb.ai', password: 'client123' })
    );
    if (loginRes.statusCode === 200) {
      const data = JSON.parse(loginRes.body);
      clientToken = data.token;
      console.log('✅ [PASS] POST /api/auth/login (Client Authentication - 200 OK)');
      passed++;
    } else {
      console.error(`❌ [FAIL] Client Login failed: ${loginRes.statusCode}`);
      failed++;
    }
  } catch (e: any) {
    console.error(`❌ [FAIL] Client login error: ${e.message}`);
    failed++;
  }

  // 4. Client Files API check
  if (clientToken) {
    try {
      const filesRes = await request({
        hostname: 'localhost', port: 3000, path: '/api/files', method: 'GET',
        headers: { Authorization: `Bearer ${clientToken}` }
      });
      if (filesRes.statusCode === 200) {
        console.log('✅ [PASS] GET /api/files (RAG Business Library List - 200 OK)');
        passed++;
      } else {
        console.error(`❌ [FAIL] GET /api/files returned ${filesRes.statusCode}`);
        failed++;
      }
    } catch (e: any) {
      console.error(`❌ [FAIL] Files API error: ${e.message}`);
      failed++;
    }
  }

  // 5. Client Bots API check
  if (clientToken) {
    try {
      const botsRes = await request({
        hostname: 'localhost', port: 3000, path: '/api/bots', method: 'GET',
        headers: { Authorization: `Bearer ${clientToken}` }
      });
      if (botsRes.statusCode === 200) {
        console.log('✅ [PASS] GET /api/bots (Bot Assistants List - 200 OK)');
        passed++;
      } else {
        console.error(`❌ [FAIL] GET /api/bots returned ${botsRes.statusCode}`);
        failed++;
      }
    } catch (e: any) {
      console.error(`❌ [FAIL] Bots API error: ${e.message}`);
      failed++;
    }
  }

  console.log('==================================================');
  console.log(`  QA SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================');
  if (failed > 0) process.exit(1);
}

runFullQA();
