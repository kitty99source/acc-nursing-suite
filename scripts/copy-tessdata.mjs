import fs from 'node:fs';
import path from 'node:path';

const dest = path.join('public', 'eng.traineddata');
const url = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/eng.traineddata';

if (fs.existsSync(dest)) {
  console.log('eng.traineddata already present');
  process.exit(0);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
console.log('Downloading eng.traineddata for offline OCR…');
const res = await fetch(url);
if (!res.ok) {
  console.error('Failed to download eng.traineddata:', res.status, res.statusText);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(dest, buf);
console.log('Saved', dest, `(${Math.round(buf.length / 1024 / 1024)} MB)`);
