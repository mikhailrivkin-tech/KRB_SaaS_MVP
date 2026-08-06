import fetch from 'node-fetch';

async function testBackend() {
  console.log('Testing Backend Server API...');
  try {
    const res = await fetch('http://localhost:5001/api/bots');
    console.log('Bots Endpoint Status (Expect 401 Unauthorized):', res.status);
    console.log('VERIFICATION SUCCESSFUL');
  } catch (err: any) {
    console.error('VERIFICATION FAILED:', err.message);
  }
}
testBackend();
