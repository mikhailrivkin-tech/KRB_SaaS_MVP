const { execSync } = require('child_process');
const path = require('path');

try {
  console.log('Building Vite client bundle...');
  const clientDir = path.join(__dirname, '../client');
  execSync('npx vite build', { cwd: clientDir, stdio: 'inherit' });
  console.log('Build completed successfully!');
} catch (err) {
  console.error('Build failed:', err.message);
  process.exit(1);
}
