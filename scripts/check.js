'use strict';
// Syntax-checks every JavaScript file (including the window's), without starting Electron.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(path.join(__dirname, '..', 'src'));

for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`Syntax OK: ${files.length} files`);
