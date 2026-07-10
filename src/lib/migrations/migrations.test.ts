import { describe, it, expect } from 'vitest';
import { migrateAppData, assertNotDowngrade, DowngradeBlockedError, LATEST_FILE_VERSION } from './index';
import type { AppData } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';

function v1Fixture(): AppData {
  return {
    schemaVersion: 1,
    patients: [],
    claims: [],
    serviceLines: [],
    approvals: [],
    invoiceLines: [],
    complexCases: [],
    declines: [],
    settings: { ...DEFAULT_SETTINGS },
    documents: [],
    memos: [],
  };
}

describe('migrations', () => {
  it('migrates v1 fixture to latest (v3)', () => {
    const next = migrateAppData(v1Fixture(), 1, LATEST_FILE_VERSION);
    expect(next.schemaVersion).toBe(3);
    expect(next.importHistory).toEqual([]);
    expect(next.documents).toEqual([]);
    expect(next.memos).toEqual([]);
  });

  it('migrates v2 fixture to v3, adding the memos table', () => {
    const v2 = { ...v1Fixture(), schemaVersion: 2, importHistory: [] };
    const next = migrateAppData(v2, 2, LATEST_FILE_VERSION);
    expect(next.schemaVersion).toBe(3);
    expect(next.memos).toEqual([]);
  });

  it('blocks downgrade when file version is newer than app', () => {
    expect(() => assertNotDowngrade(3, 2)).toThrow(DowngradeBlockedError);
    expect(() => assertNotDowngrade(2, 2)).not.toThrow();
  });

  it('throws when no migration path exists', () => {
    expect(() => migrateAppData(v1Fixture(), 99, 100)).toThrow(/No migration path/);
  });
});
