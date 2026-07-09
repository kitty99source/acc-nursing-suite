// ============================================================================
// Background pre-parse of staged letters into the hash-keyed parse cache.
// Concurrency-capped and lazy — never blocks the UI; skips large/OCR-heavy files.
// ============================================================================

import { useStore } from '../state/store';
import { fetchInboxFileForStaging } from './localAccBridge';
import {
  HRQ_BATCH_MIN_CONFIDENCE,
  type StagingParsedPreview,
} from './hrqBatch';
import { prefillFromParsed, type LetterParseResult } from './letterImport';
import {
  blobToBase64,
  getCachedLetterBlob,
  getCachedLetterParse,
  putCachedLetterBlob,
  putCachedLetterParse,
} from './letterCache';
import { updateStagingItem, type StagingItem } from './staging';

export const MAX_PREPARSE_BYTES = 4 * 1024 * 1024;

const MAX_CONCURRENT = 2;

let active = 0;
const queue: StagingItem[] = [];
const inFlight = new Set<string>();
const done = new Set<string>();

export function buildStagingPreview(
  result: LetterParseResult,
  file: File,
  base64: string,
): StagingParsedPreview | null {
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

async function denormalizeHints(item: StagingItem, preview: StagingParsedPreview): Promise<void> {
  const patch: Partial<StagingItem> = {};
  if (preview.patientName?.trim()) patch.patientName = preview.patientName.trim();
  if (preview.claimNumber?.trim()) patch.claimNumber = preview.claimNumber.trim();
  if (!Object.keys(patch).length) return;
  if (item.patientName === patch.patientName && item.claimNumber === patch.claimNumber) return;
  await updateStagingItem(item.id, patch);
}

async function processOne(item: StagingItem): Promise<void> {
  if (!item.sourceHash || inFlight.has(item.id) || done.has(item.id)) return;
  inFlight.add(item.id);
  try {
    const hash = item.sourceHash;
    const cached = await getCachedLetterParse(hash);
    if (cached) {
      await denormalizeHints(item, cached);
      done.add(item.id);
      return;
    }

    let file =
      (await getCachedLetterBlob(hash))?.size
        ? await (async () => {
            const blob = await getCachedLetterBlob(hash);
            if (!blob?.size) return undefined;
            const preferred = (item.expectedFileName || item.sourceFileName || 'letter.bin').trim();
            return new File([blob], preferred, { type: blob.type || 'application/octet-stream' });
          })()
        : undefined;

    if (!file) {
      file = await fetchInboxFileForStaging({
        sourceHash: hash,
        sourceFileName: item.sourceFileName,
        expectedFileName: item.expectedFileName,
      });
      if (file) await putCachedLetterBlob(hash, file);
    }

    if (!file || file.size > MAX_PREPARSE_BYTES) {
      done.add(item.id);
      return;
    }

    const parse = useStore.getState().parseLetterFile;
    const result = await parse(file);
    const base64 = await blobToBase64(file);
    const preview = buildStagingPreview(result, file, base64);
    if (preview) {
      await putCachedLetterParse(hash, preview);
      await denormalizeHints(item, preview);
    }
    done.add(item.id);
  } catch {
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
    if (done.has(item.id) || inFlight.has(item.id)) continue;
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
