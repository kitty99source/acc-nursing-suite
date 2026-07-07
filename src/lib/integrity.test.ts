import { describe, it, expect } from 'vitest';
import { emptyData } from './sampleData';
import { validateReferentialIntegrity, compareDocumentBlobs } from './integrity';

describe('validateReferentialIntegrity', () => {
  it('returns no warnings for consistent data', () => {
    const data = emptyData();
    data.patients = [{ id: 'p1', name: 'A', nhi: '', dob: '', notes: '' }];
    data.claims = [
      {
        id: 'c1',
        patientId: 'p1',
        claimNumber: '100',
        acc45Number: '',
        poNumber: '',
        injuryDescription: '',
        type: 'original',
        status: 'active',
        day1Date: '2024-01-01',
      },
    ];
    data.serviceLines = [
      {
        id: 'sl1',
        claimId: 'c1',
        serviceCode: 'NS04',
        day1Date: '2024-01-01',
        consultCount: 0,
        interruptions: [],
      },
    ];
    expect(validateReferentialIntegrity(data)).toEqual([]);
  });

  it('reports orphan claim referencing missing patient', () => {
    const data = emptyData();
    data.claims = [
      {
        id: 'c1',
        patientId: 'missing',
        claimNumber: '100',
        acc45Number: '',
        poNumber: '',
        injuryDescription: '',
        type: 'original',
        status: 'active',
        day1Date: '2024-01-01',
      },
    ];
    const warnings = validateReferentialIntegrity(data);
    expect(warnings.some((w) => w.includes('missing patient'))).toBe(true);
  });

  it('reports dangling service line claimId', () => {
    const data = emptyData();
    data.serviceLines = [
      {
        id: 'sl1',
        claimId: 'ghost',
        serviceCode: 'NS04',
        day1Date: '2024-01-01',
        consultCount: 0,
        interruptions: [],
      },
    ];
    expect(validateReferentialIntegrity(data).some((w) => w.includes('ghost'))).toBe(true);
  });
});

describe('compareDocumentBlobs', () => {
  it('detects missing and orphan blobs', () => {
    const data = emptyData();
    data.documents = [
      {
        id: 'doc1',
        claimId: 'c1',
        kind: 'other',
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        addedDate: '2026-01-01',
      },
    ];
    const report = compareDocumentBlobs(data, ['doc2']);
    expect(report.missingBlobIds).toEqual(['doc1']);
    expect(report.orphanBlobIds).toEqual(['doc2']);
  });
});
