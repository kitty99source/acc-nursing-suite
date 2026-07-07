import type { AppData } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';
import { DEFAULT_RATES } from '../serviceCodes';

// ============================================================================
// Schema migration framework (P3-003). Ordered migrations run on load when
// file envelope version is older than FILE_VERSION.
// ============================================================================

export const LATEST_FILE_VERSION = 2;

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
  const approvals = (data.approvals ?? []).map((a) => ({
    ...a,
    recordStatus: a.recordStatus ?? 'current',
  }));
  return { ...data, settings, documents, approvals };
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

const STEPS: MigrationStep[] = [{ from: 1, to: 2, migrate: migrateV1ToV2 }];

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
