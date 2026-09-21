import { readFileSync } from 'node:fs';

const src = readFileSync('main.js', 'utf8');
if (/\bimport\.meta\b/.test(src)) {
  console.error('check-bundle: import.meta가 번들에 남아 있음 (esbuild define 확인)');
  process.exit(1);
}
console.log(`check-bundle: OK (${(src.length / 1024 / 1024).toFixed(1)} MB)`);
