import fs from 'node:fs';
import ExcelJS from 'exceljs';

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
console.log('launch.ps1 in dist   :', fs.existsSync('dist/launch.ps1'));
console.log('Start cmd in dist    :', fs.existsSync('dist/Start ACC Suite.cmd'));

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
