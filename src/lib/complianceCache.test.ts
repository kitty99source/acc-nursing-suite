import { describe, it, expect, beforeEach } from 'vitest';
import type { AppData } from '../types';
import { emptyData } from './sampleData';
import { runCompliance } from './compliance';
import {
  getComplianceFindings,
  resetComplianceCacheForTests,
  complianceRunCount,
  dataFingerprint,
  invalidateComplianceCache,
} from './complianceCache';
import { buildActionQueue } from './analytics';

function miniData(): AppData {
  const data = emptyData();
  data.patients.push({ id: 'p1', name: 'Test Patient', nhi: 'ABC1234', dob: '1980-01-01', notes: '' });
  data.claims.push({
    id: 'c1',
    patientId: 'p1',
    claimNumber: 'CLM001',
    acc45Number: '',
    poNumber: '',
    injuryDescription: '',
    status: 'active',
    type: 'original',
    day1Date: '2025-01-01',
  });
  data.serviceLines.push({
    id: 'sl1',
    claimId: 'c1',
    serviceCode: 'NS04',
    day1Date: '2025-01-01',
    consultCount: 1,
    interruptions: [],
  });
  return data;
}

describe('complianceCache', () => {
  beforeEach(() => resetComplianceCacheForTests());

  it('dedupes runCompliance per data reference', () => {
    const data = miniData();
    const a = getComplianceFindings(data);
    const b = getComplianceFindings(data);
    expect(a).toBe(b);
    expect(complianceRunCount()).toBe(1);
  });

  it('re-scans when data reference changes', () => {
    let data = miniData();
    getComplianceFindings(data);
    data = { ...data, claims: [...data.claims] };
    getComplianceFindings(data);
    expect(complianceRunCount()).toBe(2);
  });

  it('buildActionQueue shares cached findings without extra compliance runs', () => {
    const data = miniData();
    const findings = getComplianceFindings(data);
    expect(complianceRunCount()).toBe(1);
    buildActionQueue(data, findings);
    buildActionQueue(data, findings);
    expect(complianceRunCount()).toBe(1);
  });

  it('incremental update only re-scans dirty claims', () => {
    const data = miniData();
    getComplianceFindings(data);
    const next = {
      ...data,
      claims: data.claims.map((c) => (c.id === 'c1' ? { ...c, injuryDescription: 'edited' } : c)),
    };
    getComplianceFindings(next, { dirtyClaimIds: ['c1'] });
    expect(complianceRunCount()).toBe(2);
  });

  it('dataFingerprint changes when entity counts change', () => {
    const data = miniData();
    const h1 = dataFingerprint(data);
    const h2 = dataFingerprint({ ...data, patients: [...data.patients, { ...data.patients[0], id: 'p2' }] });
    expect(h1).not.toBe(h2);
  });

  it('invalidate forces fresh scan', () => {
    const data = miniData();
    getComplianceFindings(data);
    invalidateComplianceCache();
    getComplianceFindings(data);
    expect(complianceRunCount()).toBe(2);
  });

  it('full scan matches runCompliance baseline', () => {
    const data = miniData();
    const cached = getComplianceFindings(data);
    const direct = runCompliance(data);
    expect(cached.map((f) => f.id).sort()).toEqual(direct.map((f) => f.id).sort());
  });
});
