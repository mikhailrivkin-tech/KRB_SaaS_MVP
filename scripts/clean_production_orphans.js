const API = 'https://krb-saas-mvp.onrender.com';

async function cleanProductionOrphans() {
  console.log('1. Logging in as Admin on production...');
  const loginRes = await fetch(`${API}/api/auth/admin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@krb.ai', password: 'admin123' })
  });
  
  const loginData = await loginRes.json();
  if (!loginData.token) {
    throw new Error(`Admin login failed: ${JSON.stringify(loginData)}`);
  }
  const token = loginData.token;
  console.log('✅ Admin login successful.');

  console.log('2. Fetching current RAG Stats...');
  const statsBeforeRes = await fetch(`${API}/api/admin/rag-stats`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const statsBefore = await statsBeforeRes.json();
  console.log('Stats before cleanup:', JSON.stringify(statsBefore, null, 2));

  console.log('3. Triggering Garbage Collector endpoint /api/admin/clean-orphaned-stores...');
  const cleanRes = await fetch(`${API}/api/admin/clean-orphaned-stores`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  const cleanResult = await cleanRes.json();
  console.log('Clean result:', JSON.stringify(cleanResult, null, 2));

  console.log('4. Fetching updated RAG Stats...');
  const statsAfterRes = await fetch(`${API}/api/admin/rag-stats`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const statsAfter = await statsAfterRes.json();
  console.log('Stats after cleanup:', JSON.stringify(statsAfter, null, 2));
}

cleanProductionOrphans().catch(e => console.error('Error during production cleanup:', e.message));
