import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
const dest = path.join('public', 'pdf.worker.mjs');

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log('Copied pdf.worker.mjs → public/');
