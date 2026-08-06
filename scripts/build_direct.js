const path = require('path');
const fs = require('fs');

const clientDir = path.join(__dirname, '../client');
const esbuildPath = path.join(clientDir, 'node_modules/esbuild');
const esbuild = require(esbuildPath);

async function buildDirect() {
  console.log('Building client/src/App.tsx directly into client/dist/assets...');
  
  const clientDir = path.join(__dirname, '../client');
  const distDir = path.join(clientDir, 'dist');
  const assetsDir = path.join(distDir, 'assets');

  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  // Find index-xxx.js in assetsDir
  const files = fs.readdirSync(assetsDir);
  const targetJs = files.find(f => f.startsWith('index-') && f.endsWith('.js')) || 'index-B41Jwj3E.js';
  const targetJsPath = path.join(assetsDir, targetJs);

  console.log('Targeting JS bundle:', targetJsPath);

  await esbuild.build({
    entryPoints: [path.join(clientDir, 'src/main.tsx')],
    bundle: true,
    minify: false,
    sourcemap: false,
    outfile: targetJsPath,
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.svg': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' }
  });

  console.log('Successfully compiled App.tsx into:', targetJsPath);
}

buildDirect().catch(err => {
  console.error('Direct build failed:', err);
  process.exit(1);
});
