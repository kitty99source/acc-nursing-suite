import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { AppData, ApprovalServiceCode, Claim, DocumentKind, Patient } from '../types';
import { SERVICE_CODES } from './serviceCodes';

// pdf.js v6 requires an explicit worker (disableWorker was removed in v6).
// Worker is copied to public/pdf.worker.mjs → dist/ beside index.html so the
// single-file build can load it from a stable relative URL (no dynamic import).
let pdfWorkerReady = false;
async function ensurePdfWorker(): Promise<void> {
  if (pdfWorkerReady || pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfWorkerReady = true;
    return;
  }
  if (typeof window !== 'undefined') {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', window.location.href).href;
  } else {
    const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  pdfWorkerReady = true;
}

// Offline PDF text extraction + ACC letter parsing (NUR02 approval, NUR04VEN decline).
// pdf.js handles text-layer PDFs; Tesseract is loaded lazily only when a page has no text.

const MIN_CHARS_PER_PAGE = 40;

export type LetterKind = 'approval' | 'decline' | 'unknown';

export interface ParsedServiceRow {
  serviceCode: ApprovalServiceCode;
  approvalStartDate: string;
  approvalEndDate: string;
  approvedHoursOrConsults: number;
  /** Set during commit: latest NS04/NS05 row on the letter becomes current. */
  recordStatus?: 'current' | 'historical';
}

export interface ParsedPackageRow {
  serviceCode: string;
  approvalStartDate: string;
  approvalEndDate: string;
  quantity: number;
}

export interface ParsedPatientFields {
  name?: string;
  nhi?: string;
  dob?: string;
}

export interface ParsedClaimFields {
  claimNumber?: string;
  acc45Number?: string;
  poNumber?: string;
  dateOfInjury?: string;
  injuryDescription?: string;
}

export interface ParsedApprovalLetter {
  kind: 'approval';
  letterDate?: string;
  formCode?: string;
  patient: ParsedPatientFields;
  claim: ParsedClaimFields;
  serviceRows: ParsedServiceRow[];
  packageRows: ParsedPackageRow[];
  rawText: string;
}

export interface ParsedDeclineLetter {
  kind: 'decline';
  letterDate?: string;
  formCode?: string;
  patient: ParsedPatientFields;
  claim: ParsedClaimFields;
  /** Alternate claim numbers found in body (lowers confidence). */
  alternateClaimNumbers: string[];
  serviceRequested?: string;
  reason?: string;
  rawText: string;
}

export type ParsedLetter = ParsedApprovalLetter | ParsedDeclineLetter;

export interface FieldConfidence {
  field: string;
  value: string;
  confidence: number;
  note?: string;
}

export interface LetterMatch {
  patientId?: string;
  claimId?: string;
  patient?: Patient;
  claim?: Claim;
  ambiguous: boolean;
  notes: string[];
}

export interface LetterParseResult {
  kind: LetterKind;
  parsed: ParsedLetter | null;
  text: string;
  usedOcr: boolean;
  fieldConfidences: FieldConfidence[];
  overallConfidence: number;
  autoCommit: boolean;
  blockers: string[];
  match: LetterMatch;
  /** Actionable discrepancies — each maps to a form field you can fix before saving. */
  issues: LetterIssue[];
}

/** Form field a letter issue points at (confirm modal). */
export type LetterFormField =
  | 'patientName'
  | 'nhi'
  | 'dob'
  | 'claimNumber'
  | 'acc45'
  | 'poNumber'
  | 'injury'
  | 'day1'
  | 'declineReason'
  | 'linkPatient'
  | 'linkClaim'
  | 'serviceRows';

export interface LetterIssue {
  id: string;
  field: LetterFormField;
  message: string;
  /** Values seen in the letter — click to apply without re-uploading the PDF. */
  alternatives?: string[];
  /** When false, issue is advisory only and does not gate Save. Default: true for missing data. */
  blocking?: boolean;
}

/** Build editable issue list from parse output. */
export function buildLetterIssues(
  parsed: ParsedLetter,
  match: LetterMatch,
  blockers: string[],
): LetterIssue[] {
  const issues: LetterIssue[] = [];

  if (parsed.kind === 'approval') {
    const bodyNames = allMatches(parsed.rawText, /for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g);
    const headerName = parsed.patient.name?.trim();
    const conflicting = bodyNames.filter(
      (n) => n !== headerName && !(headerName && headerName.includes(n.split(' ')[0])),
    );
    if (headerName && conflicting.length) {
      const matched = !!(match.claimId && match.patientId && !match.ambiguous);
      issues.push({
        id: 'name-mismatch',
        field: 'patientName',
        message: matched
          ? 'Letter body name differs — using stored patient name (review if needed).'
          : 'Client details and letter body use different names.',
        alternatives: matched && match.patient?.name
          ? [match.patient.name, headerName, ...conflicting]
          : [headerName, ...conflicting],
        blocking: !matched,
      });
    }
    if (parsed.serviceRows.length === 0) {
      issues.push({
        id: 'no-service-rows',
        field: 'serviceRows',
        message: 'No NS04/NS05 rows were found — check dates and quantities below or remove bad rows.',
      });
    }
  }

  if (parsed.kind === 'decline') {
    const bodyNames = allMatches(parsed.rawText, /for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g);
    const headerName = parsed.patient.name?.trim();
    const conflicting = bodyNames.filter(
      (n) => n !== headerName && !(headerName && headerName.includes(n.split(' ')[0])),
    );
    if (headerName && conflicting.length) {
      const matched = !!(match.claimId && match.patientId && !match.ambiguous);
      issues.push({
        id: 'name-mismatch',
        field: 'patientName',
        message: matched
          ? 'Letter body name differs — using stored patient name (review if needed).'
          : 'Client details and letter body use different names.',
        alternatives: matched && match.patient?.name
          ? [match.patient.name, headerName, ...conflicting]
          : [headerName, ...conflicting],
        blocking: !matched,
      });
    }
    if (parsed.alternateClaimNumbers.length) {
      const primary = parsed.claim.claimNumber;
      const alts = primary
        ? [primary, ...parsed.alternateClaimNumbers.filter((c) => c !== primary)]
        : parsed.alternateClaimNumbers;
      issues.push({
        id: 'claim-numbers',
        field: 'claimNumber',
        message: 'More than one claim number appears in this letter.',
        alternatives: [...new Set(alts)],
      });
    }
    if (!parsed.reason?.trim()) {
      issues.push({
        id: 'no-decline-reason',
        field: 'declineReason',
        message: 'Decline reason was not extracted — type it below.',
      });
    }
  }

  if (!parsed.claim.claimNumber?.trim()) {
    issues.push({ id: 'missing-claim', field: 'claimNumber', message: 'Claim number is missing.' });
  }
  if (!parsed.claim.poNumber?.trim() && parsed.kind === 'approval') {
    issues.push({ id: 'missing-po', field: 'poNumber', message: 'PO number is missing.' });
  }
  if (!parsed.patient.nhi?.trim()) {
    issues.push({
      id: 'missing-nhi',
      field: 'nhi',
      message: 'NHI is missing.',
      blocking: parsed.kind !== 'decline',
    });
  }

  if (match.ambiguous) {
    for (const note of match.notes) {
      issues.push({ id: `ambiguous-${note}`, field: 'linkPatient', message: note });
    }
  }
  if (!match.claimId && !match.patientId) {
    const declineCreateReady =
      parsed.kind === 'decline' &&
      !!parsed.patient.name?.trim() &&
      !!parsed.claim.claimNumber?.trim();
    const approvalNeedsNhi = parsed.kind === 'approval' && !!parsed.patient.nhi?.trim();
    if (declineCreateReady || approvalNeedsNhi) {
      issues.push({
        id: 'no-match',
        field: 'linkClaim',
        message: 'No existing patient/claim matched — will create new records unless you link below.',
        blocking: false,
      });
    }
  }

  // Surface any blocker not already covered.
  for (const b of blockers) {
    if (issues.some((i) => i.message === b || b.includes(i.message.slice(0, 20)))) continue;
    if (b.startsWith('Missing ') || b.startsWith('No matching') || b.startsWith('Client name')) continue;
    issues.push({ id: `blocker-${b}`, field: 'patientName', message: b });
  }

  return issues;
}

export interface LetterImportContext {
  patientId?: string;
  claimId?: string;
}

export type LetterImportStage =
  | 'open'
  | 'extract-page'
  | 'extract-done'
  | 'check-text'
  | 'ocr-init'
  | 'ocr-page'
  | 'parse'
  | 'match'
  | 'done';

export interface LetterImportProgress {
  stage: LetterImportStage;
  message: string;
  /** 0–100 */
  progress: number;
  page?: number;
  totalPages?: number;
  extractPreview?: string;
  usedOcr?: boolean;
}

export type LetterImportProgressHandler = (progress: LetterImportProgress) => void;

function previewText(text: string, max = 480): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  if (flat.length <= max) return flat;
  return `…${flat.slice(-max)}`;
}

function report(onProgress: LetterImportProgressHandler | undefined, progress: LetterImportProgress) {
  onProgress?.(progress);
}

// ----------------------------------------------------------------------------
// Text extraction
// ----------------------------------------------------------------------------

// Worker runs in browser; Node/vitest loads the worker module from disk automatically.
const PDF_OPTS = { useSystemFonts: true };

async function toArrayBuffer(input: Blob | ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) return input;
  if (input instanceof Uint8Array) {
    const copy = new Uint8Array(input.byteLength);
    copy.set(input);
    return copy.buffer;
  }
  if (typeof input.arrayBuffer === 'function') return input.arrayBuffer();
  if (typeof (input as Blob & { bytes?: () => Promise<Uint8Array> }).bytes === 'function') {
    const b = await (input as Blob & { bytes: () => Promise<Uint8Array> }).bytes();
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  if (typeof input.stream === 'function') {
    const reader = input.stream().getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer;
  }
  return new Response(input).arrayBuffer();
}

async function toPdfData(input: Blob | ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  return toArrayBuffer(input);
}

export async function extractPdfText(
  input: Blob | ArrayBuffer | Uint8Array,
  onProgress?: LetterImportProgressHandler,
): Promise<string> {
  await ensurePdfWorker();
  report(onProgress, { stage: 'open', message: 'Opening PDF…', progress: 5, extractPreview: '' });
  const data = await toPdfData(input);
  const doc = await pdfjs.getDocument({ data, ...PDF_OPTS }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    parts.push(pageText);
    const accumulated = parts.join('\n\n');
    report(onProgress, {
      stage: 'extract-page',
      message: `Reading page ${p} of ${doc.numPages}…`,
      progress: 5 + Math.round((p / doc.numPages) * 50),
      page: p,
      totalPages: doc.numPages,
      extractPreview: previewText(accumulated),
    });
  }
  return parts.join('\n\n');
}

async function toWordBuffer(input: Blob | ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  return toArrayBuffer(input);
}

/** Extract plain text from .docx (P8-020). Legacy .doc not supported — convert to .docx first. */
export async function extractWordText(
  input: Blob | ArrayBuffer | Uint8Array,
  onProgress?: LetterImportProgressHandler,
): Promise<string> {
  report(onProgress, { stage: 'open', message: 'Opening Word document…', progress: 5, extractPreview: '' });
  const buffer = await toWordBuffer(input);
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer });
  const text = value.replace(/\r\n/g, '\n').trim();
  report(onProgress, {
    stage: 'extract-done',
    message: 'Word text extracted',
    progress: 60,
    extractPreview: previewText(text),
  });
  return text;
}

async function ocrPdfPages(
  input: Blob | ArrayBuffer | Uint8Array,
  onProgress?: LetterImportProgressHandler,
): Promise<string> {
  report(onProgress, { stage: 'ocr-init', message: 'Loading OCR engine (scanned PDF)…', progress: 58, usedOcr: true });
  const { createWorker } = await import('tesseract.js');
  const data = await toPdfData(input);
  const doc = await pdfjs.getDocument({ data, ...PDF_OPTS }).promise;
  const worker = await createWorker('eng', 1, {
    workerPath: new URL('tesseract.js/dist/worker.min.js', import.meta.url).toString(),
    corePath: new URL('tesseract.js-core/tesseract-core-simd.wasm.js', import.meta.url).toString(),
    langPath: typeof window !== 'undefined' ? new URL('.', window.location.href).href : '/',
    gzip: false,
  });
  const parts: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      report(onProgress, {
        stage: 'ocr-page',
        message: `OCR page ${p} of ${doc.numPages}…`,
        progress: 58 + Math.round((p / doc.numPages) * 32),
        page: p,
        totalPages: doc.numPages,
        usedOcr: true,
        extractPreview: previewText(parts.join('\n\n')),
      });
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const { data: ocr } = await worker.recognize(canvas);
      parts.push(ocr.text.trim());
      report(onProgress, {
        stage: 'ocr-page',
        message: `OCR page ${p} of ${doc.numPages}…`,
        progress: 58 + Math.round((p / doc.numPages) * 32),
        page: p,
        totalPages: doc.numPages,
        usedOcr: true,
        extractPreview: previewText(parts.join('\n\n')),
      });
    }
  } finally {
    await worker.terminate();
  }
  return parts.join('\n\n');
}

/** True for .docx (Office Open XML). Legacy .doc is not supported — save as .docx first. */
export function isWordDocument(file: Blob & { name?: string }): boolean {
  const name = (file instanceof File ? file.name : file.name ?? '').toLowerCase();
  return (
    name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

export function isPdfDocument(file: Blob & { name?: string }): boolean {
  const name = (file instanceof File ? file.name : file.name ?? '').toLowerCase();
  return file.type === 'application/pdf' || name.endsWith('.pdf');
}

export async function extractLetterText(
  input: Blob | ArrayBuffer | Uint8Array,
  onProgress?: LetterImportProgressHandler,
): Promise<{ text: string; usedOcr: boolean }> {
  let text = await extractPdfText(input, onProgress);
  const pages = text.split(/\n\n+/).filter(Boolean);
  const sparse =
    pages.length === 0 ||
    pages.every((p) => p.replace(/\s/g, '').length < MIN_CHARS_PER_PAGE);
  report(onProgress, {
    stage: 'check-text',
    message: sparse ? 'Text layer sparse — switching to OCR…' : 'Text layer OK',
    progress: sparse ? 56 : 60,
    extractPreview: previewText(text),
    usedOcr: sparse,
  });
  if (sparse && typeof document !== 'undefined') {
    text = await ocrPdfPages(input, onProgress);
    return { text, usedOcr: true };
  }
  return { text, usedOcr: false };
}

// ----------------------------------------------------------------------------
// Normalization helpers
// ----------------------------------------------------------------------------

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, '').trim();
}

export function normalizeClaimNumber(raw?: string): string {
  if (!raw) return '';
  return collapseSpaces(raw);
}

export function normalizeNhi(raw?: string): string {
  if (!raw) return '';
  return collapseSpaces(raw).toUpperCase();
}

function normalizePo(raw?: string): string {
  if (!raw) return '';
  return collapseSpaces(raw);
}

function normalizeAcc45(raw?: string): string {
  if (!raw) return '';
  return collapseSpaces(raw).toUpperCase();
}

const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

/** Parse DD/MM/YYYY or "18 June 2026" → ISO date. */
export function parseAccDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const verbal = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (verbal) {
    const [, d, mon, y] = verbal;
    const m = MONTHS[mon.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, '0')}`;
  }
  return undefined;
}

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m?.[1]?.trim();
}

function allMatches(text: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = g.exec(text)) !== null) {
    if (m[1]) out.push(m[1].trim());
  }
  return out;
}

const CLIENT_NAME_BOUNDARIES = [
  'Postal address',
  'Phone number',
  'Date of birth',
  'NHI number',
  'ACC45 number',
  'Date of injury',
  'Injury(s)',
];

const SERVICE_REQUEST_BOUNDARIES = [
  'After careful consideration',
  "Why we can't approve",
  'Why we can\u2019t approve',
  "We're unable",
  'We\u2019re unable',
];

const KNOWN_SERVICE_NAMES = Object.values(SERVICE_CODES)
  .map((s) => s.name)
  .sort((a, b) => b.length - a.length);

/** Stop client name at the next ACC header field (pdf.js often flattens to one line). */
function trimClientName(raw: string): string {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  let earliest = normalized.length;
  for (const marker of CLIENT_NAME_BOUNDARIES) {
    const re = new RegExp(`\\s+${marker.replace(/[()]/g, '\\$&')}\\b`, 'i');
    const m = re.exec(normalized);
    if (m && m.index < earliest) earliest = m.index;
  }
  return earliest < normalized.length ? normalized.slice(0, earliest).trim() : normalized;
}

/** Extract service title from flattened decline text using known codes or boilerplate boundaries. */
function trimServiceRequested(raw: string): string {
  const text = raw.replace(/^•\s*/, '').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  for (const name of KNOWN_SERVICE_NAMES) {
    const idx = lower.indexOf(name.toLowerCase());
    if (idx >= 0) return name;
  }
  let earliest = text.length;
  for (const marker of SERVICE_REQUEST_BOUNDARIES) {
    const idx = text.search(new RegExp(marker.replace(/['']/g, "[''\u2019]"), 'i'));
    if (idx >= 0 && idx < earliest) earliest = idx;
  }
  return text.slice(0, earliest).trim();
}

// ----------------------------------------------------------------------------
// Classification & parsing
// ----------------------------------------------------------------------------

export function classifyLetter(text: string): LetterKind {
  const t = text.toUpperCase();
  if (t.includes('NUR02') || /APPROVAL FOR NURSING SERVICES/i.test(text)) return 'approval';
  if (t.includes('NUR04VEN') || /DECLINE OF NURSING SERVICES/i.test(text)) return 'decline';
  return 'unknown';
}

export function letterKindToDocumentKind(kind: LetterKind | 'approval' | 'decline' | undefined): DocumentKind {
  if (kind === 'approval') return 'acc-approval-letter';
  if (kind === 'decline') return 'acc-decline-letter';
  return 'other';
}

/** Quick filename heuristic before opening the PDF. */
export function sniffDocumentKindFromFileName(fileName: string): DocumentKind | null {
  const n = fileName.toLowerCase();
  if (/approv|nur02/.test(n)) return 'acc-approval-letter';
  if (/declin|nur04/.test(n)) return 'acc-decline-letter';
  return null;
}

export function normalizeFileNameForCompare(fileName: string): string {
  return fileName.trim().toLowerCase();
}

export async function hashBlob(blob: Blob): Promise<string> {
  const buf =
    typeof blob.arrayBuffer === 'function'
      ? await blob.arrayBuffer()
      : await new Response(blob).arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface DuplicateLetterImportOpts {
  parsedKind?: 'approval' | 'decline';
  letterDate?: string;
}

/** True only when the same claim already has this exact file (name + size + hash). */
export async function isDuplicateLetterImport(
  data: AppData,
  claimId: string,
  file: Blob,
  loadBlob: (docId: string) => Promise<Blob | undefined>,
  opts?: DuplicateLetterImportOpts,
): Promise<boolean> {
  const fileName = file instanceof File ? file.name : 'letter.pdf';
  const normName = normalizeFileNameForCompare(fileName);
  const fileHash = await hashBlob(file);

  const nameAndSizeMatches = data.documents.filter(
    (d) =>
      d.claimId === claimId &&
      normalizeFileNameForCompare(d.fileName) === normName &&
      d.sizeBytes === file.size,
  );

  for (const doc of nameAndSizeMatches) {
    const blob = await loadBlob(doc.id);
    if (blob && (await hashBlob(blob)) === fileHash) return true;
  }

  if (opts?.parsedKind && opts.letterDate) {
    const linkedDocIds =
      opts.parsedKind === 'decline'
        ? data.declines
            .filter((d) => d.claimId === claimId && d.declineReceivedDate === opts.letterDate && d.sourceDocumentId)
            .map((d) => d.sourceDocumentId!)
        : data.approvals
            .filter((a) => a.claimId === claimId && a.sourceDocumentId)
            .map((a) => a.sourceDocumentId!);

    for (const docId of linkedDocIds) {
      const blob = await loadBlob(docId);
      if (blob && (await hashBlob(blob)) === fileHash) return true;
    }
  }

  return false;
}

/** Sniff ACC letter type from filename or first-page PDF text when attaching manually. */
export async function inferDocumentKindForPdf(file: File, selectedKind?: DocumentKind): Promise<DocumentKind> {
  const sniffed = sniffDocumentKindFromFileName(file.name);
  if (sniffed) return sniffed;
  if (selectedKind && selectedKind !== 'other') return selectedKind;
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return selectedKind ?? 'other';
  try {
    const text = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
    return letterKindToDocumentKind(classifyLetter(text));
  } catch {
    return selectedKind ?? 'other';
  }
}

function parseServiceRows(text: string): { serviceRows: ParsedServiceRow[]; packageRows: ParsedPackageRow[] } {
  const serviceRows: ParsedServiceRow[] = [];
  const packageRows: ParsedPackageRow[] = [];
  // pdf.js often flattens table rows onto one line — match code, two dates, quantity.
  const re =
    /(NS0[1-5])\s+Nursing Services[^0-9]*(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+([\d.]+)\s+Units?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const code = m[1].toUpperCase();
    const start = parseAccDate(m[2]);
    const end = parseAccDate(m[3]);
    const qty = Math.round(parseFloat(m[4]));
    if (!start || !end || !Number.isFinite(qty)) continue;
    if (code === 'NS04' || code === 'NS05') {
      serviceRows.push({
        serviceCode: code,
        approvalStartDate: start,
        approvalEndDate: end,
        approvedHoursOrConsults: qty,
      });
    } else {
      packageRows.push({
        serviceCode: code,
        approvalStartDate: start,
        approvalEndDate: end,
        quantity: qty,
      });
    }
  }
  return { serviceRows, packageRows };
}

export function parseApprovalLetter(text: string): ParsedApprovalLetter {
  const claimNumberRaw = firstMatch(text, /Client.s claim number:\s*([\d\s]+)/i);
  const poNumber = normalizePo(
    firstMatch(text, /Purchase order number:\s*([\d\s]+?)(?=\s*\d{1,2}\s+[A-Za-z]+\s+\d{4})/i) ?? '',
  );
  const letterDate = parseAccDate(firstMatch(text, /(\d{1,2}\s+[A-Za-z]+\s+\d{4})/));
  const clientLine = text.match(/Client name:\s*([^\n]+?)\s+Date of injury:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  let name: string | undefined;
  let dateOfInjury: string | undefined;
  if (clientLine) {
    name = trimClientName(clientLine[1]);
    dateOfInjury = parseAccDate(clientLine[2]);
  }
  const dob = parseAccDate(firstMatch(text, /Date of birth:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i));
  const acc45 = normalizeAcc45(firstMatch(text, /ACC45 number:\s*([A-Z0-9\s]+?)\s+NHI/i));
  const nhi = normalizeNhi(firstMatch(text, /NHI number\s*:?\s*([A-Z0-9\s]+?)\s+Injury/i));
  const injury = firstMatch(text, /Injury\(s\):\s*(.+?)(?:Thank you|Services approved)/i);
  const { serviceRows, packageRows } = parseServiceRows(text);

  return {
    kind: 'approval',
    letterDate,
    formCode: firstMatch(text, /^(NUR\d+)/m),
    patient: { name, nhi, dob },
    claim: {
      claimNumber: normalizeClaimNumber(claimNumberRaw),
      acc45Number: acc45,
      poNumber: poNumber || undefined,
      dateOfInjury,
      injuryDescription: injury?.replace(/\s+/g, ' ').trim(),
    },
    serviceRows,
    packageRows,
    rawText: text,
  };
}

export function parseDeclineLetter(text: string): ParsedDeclineLetter {
  const headerClaim = normalizeClaimNumber(firstMatch(text, /Claim number\s+([\d\s]+)/i));
  const letterDate = parseAccDate(firstMatch(text, /(\d{1,2}\s+[A-Za-z]+\s+\d{4})/));
  const nameRaw =
    firstMatch(text, /Client name\s+(.+?)\s+Postal address/i) ??
    firstMatch(text, /Client name\s+([^\n]+)/i);
  const name = nameRaw ? trimClientName(nameRaw) : undefined;
  const nhi = normalizeNhi(firstMatch(text, /NHI number\s+([A-Z0-9\s]+?)\s+ACC45/i));
  const dob = parseAccDate(firstMatch(text, /Date of birth\s+(\d{1,2}\/\d{1,2}\/\d{4})/i));
  const acc45 = normalizeAcc45(firstMatch(text, /ACC45 number\s+([A-Z0-9\s]+?)\s+Date of injury/i));
  const dateOfInjury = parseAccDate(
    firstMatch(text, /Date of injury\s+(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4})/i)?.replace(/\s+/g, ''),
  );
  const injury = firstMatch(text, /Injury\(s\)\s+(.+?)(?:Thank you|You requested)/i);
  const serviceRaw = firstMatch(text, /requested the following service:\s*•\s*([^\n]+)/i);
  const serviceRequested = serviceRaw ? trimServiceRequested(serviceRaw) : undefined;
  const reasonBlock =
    text.match(/Why we can.t approve the request\s+(We.re unable[\s\S]+?)(?:We.re happy to answer|Please call)/i) ||
    text.match(/because there are ([^.]+)\./i);
  const reason = reasonBlock?.[1]?.replace(/\s+/g, ' ').trim();
  const allClaims = allMatches(text, /claim number\s*\(?([\d\s]+)\)?/gi).map(normalizeClaimNumber);
  const alternateClaimNumbers = [...new Set(allClaims.filter((c) => c && c !== headerClaim))];

  return {
    kind: 'decline',
    letterDate,
    formCode: firstMatch(text, /^(NUR\d+)/m),
    patient: { name, nhi, dob },
    claim: {
      claimNumber: headerClaim,
      acc45Number: acc45,
      dateOfInjury,
      injuryDescription: injury?.replace(/\s+/g, ' ').trim(),
    },
    alternateClaimNumbers,
    serviceRequested,
    reason,
    rawText: text,
  };
}

/** Mark the latest end-dated NS04/NS05 row as current; others historical. */
export function assignRecordStatus(rows: ParsedServiceRow[]): ParsedServiceRow[] {
  if (rows.length === 0) return rows;
  let latestIdx = 0;
  let latestEnd = rows[0].approvalEndDate;
  rows.forEach((r, i) => {
    if (r.approvalEndDate > latestEnd) {
      latestEnd = r.approvalEndDate;
      latestIdx = i;
    }
  });
  return rows.map((r, i) => ({
    ...r,
    recordStatus: i === latestIdx ? 'current' : 'historical',
  }));
}

// ----------------------------------------------------------------------------
// Matching & confidence
// ----------------------------------------------------------------------------

export function matchLetterToData(
  data: AppData,
  parsed: ParsedLetter,
  context?: LetterImportContext,
): LetterMatch {
  const notes: string[] = [];
  let patientId = context?.patientId;
  let claimId = context?.claimId;
  let patient: Patient | undefined;
  let claim: Claim | undefined;

  if (claimId) {
    claim = data.claims.find((c) => c.id === claimId);
    if (claim) patient = data.patients.find((p) => p.id === claim!.patientId);
  }

  const nhi = normalizeNhi(parsed.patient.nhi);
  const cn = normalizeClaimNumber(parsed.claim.claimNumber);

  if (!claim && cn) {
    const claims = data.claims.filter((c) => normalizeClaimNumber(c.claimNumber) === cn);
    if (claims.length === 1) {
      claim = claims[0];
      claimId = claim.id;
    } else if (claims.length > 1) notes.push('Multiple claims share this claim number.');
  }

  if (!patient && nhi) {
    const patients = data.patients.filter((p) => normalizeNhi(p.nhi) === nhi);
    if (patients.length === 1) {
      patient = patients[0];
      patientId = patient.id;
      if (!claim) {
        const pc = data.claims.filter((c) => c.patientId === patientId && (!cn || normalizeClaimNumber(c.claimNumber) === cn));
        if (pc.length === 1) {
          claim = pc[0];
          claimId = claim.id;
        }
      }
    } else if (patients.length > 1) notes.push('Multiple patients share this NHI.');
  }

  if (!claim && patientId && cn) {
    const pc = data.claims.find(
      (c) => c.patientId === patientId && normalizeClaimNumber(c.claimNumber) === cn,
    );
    if (pc) {
      claim = pc;
      claimId = pc.id;
    }
  }

  const ambiguous = notes.length > 0;
  return { patientId, claimId, patient, claim, ambiguous, notes };
}

function scoreApproval(parsed: ParsedApprovalLetter, match: LetterMatch): {
  fieldConfidences: FieldConfidence[];
  overallConfidence: number;
  blockers: string[];
} {
  const fieldConfidences: FieldConfidence[] = [];
  const blockers: string[] = [];

  const add = (field: string, value: string | undefined, conf: number, note?: string) => {
    fieldConfidences.push({ field, value: value ?? '', confidence: conf, note });
    if (!value) blockers.push(`Missing ${field}`);
  };

  add('claimNumber', parsed.claim.claimNumber, parsed.claim.claimNumber ? 100 : 0);
  add('poNumber', parsed.claim.poNumber, parsed.claim.poNumber ? 100 : 0);
  add('patientName', parsed.patient.name, parsed.patient.name ? 90 : 0);
  add('nhi', parsed.patient.nhi, parsed.patient.nhi ? 100 : 50);
  add('acc45Number', parsed.claim.acc45Number, parsed.claim.acc45Number ? 90 : 40);

  if (parsed.serviceRows.length === 0) blockers.push('No NS04/NS05 service rows found');
  else fieldConfidences.push({ field: 'serviceRows', value: String(parsed.serviceRows.length), confidence: 100 });

  // Name mismatch in letter body lowers confidence; not a blocker when patient+claim matched.
  const bodyNames = allMatches(parsed.rawText, /for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g);
  const nameMismatch =
    parsed.patient.name &&
    bodyNames.some((n) => n !== parsed.patient.name && !parsed.patient.name!.includes(n.split(' ')[0]));
  const matched = !!(match.claimId && match.patientId && !match.ambiguous);
  if (nameMismatch) {
    if (!matched) blockers.push('Client name differs in letter body');
    fieldConfidences.push({
      field: 'nameConsistency',
      value: 'mismatch',
      confidence: matched ? 85 : 40,
      note: matched ? 'Using stored patient name' : 'Name in body differs from client details',
    });
  }

  if (match.ambiguous) blockers.push(...match.notes);
  if (!match.claimId && !match.patientId && parsed.patient.nhi) blockers.push('No matching patient/claim in file (new record OK on confirm)');

  const overall = fieldConfidences.length
    ? Math.round(fieldConfidences.reduce((s, f) => s + f.confidence, 0) / fieldConfidences.length)
    : 0;
  if (blockers.some((b) => b.startsWith('Missing'))) {
    return { fieldConfidences, overallConfidence: Math.min(overall, 85), blockers };
  }
  return { fieldConfidences, overallConfidence: blockers.length ? Math.min(overall, 90) : overall, blockers };
}

function scoreDecline(parsed: ParsedDeclineLetter, match: LetterMatch): {
  fieldConfidences: FieldConfidence[];
  overallConfidence: number;
  blockers: string[];
} {
  const blockers: string[] = [];
  const fieldConfidences: FieldConfidence[] = [];

  fieldConfidences.push({
    field: 'claimNumber',
    value: parsed.claim.claimNumber ?? '',
    confidence: parsed.claim.claimNumber ? 100 : 0,
  });
  if (parsed.alternateClaimNumbers.length > 0) {
    fieldConfidences.push({ field: 'claimConsistency', value: parsed.alternateClaimNumbers.join(', '), confidence: 50 });
  }
  fieldConfidences.push({
    field: 'reason',
    value: parsed.reason ?? '',
    confidence: parsed.reason ? 95 : 30,
  });
  if (match.ambiguous) blockers.push(...match.notes);

  const bodyNames = allMatches(parsed.rawText, /for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g);
  const nameMismatch =
    parsed.patient.name &&
    bodyNames.some((n) => n !== parsed.patient.name && !parsed.patient.name!.includes(n.split(' ')[0]));
  const matched = !!(match.claimId && match.patientId && !match.ambiguous);
  if (nameMismatch) {
    fieldConfidences.push({
      field: 'nameConsistency',
      value: 'mismatch',
      confidence: matched ? 85 : 40,
      note: matched ? 'Using stored patient name' : 'Name in body differs from client details',
    });
  }

  const overall = Math.round(fieldConfidences.reduce((s, f) => s + f.confidence, 0) / fieldConfidences.length);
  return { fieldConfidences, overallConfidence: blockers.length ? Math.min(overall, 90) : overall, blockers };
}

/** Gate for silent auto-file — production mode always disables (P0-005). */
export function resolveLetterAutoCommit(
  settings: AppData['settings'],
  scored: { overallConfidence: number; blockers: string[] },
  match: { ambiguous: boolean; claimId?: string },
  parsed: ParsedLetter,
): boolean {
  const devAutoCommitAllowed =
    settings.productionMode === false && settings.letterImportAutoCommit === true;
  return (
    devAutoCommitAllowed &&
    scored.overallConfidence >= 100 &&
    scored.blockers.length === 0 &&
    !match.ambiguous &&
    parsed.kind === 'approval' &&
    parsed.serviceRows.length > 0 &&
    !!match.claimId
  );
}

export async function parseLetterFromText(
  text: string,
  data: AppData,
  context?: LetterImportContext,
  usedOcr = false,
  onProgress?: LetterImportProgressHandler,
): Promise<LetterParseResult> {
  report(onProgress, {
    stage: 'parse',
    message: 'Classifying letter type…',
    progress: 92,
    extractPreview: previewText(text),
    usedOcr,
  });
  const kind = classifyLetter(text);
  const emptyMatch: LetterMatch = { ambiguous: false, notes: [] };

  if (kind === 'unknown') {
    report(onProgress, { stage: 'done', message: 'Could not recognise letter format', progress: 100, extractPreview: previewText(text), usedOcr });
    return {
      kind,
      parsed: null,
      text,
      usedOcr,
      fieldConfidences: [],
      overallConfidence: 0,
      autoCommit: false,
      blockers: ['Unrecognised letter format'],
      match: emptyMatch,
      issues: [],
    };
  }

  report(onProgress, {
    stage: 'parse',
    message: kind === 'approval' ? 'Parsing NUR02 approval fields…' : 'Parsing NUR04VEN decline fields…',
    progress: 94,
    extractPreview: previewText(text),
    usedOcr,
  });

  const parsed: ParsedLetter =
    kind === 'approval' ? parseApprovalLetter(text) : parseDeclineLetter(text);

  if (parsed.kind === 'approval') {
    parsed.serviceRows = assignRecordStatus(parsed.serviceRows);
  }

  report(onProgress, { stage: 'match', message: 'Matching patient and claim…', progress: 97, extractPreview: previewText(text), usedOcr });
  const match = matchLetterToData(data, parsed, context);
  const scored =
    parsed.kind === 'approval' ? scoreApproval(parsed, match) : scoreDecline(parsed, match);

  const autoCommit = resolveLetterAutoCommit(data.settings, scored, match, parsed);

  report(onProgress, {
    stage: 'done',
    message: autoCommit ? 'Ready — auto-filing…' : `Parsed (${scored.overallConfidence}% confidence)`,
    progress: 100,
    extractPreview: previewText(text),
    usedOcr,
  });

  return {
    kind,
    parsed,
    text,
    usedOcr,
    ...scored,
    autoCommit,
    match,
    issues: buildLetterIssues(parsed, match, scored.blockers),
  };
}

export async function parseLetterFile(
  file: Blob,
  data: AppData,
  context?: LetterImportContext,
  onProgress?: LetterImportProgressHandler,
): Promise<LetterParseResult> {
  if (isWordDocument(file)) {
    const text = await extractWordText(file, onProgress);
    return parseLetterFromText(text, data, context, false, onProgress);
  }
  const { text, usedOcr } = await extractLetterText(file, onProgress);
  return parseLetterFromText(text, data, context, usedOcr, onProgress);
}

/** Patches for patient/claim forms — does not persist. */
export function prefillFromParsed(parsed: ParsedLetter): {
  patient: Partial<Pick<Patient, 'name' | 'nhi' | 'dob'>>;
  claim: Partial<Pick<Claim, 'claimNumber' | 'acc45Number' | 'poNumber' | 'injuryDescription' | 'day1Date'>>;
} {
  return {
    patient: {
      name: parsed.patient.name,
      nhi: parsed.patient.nhi,
      dob: parsed.patient.dob,
    },
    claim: {
      claimNumber: parsed.claim.claimNumber,
      acc45Number: parsed.claim.acc45Number,
      poNumber: parsed.claim.poNumber,
      injuryDescription: parsed.claim.injuryDescription,
      day1Date: parsed.claim.dateOfInjury,
    },
  };
}
