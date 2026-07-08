#!/usr/bin/env node
/** Copy Tesseract OCR worker assets beside index.html (same pattern as pdf.worker.mjs). */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const pairs = [
  ['tesseract.js/dist/worker.min.js', 'tesseract.worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd.wasm.js', 'tesseract-core-simd.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd.wasm', 'tesseract-core-simd.wasm'],
];

const publicDir = path.join('public');
fs.mkdirSync(publicDir, { recursive: true });

for (const [pkgPath, destName] of pairs) {
  const src = require.resolve(pkgPath);
  const dest = path.join(publicDir, destName);
  fs.copyFileSync(src, dest);
  console.log(`Copied ${destName} -> public/`);
}
