import fs from 'node:fs';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';
import ExcelJS from 'exceljs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.traineddata': 'application/octet-stream',
};

async function assertWorkerServedOverHttp() {
  const dist = join(process.cwd(), 'dist');
  const server = createServer((req, res) => {
    const path = req.url === '/' || !req.url ? '/index.html' : req.url.split('?')[0];
    const file = join(dist, path.replace(/^\//, ''));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const body = fs.readFileSync(file);
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/pdf.worker.mjs`);
    if (!res.ok) {
      console.error(`FAIL: GET /pdf.worker.mjs returned ${res.status}`);
      process.exitCode = 1;
      return;
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('javascript')) {
      console.error(`FAIL: pdf.worker.mjs Content-Type is "${ct}" (expected application/javascript)`);
      process.exitCode = 1;
      return;
    }
    const body = await res.arrayBuffer();
    if (body.byteLength < 100_000) {
      console.error(`FAIL: pdf.worker.mjs too small (${body.byteLength} bytes)`);
      process.exitCode = 1;
      return;
    }
    console.log('pdf worker HTTP OK     :', res.status, ct.split(';')[0]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const html = fs.readFileSync('dist/index.html', 'utf8');
const head = html.slice(0, html.indexOf('</head>'));

console.log('--- Single-file build checks ---');
console.log('CSP connect-src none :', head.includes("connect-src 'none'"));
console.log('CSP default-src self :', head.includes("default-src 'self'"));
console.log('inline <script> tags :', (html.match(/<script\b[^>]*>/g) || []).length);
console.log('external script src  :', /<script[^>]+src=["']https?:/.test(html));
console.log('external link href   :', /<link[^>]+href=["']https?:/.test(html));
console.log('inline <style> tags  :', (html.match(/<style\b/g) || []).length);
console.log('size KB              :', Math.round(html.length / 1024));
console.log('tessdata in dist     :', fs.existsSync('dist/eng.traineddata'));
console.log('pdf worker in dist   :', fs.existsSync('dist/pdf.worker.mjs'));
console.log('tesseract worker     :', fs.existsSync('dist/tesseract.worker.min.js'));
console.log('tesseract core wasm  :', fs.existsSync('dist/tesseract-core-simd.wasm.js'));
if (!fs.existsSync('dist/pdf.worker.mjs')) {
  console.error('FAIL: dist/pdf.worker.mjs missing — letter import will break');
  process.exitCode = 1;
} else {
  await assertWorkerServedOverHttp();
}
if (!fs.existsSync('dist/tesseract.worker.min.js') || !fs.existsSync('dist/tesseract-core-simd.wasm.js')) {
  console.error('FAIL: dist/ tesseract OCR assets missing — scanned PDF import will break');
  process.exitCode = 1;
}
console.log('letter import class  :', html.includes('btn btn-outline btn-sm'));
console.log('LETTER_IMPORT label  :', html.includes('Import ACC letter'));
console.log('letter accept docx   :', html.includes('.docx'));
if (!html.includes('Import ACC letter (PDF or Word)')) {
  console.warn('WARN: expected Import ACC letter (PDF or Word) label in bundle');
}
if (!html.includes('.docx')) {
  console.error('FAIL: bundle missing .docx in letter import accept — file picker may block Word letters');
  process.exitCode = 1;
}
const launcherRequired = [
  'bootstrap-log.ps1',
  'launch.ps1',
  'launcher-log.ps1',
  'portal-discover.ps1',
  'folder-watch.ps1',
  'outlook-probe.ps1',
  'outlook-sync.ps1',
  'outlook-diagnose.ps1',
  'Start ACC Suite.cmd',
  'Start Portal Discover.cmd',
  'Start Folder Watch.cmd',
  'Start ACC-Inbox Folder.cmd',
  'inbox-config.ps1',
  'open-inbox-folder.ps1',
  'Start Email Probe.cmd',
  'Start Email Sync.cmd',
  'Start Email Diagnose.cmd',
  'Start WFH Mode.cmd',
  'wfh-mode.ps1',
  'TROUBLESHOOT.txt',
];
console.log('\n--- Launcher files in dist ---');
for (const name of launcherRequired) {
  const ok = fs.existsSync(`dist/${name}`);
  console.log(`${name.padEnd(28)} :`, ok);
  if (!ok) process.exitCode = 1;
}

// Validate the Excel export round-trips (proves the workbook is structurally valid).
const wb = new ExcelJS.Workbook();
// Minimal data to exercise the export through the app's module would require a browser env,
// so here we just confirm ExcelJS can author + re-read a workbook with the same shape.
const ws = wb.addWorksheet('Billing Log');
ws.addRow(['Patient Name', 'Status']);
ws.addRow(['Test', 'Awaiting Billing']);
ws.getCell('B2').dataValidation = {
  type: 'list',
  allowBlank: true,
  formulae: ['"Awaiting Billing,Billed,Remittance"'],
};
ws.addConditionalFormatting({
  ref: 'A2:B2',
  rules: [
    {
      type: 'expression',
      formulae: ['$B2="Awaiting Billing"'],
      priority: 1,
      style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF4A39B' } } },
    },
  ],
});
const buf = await wb.xlsx.writeBuffer();
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.load(buf);
console.log('\n--- ExcelJS round-trip ---');
console.log('worksheets re-read   :', wb2.worksheets.map((w) => w.name).join(', '));
console.log('OK');
