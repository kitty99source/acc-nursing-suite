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
  it('migrates v1 fixture to latest (v4)', () => {
    const next = migrateAppData(v1Fixture(), 1, LATEST_FILE_VERSION);
    expect(next.schemaVersion).toBe(4);
    expect(next.importHistory).toEqual([]);
    expect(next.documents).toEqual([]);
    expect(next.memos).toEqual([]);
    expect(next.settings.nurseFollowUpDays).toBe(7);
    expect(next.settings.accFollowUpWorkingDays).toBe(10);
  });

  it('migrates v2 fixture to v4, adding the memos table', () => {
    const v2 = { ...v1Fixture(), schemaVersion: 2, importHistory: [] };
    const next = migrateAppData(v2, 2, LATEST_FILE_VERSION);
    expect(next.schemaVersion).toBe(4);
    expect(next.memos).toEqual([]);
  });

  it('v3 → v4 stamps case stage `approved` when a current NS04 approval exists on the claim', () => {
    const v3: AppData = {
      ...v1Fixture(),
      schemaVersion: 3,
      importHistory: [],
      claims: [
        {
          id: 'c1',
          patientId: 'p1',
          claimNumber: 'CN1',
          acc45Number: '',
          poNumber: '',
          injuryDescription: '',
          type: 'original',
          status: 'active',
          day1Date: '2026-01-01',
        },
      ],
      approvals: [
        {
          id: 'a1',
          patientId: 'p1',
          claimId: 'c1',
          serviceCode: 'NS04',
          approvalStartDate: '2026-02-01',
          approvalEndDate: '2026-08-01',
          approvedHoursOrConsults: 10,
          poNumber: 'PO1',
          notes: '',
          recordStatus: 'current',
        },
      ],
    };
    const next = migrateAppData(v3, 3, LATEST_FILE_VERSION);
    expect(next.schemaVersion).toBe(4);
    expect(next.claims[0].caseStage).toBe('approved');
    expect(next.claims[0].caseEvents).toEqual([]);
    expect(next.claims[0].accRespondedAt).toBe('2026-02-01');
  });

  it('v3 → v4 stamps `declined` when a terminal decline is on the claim', () => {
    const v3: AppData = {
      ...v1Fixture(),
      schemaVersion: 3,
      importHistory: [],
      claims: [
        {
          id: 'c2',
          patientId: 'p2',
          claimNumber: 'CN2',
          acc45Number: '',
          poNumber: '',
          injuryDescription: '',
          type: 'original',
          status: 'active',
          day1Date: '2026-01-01',
        },
      ],
      declines: [
        {
          id: 'd1',
          patientId: 'p2',
          claimId: 'c2',
          patientName: 'Jane Doe',
          claimNumber: 'CN2',
          declineReceivedDate: '2026-02-01',
          servicePeriodDeclined: 'Extended Nursing',
          reason: 'insufficient docs',
          status: 'Declined again',
          notes: '',
          dateOutcomeReceived: '2026-02-15',
        },
      ],
    };
    const next = migrateAppData(v3, 3, LATEST_FILE_VERSION);
    expect(next.claims[0].caseStage).toBe('declined');
    expect(next.claims[0].accRespondedAt).toBe('2026-02-15');
  });

  it('v3 → v4 defaults claims with no approvals/declines to `not_started`', () => {
    const v3: AppData = {
      ...v1Fixture(),
      schemaVersion: 3,
      importHistory: [],
      claims: [
        {
          id: 'c3',
          patientId: 'p3',
          claimNumber: 'CN3',
          acc45Number: '',
          poNumber: '',
          injuryDescription: '',
          type: 'original',
          status: 'active',
          day1Date: '2026-01-01',
        },
      ],
    };
    const next = migrateAppData(v3, 3, LATEST_FILE_VERSION);
    expect(next.claims[0].caseStage).toBe('not_started');
    expect(next.claims[0].caseEvents).toEqual([]);
  });

  it('blocks downgrade when file version is newer than app', () => {
    expect(() => assertNotDowngrade(5, 4)).toThrow(DowngradeBlockedError);
    expect(() => assertNotDowngrade(4, 4)).not.toThrow();
  });

  it('throws when no migration path exists', () => {
    expect(() => migrateAppData(v1Fixture(), 99, 100)).toThrow(/No migration path/);
  });
});
