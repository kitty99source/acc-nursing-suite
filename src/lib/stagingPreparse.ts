// ============================================================================
// Background pre-parse of staged letters into parsedPreview (HRQ batch shape).
// Concurrency-capped and lazy — never blocks the UI; skips large/OCR-heavy files.
// ============================================================================

import { useStore } from '../state/store';
import { fetchInboxFileForStaging } from './localAccBridge';
import {
  HRQ_BATCH_MIN_CONFIDENCE,
  type StagingParsedPreview,
} from './hrqBatch';
import { prefillFromParsed, type LetterParseResult } from './letterImport';
import { updateStagingItem, type StagingItem } from './staging';

const MAX_CONCURRENT = 2;
/** Skip pre-parse for very large files (likely scanned OCR) to keep the UI snappy. */
const MAX_PREPARSE_BYTES = 4 * 1024 * 1024;

let active = 0;
const queue: StagingItem[] = [];
const inFlight = new Set<string>();
const done = new Set<string>();

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

function buildPreview(result: LetterParseResult, file: File, base64: string): StagingParsedPreview | null {
  if (!result.parsed) return null;
  if (result.overallConfidence < HRQ_BATCH_MIN_CONFIDENCE) return null;
  const blocking = result.issues.filter((i) => i.blocking !== false);
  if (blocking.length > 0) return null;
  const pre = prefillFromParsed(result.parsed);
  const patientName =
    result.match.patient?.name?.trim() ||
    (result.parsed.kind === 'approval' || result.parsed.kind === 'decline'
      ? result.parsed.patient.name?.trim()
      : '') ||
    'Unknown';
  return {
    kind: result.parsed.kind,
    confidence: result.overallConfidence,
    patientName,
    claimNumber:
      result.parsed.kind === 'approval' || result.parsed.kind === 'decline'
        ? result.parsed.claim.claimNumber
        : undefined,
    parsed: result.parsed,
    fileBlobBase64: base64,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    patientId: result.match.patientId,
    claimId: result.match.claimId,
    patientPatch: result.match.patient
      ? {
          name: result.match.patient.name,
          nhi: result.match.patient.nhi,
          dob: result.match.patient.dob,
        }
      : pre.patient,
    claimPatch: pre.claim,
    rows: result.parsed.kind === 'approval' ? result.parsed.serviceRows : undefined,
    reason: result.parsed.kind === 'decline' ? result.parsed.reason : undefined,
    servicePeriodDeclined:
      result.parsed.kind === 'decline' ? result.parsed.serviceRequested : undefined,
  };
}

async function processOne(item: StagingItem): Promise<void> {
  if (!item.sourceHash || inFlight.has(item.id) || done.has(item.id)) return;
  if (item.parsedPreview) {
    done.add(item.id);
    return;
  }
  inFlight.add(item.id);
  try {
    const file = await fetchInboxFileForStaging({
      sourceHash: item.sourceHash,
      sourceFileName: item.sourceFileName,
      expectedFileName: item.expectedFileName,
    });
    if (!file || file.size > MAX_PREPARSE_BYTES) {
      done.add(item.id);
      return;
    }
    const parse = useStore.getState().parseLetterFile;
    const result = await parse(file);
    const base64 = await blobToBase64(file);
    const preview = buildPreview(result, file, base64);
    if (preview) {
      await updateStagingItem(item.id, { parsedPreview: preview as unknown as Record<string, unknown> });
    }
    done.add(item.id);
  } catch {
    // Leave item without preview — Review & import still works.
    done.add(item.id);
  } finally {
    inFlight.delete(item.id);
  }
}

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    active++;
    void processOne(next).finally(() => {
      active--;
      pump();
    });
  }
}

/** Enqueue pending staging items for background pre-parse (idempotent). */
export function enqueueStagingPreparse(items: StagingItem[]): void {
  for (const item of items) {
    if (item.status !== 'pending') continue;
    if (!item.sourceHash) continue;
    if (item.parsedPreview || done.has(item.id) || inFlight.has(item.id)) continue;
    if (queue.some((q) => q.id === item.id)) continue;
    queue.push(item);
  }
  pump();
}

/** Test helper — reset queue state between tests. */
export function __resetStagingPreparseForTests(): void {
  queue.length = 0;
  inFlight.clear();
  done.clear();
  active = 0;
}
