import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAIL_REFERENCE_ENTRIES,
  filterMailReferenceEntries,
} from './mailReference';

describe('DEFAULT_MAIL_REFERENCE_ENTRIES', () => {
  it('includes the core ACC form codes from the 2024 sheet', () => {
    const codes = DEFAULT_MAIL_REFERENCE_ENTRIES.map((e) => e.formCode);
    expect(codes).toEqual(
      expect.arrayContaining([
        'ACC45',
        'ACC2152',
        'ACC42',
        'ACC18',
        'ACC705',
        'ACC7988',
        'ACC7422',
        'ARTP',
        'DN-NOTES',
        'ORTHOTICS',
        'NON-RES',
      ]),
    );
  });

  it('has emails for ACC2152 and Non-Resident rows', () => {
    const acc2152 = DEFAULT_MAIL_REFERENCE_ENTRIES.find((e) => e.formCode === 'ACC2152')!;
    expect(acc2152.email).toBe('release.patientinfo@midcentraldhb.govt.nz');
    expect(acc2152.ccEmail).toMatch(/amy\.may/i);

    const nonRes = DEFAULT_MAIL_REFERENCE_ENTRIES.find((e) => e.formCode === 'NON-RES')!;
    expect(nonRes.email).toBe('eligibilityadmin@midcentraldhb.govt.nz');
    expect(nonRes.ccEmail).toBe('accounts.receivable@midcentraldhb.govt.nz');
  });

  it('omits email for internal handoffs like Orthotics', () => {
    const ortho = DEFAULT_MAIL_REFERENCE_ENTRIES.find((e) => e.formCode === 'ORTHOTICS')!;
    expect(ortho.email).toBeUndefined();
    expect(ortho.instructions.toLowerCase()).toContain('paige');
  });
});

describe('filterMailReferenceEntries', () => {
  it('filters by form code case-insensitively', () => {
    const hits = filterMailReferenceEntries(DEFAULT_MAIL_REFERENCE_ENTRIES, 'acc45');
    expect(hits.some((e) => e.formCode === 'ACC45')).toBe(true);
  });

  it('filters by destination email', () => {
    const hits = filterMailReferenceEntries(DEFAULT_MAIL_REFERENCE_ENTRIES, 'claimsdocs');
    expect(hits.some((e) => e.formCode === 'ACC705')).toBe(true);
  });
});
