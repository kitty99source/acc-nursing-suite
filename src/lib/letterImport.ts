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
    // NS03 (and other NS01–NS03 package rows) no longer require approval and
    // never bill (ACC change, March 2025). A letter with package rows but no
    // NS04/NS05 is historic-only: do NOT block — it files as a historic record.
    // Only a letter with NO usable rows at all is a genuine blocker.
    if (parsed.serviceRows.length === 0 && parsed.packageRows.length === 0) {
      issues.push({
        id: 'no-service-rows',
        field: 'serviceRows',
        message: 'No NS03, NS04 or NS05 rows were found — check the letter, or use “Attach file only”.',
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
  // Browser build (vite dist) uses mammoth's browser unzip — expects arrayBuffer, not buffer.
  const { value } = await mammoth.extractRawText({ buffer, arrayBuffer: buffer });
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
    workerPath:
      typeof window !== 'undefined'
        ? new URL('tesseract.worker.min.js', window.location.href).href
        : new URL('tesseract.js/dist/worker.min.js', import.meta.url).toString(),
    corePath:
      typeof window !== 'undefined'
        ? new URL('tesseract-core-simd.wasm.js', window.location.href).href
        : new URL('tesseract.js-core/tesseract-core-simd.wasm.js', import.meta.url).toString(),
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

/** Pull the approved quantity from the text after a row's end date. Prefers a
 *  number tagged with a unit word; otherwise the first plain number that isn't a
 *  currency amount (skips $-prefixed values and 2-decimal prices). */
function extractRowQuantity(after: string): number {
  const tagged = after.match(/(\d+(?:\.\d+)?)\s*(?:Units?|Consults?|Hours?|Visits?)/i);
  if (tagged) return Math.round(parseFloat(tagged[1]));
  const re = /(\d+(?:\.\d+)?)/g;
  let n: RegExpExecArray | null;
  while ((n = re.exec(after)) !== null) {
    if (after[n.index - 1] === '$') continue; // currency
    if (/\.\d{2}$/.test(n[1])) continue; // price like 123.45
    const val = parseFloat(n[1]);
    if (Number.isFinite(val) && val > 0) return Math.round(val);
  }
  return 0;
}

function parseServiceRows(text: string): { serviceRows: ParsedServiceRow[]; packageRows: ParsedPackageRow[] } {
  const serviceRows: ParsedServiceRow[] = [];
  const packageRows: ParsedPackageRow[] = [];
  const seen = new Set<string>();
  // Scan each NS0x code, then read a bounded window after it. This handles both
  // pdf.js one-line tables ("NS04 Nursing Services … d1 d2 6 Units") and Word/
  // mammoth cell-per-line layouts where the code, dates and quantity land on
  // separate lines. Requiring two dates in the window guards against prose.
  const codeRe = /(?<![A-Za-z0-9])(NS0[1-5])(?![0-9])/gi;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(text)) !== null) {
    const code = m[1].toUpperCase();
    const window = text.slice(m.index, m.index + 260);
    const dates = [...window.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})/g)];
    if (dates.length < 2) continue;
    const start = parseAccDate(dates[0][1]);
    const end = parseAccDate(dates[1][1]);
    if (!start || !end) continue;
    const secondDate = dates[1];
    const afterEnd = window.slice((secondDate.index ?? 0) + secondDate[0].length);
    const qty = extractRowQuantity(afterEnd);
    const key = `${code}|${start}|${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
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

/**
 * Label-anchored, section-bounded injury/diagnosis extraction. Handles single
 * "Injury(s): Sprain" phrasings AND multi-line coded lists (e.g. "S830. Open
 * wound of scalp …", "T1400 Unspecified superficial injury …"). Anchors on the
 * label (Injury / Injuries / Injury(s) / Diagnosis…), then captures up to the
 * next known section boundary or end of text, tolerant of newlines. Separate
 * lines are joined with ", " so they render cleanly in the form textarea.
 */
export function extractInjuryDescription(text: string): string | undefined {
  const boundary = [
    'Services approved',
    'Services requested',
    'Thank you',
    'You requested',
    'Purchase order',
    'Client name',
    'Client details',
    'Why we',
    'We.re happy',
    'We are happy',
    'Yours sincerely',
    'After careful consideration',
    '\\bNUR\\d',
    '\\bNS0[1-5]\\b',
  ].join('|');
  // Require the label to carry a "(s)" or a colon so we don't accidentally
  // anchor on "Date of injury" (which is followed by a date, not the injuries).
  const re = new RegExp(
    `(?:Injur(?:y|ies)|Diagnos(?:is|es))(?:\\s+description)?(?:\\(s\\)\\s*:?|\\s*:)\\s*([\\s\\S]*?)(?=\\s*(?:${boundary})|$)`,
    'i',
  );
  const m = text.match(re);
  if (!m) return undefined;
  const lines = m[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const joined = lines.join(', ').replace(/(?:,\s*)+/g, ', ').replace(/^,\s*|,\s*$/g, '').trim();
  return joined || undefined;
}

// ----------------------------------------------------------------------------
// Single-field extractors (DRY). Each pulls ONE field from the raw letter text
// and is used both by parseApprovalLetter/parseDeclineLetter AND by the Review
// Queue's per-field "re-parse from attachment" buttons, so the main parse and a
// targeted re-parse can never diverge. Every extractor tolerates BOTH the
// colon-labelled NUR02 approval layout and the table-style NUR04VEN decline
// layout; patterns are ordered so the matching layout wins without the other
// layout's pattern spuriously matching (approval uses "Label:" colons, decline
// uses whitespace-separated cells, and their surrounding field boundaries
// differ — approval NHI is followed by "Injury", decline NHI by "ACC45").
// ----------------------------------------------------------------------------

/**
 * Claim number. Usually a 100…-style numeric, but some are letter-prefixed
 * (e.g. "P2222756868"). Allow an optional short alpha prefix; digits may carry
 * OCR spaces but must start & end on a digit so we don't run into the next field.
 */
export function extractClaimNumber(text: string): string | undefined {
  const raw =
    firstMatch(text, /Client.s claim number:\s*([A-Za-z]{0,3}\d[\d\s]*\d)/i) ??
    firstMatch(text, /Claim number\s+([A-Za-z]{0,3}\d[\d\s]*\d)/i);
  return normalizeClaimNumber(raw ?? '') || undefined;
}

export function extractNhi(text: string): string | undefined {
  const raw =
    firstMatch(text, /NHI number\s+([A-Z0-9\s]+?)\s+ACC45/i) ??
    firstMatch(text, /NHI number\s*:?\s*([A-Z0-9\s]+?)\s+Injury/i);
  return normalizeNhi(raw ?? '') || undefined;
}

export function extractAcc45(text: string): string | undefined {
  const raw =
    firstMatch(text, /ACC45 number:\s*([A-Z0-9\s]+?)\s+NHI/i) ??
    firstMatch(text, /ACC45 number\s+([A-Z0-9\s]+?)\s+Date of injury/i);
  return normalizeAcc45(raw ?? '') || undefined;
}

export function extractPo(text: string): string | undefined {
  const raw = firstMatch(
    text,
    /Purchase order number:\s*([\d\s]+?)(?=\s*\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
  );
  return normalizePo(raw ?? '') || undefined;
}

export function extractDob(text: string): string | undefined {
  const raw =
    firstMatch(text, /Date of birth:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i) ??
    firstMatch(text, /Date of birth\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  return parseAccDate(raw);
}

export function extractDateOfInjury(text: string): string | undefined {
  // Approval couples the client name and the date of injury on one line.
  const coupled = text.match(
    /Client name:\s*[^\n]+?\s+Date of injury:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  );
  if (coupled) return parseAccDate(coupled[1]);
  const spaced = firstMatch(text, /Date of injury\s+(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4})/i);
  if (spaced) return parseAccDate(spaced.replace(/\s+/g, ''));
  return undefined;
}

export function extractPatientName(text: string): string | undefined {
  // Approval: "Client name: <name> Date of injury: dd/mm/yyyy" (bounded so we
  // don't swallow the following header field).
  const coupled = text.match(
    /Client name:\s*([^\n]+?)\s+Date of injury:\s*\d{1,2}\/\d{1,2}\/\d{4}/i,
  );
  if (coupled) return trimClientName(coupled[1]) || undefined;
  // Decline: table layout with no colon.
  const declineRaw =
    firstMatch(text, /Client name\s+(.+?)\s+Postal address/i) ??
    firstMatch(text, /Client name\s+([^\n]+)/i);
  return declineRaw ? trimClientName(declineRaw) || undefined : undefined;
}

export function parseApprovalLetter(text: string): ParsedApprovalLetter {
  const letterDate = parseAccDate(firstMatch(text, /(\d{1,2}\s+[A-Za-z]+\s+\d{4})/));
  const name = extractPatientName(text);
  const dateOfInjury = extractDateOfInjury(text);
  const dob = extractDob(text);
  const acc45 = extractAcc45(text);
  const nhi = extractNhi(text);
  const injury = extractInjuryDescription(text);
  const { serviceRows, packageRows } = parseServiceRows(text);

  return {
    kind: 'approval',
    letterDate,
    formCode: firstMatch(text, /^(NUR\d+)/m),
    patient: { name, nhi: nhi ?? '', dob },
    claim: {
      claimNumber: extractClaimNumber(text) ?? '',
      acc45Number: acc45 ?? '',
      poNumber: extractPo(text),
      dateOfInjury,
      injuryDescription: injury,
    },
    serviceRows,
    packageRows,
    rawText: text,
  };
}

export function parseDeclineLetter(text: string): ParsedDeclineLetter {
  const headerClaim = extractClaimNumber(text) ?? '';
  const letterDate = parseAccDate(firstMatch(text, /(\d{1,2}\s+[A-Za-z]+\s+\d{4})/));
  const name = extractPatientName(text);
  const nhi = extractNhi(text) ?? '';
  const dob = extractDob(text);
  const acc45 = extractAcc45(text) ?? '';
  const dateOfInjury = extractDateOfInjury(text);
  const injury = extractInjuryDescription(text);
  const serviceRaw = firstMatch(text, /requested the following service:\s*•\s*([^\n]+)/i);
  const serviceRequested = serviceRaw ? trimServiceRequested(serviceRaw) : undefined;
  const reasonBlock =
    text.match(/Why we can.t approve the request\s+(We.re unable[\s\S]+?)(?:We.re happy to answer|Please call)/i) ||
    text.match(/because there are ([^.]+)\./i);
  const reason = reasonBlock?.[1]?.replace(/\s+/g, ' ').trim();
  const allClaims = allMatches(text, /claim number\s*\(?\s*([A-Za-z]{0,3}\d[\d\s]*\d)\s*\)?/gi).map(
    normalizeClaimNumber,
  );
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
      injuryDescription: injury,
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

/** Label prefix used everywhere NS03/package rows are filed as history. */
export const HISTORIC_PACKAGE_LABEL = 'NS03 — historic, no billing';

/**
 * One-line, human-readable summary of NS01–NS03 package rows for the document
 * note when a letter is filed as historic. These rows NEVER create approvals
 * and NEVER bill (ACC dropped the NS03 approval requirement in March 2025) —
 * they exist only so the patient's history is complete.
 */
export function describeHistoricPackageRows(rows: ParsedPackageRow[]): string {
  if (rows.length === 0) return '';
  const parts = rows.map((r) => {
    const period =
      r.approvalStartDate && r.approvalEndDate
        ? ` ${r.approvalStartDate}→${r.approvalEndDate}`
        : '';
    const qty = Number.isFinite(r.quantity) ? ` (×${r.quantity})` : '';
    return `${r.serviceCode}${period}${qty}`;
  });
  return `${HISTORIC_PACKAGE_LABEL}: ${parts.join('; ')}`;
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

  if (parsed.serviceRows.length > 0) {
    fieldConfidences.push({ field: 'serviceRows', value: String(parsed.serviceRows.length), confidence: 100 });
  } else if (parsed.packageRows.length > 0) {
    // Historic NS03-only letter — no billing, not a blocker (ACC change, Mar 2025).
    fieldConfidences.push({
      field: 'historicPackage',
      value: parsed.packageRows.map((p) => p.serviceCode).join(', '),
      confidence: 100,
      note: 'Historic package — no billing',
    });
  } else {
    blockers.push('No NS04/NS05 service rows found');
  }

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

async function extractWordResult(
  input: Blob | ArrayBuffer | Uint8Array,
  onProgress?: LetterImportProgressHandler,
): Promise<{ text: string; usedOcr: boolean }> {
  return { text: await extractWordText(input, onProgress), usedOcr: false };
}

export async function parseLetterFile(
  file: Blob,
  data: AppData,
  context?: LetterImportContext,
  onProgress?: LetterImportProgressHandler,
): Promise<LetterParseResult> {
  // Try the extractor implied by name/type first, then fall back to the other.
  // Bridge-resolved files can arrive as application/octet-stream with an
  // ambiguous name, so a PDF may look like Word (or vice versa). Falling back
  // on a hard failure makes the auto-path as forgiving as a manual file pick.
  const order = isWordDocument(file)
    ? [extractWordResult, extractLetterText]
    : [extractLetterText, extractWordResult];
  let lastErr: unknown;
  for (const extract of order) {
    try {
      const { text, usedOcr } = await extract(file, onProgress);
      return parseLetterFromText(text, data, context, usedOcr, onProgress);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Could not read this file as a PDF or Word (.docx) letter.');
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
