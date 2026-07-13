import { describe, it, expect } from 'vitest';
import {
  findMatchingPatient,
  findDuplicatePatientGroups,
  mergePatientsIntoData,
  normalizePatientName,
  patientLinkedWeight,
  suggestKeepPatient,
} from './patients';
import { emptyData } from './sampleData';
import type { AppData, Patient } from '../types';

function patient(partial: Partial<Patient> & Pick<Patient, 'id' | 'name'>): Patient {
  return {
    nhi: '',
    dob: '',
    notes: '',
    ...partial,
  };
}

describe('normalizePatientName', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizePatientName('  Paul   Phillip  Blake ')).toBe('paul phillip blake');
  });
});

describe('findMatchingPatient', () => {
  const blake = patient({
    id: 'p1',
    name: 'Paul Phillip Blake',
    nhi: 'BTY3497',
    dob: '1960-05-12',
  });
  const other = patient({ id: 'p2', name: 'Jane Doe', nhi: 'ABC1234', dob: '1990-01-01' });

  it('matches by normalized NHI as the primary key', () => {
    const hit = findMatchingPatient([blake, other], { name: 'Someone Else', nhi: ' bty 3497 ' });
    expect(hit?.kind).toBe('nhi');
    expect(hit?.patient.id).toBe('p1');
  });

  it('falls back to name + DOB when NHI is blank', () => {
    const soft = patient({ id: 'p3', name: 'Paul Phillip Blake', dob: '1960-05-12' });
    const hit = findMatchingPatient([soft, other], {
      name: 'paul phillip blake',
      dob: '1960-05-12',
    });
    expect(hit?.kind).toBe('name-dob');
    expect(hit?.patient.id).toBe('p3');
  });

  it('does not match on name alone without DOB', () => {
    expect(
      findMatchingPatient([blake], { name: 'Paul Phillip Blake', nhi: '', dob: '' }),
    ).toBeUndefined();
  });

  it('respects excludeId so edit-self does not match', () => {
    expect(
      findMatchingPatient([blake, other], { nhi: 'BTY3497' }, { excludeId: 'p1' }),
    ).toBeUndefined();
  });
});

describe('findDuplicatePatientGroups', () => {
  it('groups two patients sharing an NHI', () => {
    const a = patient({ id: 'p1', name: 'Paul Phillip Blake', nhi: 'BTY3497' });
    const b = patient({ id: 'p2', name: 'Paul P Blake', nhi: 'BTY3497' });
    const groups = findDuplicatePatientGroups([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('nhi');
    expect(groups[0].redundant).toHaveLength(1);
    expect(new Set(groups[0].patients.map((p) => p.id))).toEqual(new Set(['p1', 'p2']));
  });

  it('groups name+DOB duplicates when NHI is blank', () => {
    const a = patient({ id: 'p1', name: 'Sam Smith', dob: '1980-01-01' });
    const b = patient({ id: 'p2', name: 'sam  smith', dob: '1980-01-01' });
    const groups = findDuplicatePatientGroups([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('name-dob');
  });

  it('does not flag distinct NHIs as duplicates even with the same name', () => {
    const a = patient({ id: 'p1', name: 'Sam Smith', nhi: 'AAA0001', dob: '1980-01-01' });
    const b = patient({ id: 'p2', name: 'Sam Smith', nhi: 'BBB0002', dob: '1980-01-01' });
    // Different NHIs — treat as different people (data entry may share a name).
    expect(findDuplicatePatientGroups([a, b])).toEqual([]);
  });

  it('suggests the patient with more linked claims as survivor', () => {
    const thin = patient({ id: 'p-thin', name: 'Paul Blake', nhi: 'BTY3497' });
    const rich = patient({ id: 'p-rich', name: 'Paul Phillip Blake', nhi: 'BTY3497' });
    const data: AppData = {
      ...emptyData(),
      patients: [thin, rich],
      claims: [
        {
          id: 'c1',
          patientId: 'p-rich',
          claimNumber: '1',
          acc45Number: '',
          poNumber: '',
          injuryDescription: '',
          type: 'original',
          status: 'active',
          day1Date: '',
        },
        {
          id: 'c2',
          patientId: 'p-rich',
          claimNumber: '2',
          acc45Number: '',
          poNumber: '',
          injuryDescription: '',
          type: 'original',
          status: 'active',
          day1Date: '',
        },
      ],
    };
    expect(suggestKeepPatient(data, [thin, rich]).id).toBe('p-rich');
    expect(patientLinkedWeight(data, 'p-rich')).toBeGreaterThan(patientLinkedWeight(data, 'p-thin'));
    const groups = findDuplicatePatientGroups([thin, rich], data);
    expect(groups[0].keep.id).toBe('p-rich');
  });
});

describe('mergePatientsIntoData', () => {
  it('reattaches claims, approvals, memos, declines to the survivor and deletes the duplicate', () => {
    const keep = patient({ id: 'keep', name: 'Paul Phillip Blake', nhi: 'BTY3497', dob: '' });
    const drop = patient({
      id: 'drop',
      name: 'Paul Blake',
      nhi: 'BTY3497',
      dob: '1960-05-12',
      notes: 'From letter import',
    });
    const before: AppData = {
      ...emptyData(),
      patients: [keep, drop],
      claims: [
        {
          id: 'c-drop',
          patientId: 'drop',
          claimNumber: '100',
          acc45Number: '',
          poNumber: '',
          injuryDescription: '',
          type: 'original',
          status: 'active',
          day1Date: '',
        },
      ],
      approvals: [
        {
          id: 'a1',
          patientId: 'drop',
          claimId: 'c-drop',
          serviceCode: 'NS04',
          approvalStartDate: '2025-01-01',
          approvalEndDate: '2025-12-31',
          approvedHoursOrConsults: 4,
          poNumber: 'PO1',
          notes: '',
        },
      ],
      memos: [{ id: 'm1', patientId: 'drop', text: 'Chase nurse', createdAt: 1 }],
      declines: [
        {
          id: 'd1',
          patientId: 'drop',
          patientName: 'Paul Blake',
          claimNumber: '100',
          declineReceivedDate: '2025-01-01',
          servicePeriodDeclined: 'Extended Nursing',
          reason: 'Incomplete',
          status: 'Awaiting nursing docs for resubmission',
          notes: '',
        },
      ],
      importHistory: [
        {
          id: 'h1',
          fileName: 'letter.pdf',
          kind: 'approval',
          patientId: 'drop',
          importedAt: 1,
        },
      ],
    };

    const after = mergePatientsIntoData(before, 'keep', ['drop']);

    expect(after.patients).toHaveLength(1);
    expect(after.patients[0].id).toBe('keep');
    expect(after.patients[0].dob).toBe('1960-05-12');
    expect(after.patients[0].notes).toContain('From letter import');
    expect(after.claims[0].patientId).toBe('keep');
    expect(after.approvals[0].patientId).toBe('keep');
    expect(after.memos[0].patientId).toBe('keep');
    expect(after.declines[0].patientId).toBe('keep');
    expect(after.importHistory?.[0].patientId).toBe('keep');
  });

  it('is a no-op when keep and drop are the same id', () => {
    const data = { ...emptyData(), patients: [patient({ id: 'p1', name: 'A' })] };
    expect(mergePatientsIntoData(data, 'p1', ['p1'])).toBe(data);
  });
});
