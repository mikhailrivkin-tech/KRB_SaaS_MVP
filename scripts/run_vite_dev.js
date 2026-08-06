const { spawn } = require('child_process');
const path = require('path');

const clientDir = path.join(__dirname, '../client');
console.log('Starting fresh Vite Dev Server on port 5173...');

const viteProcess = spawn('npx', ['vite', '--port', '5173', '--host'], {
  cwd: clientDir,
  stdio: 'inherit',
  shell: true
});

viteProcess.on('error', (err) => {
  console.error('Vite Dev Server Error:', err);
});
