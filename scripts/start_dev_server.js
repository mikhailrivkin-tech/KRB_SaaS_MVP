const { spawn } = require('child_process');
const path = require('path');

const clientDir = path.join(__dirname, '../client');
console.log('Starting Vite Dev Server in:', clientDir);

const viteProcess = spawn('npx', ['vite', '--port', '5173', '--host'], {
  cwd: clientDir,
  stdio: 'inherit',
  shell: true
});

viteProcess.on('error', (err) => {
  console.error('Failed to start Vite Dev Server:', err);
});
