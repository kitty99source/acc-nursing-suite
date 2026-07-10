// ============================================================================
// Background pre-parse of staged letters into the hash-keyed parse cache.
// Concurrency-capped and lazy — never blocks the UI; skips large/OCR-heavy files.
// ============================================================================

import { useStore } from '../state/store';
import { fetchInboxFileForStaging } from './localAccBridge';
import {
  HRQ_BATCH_MIN_CONFIDENCE,
  LETTER_PARSER_VERSION,
  isAutoAcceptEligiblePreview,
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

const MAX_CONCURRENT = 4;

let active = 0;
const queue: StagingItem[] = [];
const inFlight = new Set<string>();
/** Successfully handled (named, or parsed with no usable name). */
const done = new Set<string>();
/** No bytes available this pass — eligible for "Fix names now" retry. */
const unavailable = new Set<string>();

export function patientHintsFromParse(
  result: LetterParseResult,
): { patientName?: string; claimNumber?: string } | null {
  if (!result.parsed) return null;
  if (result.parsed.kind !== 'approval' && result.parsed.kind !== 'decline') return null;
  const patientName =
    result.match.patient?.name?.trim() || result.parsed.patient.name?.trim() || '';
  const claimNumber = result.parsed.claim.claimNumber?.trim() || '';
  if (!patientName && !claimNumber) return null;
  return {
    patientName: patientName || undefined,
    claimNumber: claimNumber || undefined,
  };
}

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
    parserVersion: LETTER_PARSER_VERSION,
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
    blockers: result.blockers,
    ambiguous: result.match.ambiguous,
  };
}

async function denormalizeNameHints(
  item: StagingItem,
  hints: { patientName?: string; claimNumber?: string; autoAcceptEligible?: boolean },
): Promise<void> {
  const patch: Partial<StagingItem> = {};
  if (hints.patientName?.trim()) patch.patientName = hints.patientName.trim();
  if (hints.claimNumber?.trim()) patch.claimNumber = hints.claimNumber.trim();
  if (hints.autoAcceptEligible !== undefined) patch.autoAcceptEligible = hints.autoAcceptEligible;
  if (!Object.keys(patch).length) return;
  const unchanged =
    (patch.patientName === undefined || item.patientName === patch.patientName) &&
    (patch.claimNumber === undefined || item.claimNumber === patch.claimNumber) &&
    (patch.autoAcceptEligible === undefined ||
      (item.autoAcceptEligible ?? false) === patch.autoAcceptEligible);
  if (unchanged) return;
  await updateStagingItem(item.id, patch);
}

// Denormalize the SMALL `autoAcceptEligible` boolean (not the full preview —
// that's the exact per-item blob the lean-queue redesign removed) so the
// "Auto-accept ready (N)" toolbar count/list filter in ReviewQueue.tsx can
// stay a cheap synchronous check over `StagingItem`, matching how
// `patientName`/`claimNumber` hints already work. The full preview is only
// resolved from the hash-keyed letter parse cache again at actual commit
// time (see `hrqBatch.ts` `commitAutoAcceptItem`'s `resolvePreview`).
async function denormalizeHints(item: StagingItem, preview: StagingParsedPreview): Promise<void> {
  await denormalizeNameHints(item, {
    patientName: preview.patientName,
    claimNumber: preview.claimNumber,
    autoAcceptEligible: isAutoAcceptEligiblePreview(preview),
  });
}

async function resolveFile(item: StagingItem, hash: string): Promise<File | undefined> {
  const cachedBlob = await getCachedLetterBlob(hash);
  if (cachedBlob?.size) {
    const preferred = (item.expectedFileName || item.sourceFileName || 'letter.bin').trim();
    return new File([cachedBlob], preferred, {
      type: cachedBlob.type || 'application/octet-stream',
    });
  }
  const bridged = await fetchInboxFileForStaging({
    sourceHash: hash,
    sourceFileName: item.sourceFileName,
    expectedFileName: item.expectedFileName,
  });
  if (bridged) await putCachedLetterBlob(hash, bridged);
  return bridged;
}

async function processOne(item: StagingItem): Promise<void> {
  if (!item.sourceHash || inFlight.has(item.id) || done.has(item.id)) return;
  inFlight.add(item.id);
  try {
    const hash = item.sourceHash;
    const cached = await getCachedLetterParse(hash);
    if (cached) {
      await denormalizeHints(item, cached);
      unavailable.delete(item.id);
      done.add(item.id);
      return;
    }

    const file = await resolveFile(item, hash);
    if (!file) {
      unavailable.add(item.id);
      return;
    }
    if (file.size > MAX_PREPARSE_BYTES) {
      // Too large for background parse — don't keep retrying forever.
      done.add(item.id);
      unavailable.delete(item.id);
      return;
    }

    const parse = useStore.getState().parseLetterFile;
    const result = await parse(file);
    const base64 = await blobToBase64(file);
    const preview = buildStagingPreview(result, file, base64);
    if (preview) {
      await putCachedLetterParse(hash, preview);
      await denormalizeHints(item, preview);
    } else {
      // Still surface a usable list title from a partial / low-confidence parse.
      // A parse that didn't clear the (lower) full-preview bar can never be
      // auto-accept eligible (a stricter bar) — explicitly clear a stale
      // `true` flag from an earlier pass (e.g. parser version bump) rather
      // than leaving it dangling.
      const hints = patientHintsFromParse(result);
      await denormalizeNameHints(item, { ...hints, autoAcceptEligible: false });
    }
    unavailable.delete(item.id);
    done.add(item.id);
  } catch {
    unavailable.add(item.id);
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
    if (done.has(item.id) || unavailable.has(item.id) || inFlight.has(item.id)) continue;
    if (queue.some((q) => q.id === item.id)) continue;
    queue.push(item);
  }
  pump();
}

/**
 * Clear done/unavailable for unnamed pending items and re-queue them.
 * Use when the bridge comes back or the user clicks "Fix names now".
 */
export function retryUnnamedStagingPreparse(items: StagingItem[]): number {
  const targets = items.filter(
    (i) => i.status === 'pending' && Boolean(i.sourceHash) && !i.patientName?.trim(),
  );
  for (const item of targets) {
    done.delete(item.id);
    unavailable.delete(item.id);
  }
  enqueueStagingPreparse(targets);
  return targets.length;
}

export function stagingPreparseStats(): {
  queued: number;
  active: number;
  done: number;
  unavailable: number;
} {
  return {
    queued: queue.length,
    active,
    done: done.size,
    unavailable: unavailable.size,
  };
}

/** Test helper — reset queue state between tests. */
export function __resetStagingPreparseForTests(): void {
  queue.length = 0;
  inFlight.clear();
  done.clear();
  unavailable.clear();
  active = 0;
}
