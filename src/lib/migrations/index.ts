import type { AppData, CaseStage, Claim } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';
import { DEFAULT_RATES } from '../serviceCodes';

// ============================================================================
// Schema migration framework (P3-003). Ordered migrations run on load when
// file envelope version is older than FILE_VERSION.
// ============================================================================

export const LATEST_FILE_VERSION = 4;

export class DowngradeBlockedError extends Error {
  constructor(fileVersion: number, appVersion: number) {
    super(
      `This file was saved with version ${fileVersion}, but this app supports up to version ${appVersion}. Open it in a newer build — downgrading is not supported.`,
    );
    this.name = 'DowngradeBlockedError';
  }
}

export type MigrationStep = {
  from: number;
  to: number;
  migrate: (data: AppData) => AppData;
};

function normalizeForMigration(data: AppData): AppData {
  const settings = { ...DEFAULT_SETTINGS, ...data.settings };
  settings.serviceRates = { ...DEFAULT_RATES, ...(data.settings?.serviceRates ?? {}) };
  const enabled = data.settings?.enabledServiceCodes;
  settings.enabledServiceCodes =
    Array.isArray(enabled) && enabled.length > 0 ? enabled : [...DEFAULT_SETTINGS.enabledServiceCodes];
  const documents = Array.isArray(data.documents) ? data.documents : [];
  const memos = Array.isArray(data.memos) ? data.memos : [];
  const approvals = (data.approvals ?? []).map((a) => ({
    ...a,
    recordStatus: a.recordStatus ?? 'current',
  }));
  return { ...data, settings, documents, memos, approvals };
}

/** v1 → v2: stamp schemaVersion and ensure optional arrays exist. */
function migrateV1ToV2(data: AppData): AppData {
  const normalized = normalizeForMigration(data);
  return {
    ...normalized,
    schemaVersion: 2,
    importHistory: normalized.importHistory ?? [],
    documents: normalized.documents ?? [],
  };
}

/** v2 → v3: add the `memos` table (nurse follow-up tracking). */
function migrateV2ToV3(data: AppData): AppData {
  const normalized = normalizeForMigration(data);
  return {
    ...normalized,
    schemaVersion: 3,
    memos: normalized.memos ?? [],
  };
}

/**
 * v3 → v4: stamp a case stage on every claim. If there is a current NS04/NS05
 * approval on the claim, treat the case as `approved`; if a terminal decline
 * exists, `declined`; otherwise the claim has no in-flight case yet
 * (`not_started`). `caseEvents` is defensively initialised so downstream code
 * can always call `.push`. Settings gain the new SLA + banner defaults.
 */
function migrateV3ToV4(data: AppData): AppData {
  const normalized = normalizeForMigration(data);
  const approvalsByClaim = new Map<string, AppData['approvals']>();
  for (const a of normalized.approvals) {
    const list = approvalsByClaim.get(a.claimId) ?? [];
    list.push(a);
    approvalsByClaim.set(a.claimId, list);
  }
  const declinesByClaim = new Map<string, AppData['declines']>();
  for (const d of normalized.declines) {
    if (!d.claimId) continue;
    const list = declinesByClaim.get(d.claimId) ?? [];
    list.push(d);
    declinesByClaim.set(d.claimId, list);
  }

  const claims: Claim[] = normalized.claims.map((c) => {
    if (c.caseStage) return { ...c, caseEvents: c.caseEvents ?? [] };
    const approvals = approvalsByClaim.get(c.id) ?? [];
    const currentApproval = approvals.find(
      (a) => (a.recordStatus ?? 'current') === 'current',
    );
    const declines = declinesByClaim.get(c.id) ?? [];
    const terminalDecline = declines.find(
      (d) => d.status === 'Declined again' || d.status === 'Accepted',
    );
    let stage: CaseStage = 'not_started';
    let accRespondedAt: string | undefined;
    if (currentApproval) {
      stage = 'approved';
      accRespondedAt = currentApproval.approvalStartDate;
    } else if (terminalDecline) {
      stage = terminalDecline.status === 'Accepted' ? 'approved' : 'declined';
      accRespondedAt = terminalDecline.dateOutcomeReceived;
    }
    return {
      ...c,
      caseStage: stage,
      accRespondedAt: c.accRespondedAt ?? accRespondedAt,
      caseEvents: c.caseEvents ?? [],
    };
  });

  return {
    ...normalized,
    schemaVersion: 4,
    claims,
  };
}

const STEPS: MigrationStep[] = [
  { from: 1, to: 2, migrate: migrateV1ToV2 },
  { from: 2, to: 3, migrate: migrateV2ToV3 },
  { from: 3, to: 4, migrate: migrateV3ToV4 },
];

export function migrateAppData(data: AppData, fromVersion: number, toVersion = LATEST_FILE_VERSION): AppData {
  let current = fromVersion;
  let result = data;
  while (current < toVersion) {
    const step = STEPS.find((s) => s.from === current);
    if (!step) {
      throw new Error(`No migration path from file version ${current} to ${toVersion}.`);
    }
    result = step.migrate(result);
    current = step.to;
  }
  return result;
}

export function assertNotDowngrade(fileVersion: number, appVersion: number): void {
  if (fileVersion > appVersion) throw new DowngradeBlockedError(fileVersion, appVersion);
}
