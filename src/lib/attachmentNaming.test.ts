import { describe, it, expect } from 'vitest';
import {
  claimTokenFromSubject,
  descriptiveAttachmentName,
  limitFileNameLength,
  patientNameFromSubject,
} from './attachmentNaming';

const REAL_SUBJECT = 'Mr Graham Wayne Reichenbach - Claim:P2222756868 ACCID:VEND-K96655';
const ORIGINAL = '1_NUR02_Nursing_services_approve_-_vendor.docx';

describe('patientNameFromSubject', () => {
  it('returns the title-stripped name before " - Claim"', () => {
    expect(patientNameFromSubject(REAL_SUBJECT)).toBe('Graham Wayne Reichenbach');
  });

  it('strips common titles case-insensitively', () => {
    expect(patientNameFromSubject('mrs Jane Smith - Claim:10000003194')).toBe('Jane Smith');
    expect(patientNameFromSubject('Dr. Ada Lovelace - Claim:100200300')).toBe('Ada Lovelace');
  });

  it('returns undefined when there is no " - Claim" separator', () => {
    expect(patientNameFromSubject('Watson')).toBeUndefined();
    expect(patientNameFromSubject('Nursing services approve')).toBeUndefined();
    expect(patientNameFromSubject('')).toBeUndefined();
  });
});

describe('claimTokenFromSubject', () => {
  it('keeps the alphanumeric claim token including a leading letter', () => {
    expect(claimTokenFromSubject(REAL_SUBJECT)).toBe('P2222756868');
    expect(claimTokenFromSubject('X - Claim:10000003194 ACCID:V-1')).toBe('10000003194');
  });

  it('returns undefined when no claim token is present', () => {
    expect(claimTokenFromSubject('Watson')).toBeUndefined();
    expect(claimTokenFromSubject('Claim: ')).toBeUndefined();
  });
});

describe('descriptiveAttachmentName', () => {
  it('embeds surname-first patient and claim into the filename', () => {
    expect(descriptiveAttachmentName(REAL_SUBJECT, ORIGINAL)).toBe(
      `Reichenbach-Graham_ClaimP2222756868_${ORIGINAL}`,
    );
  });

  it('falls back to the original filename when nothing is parseable', () => {
    expect(descriptiveAttachmentName('Watson', 'letter.pdf')).toBe('letter.pdf');
    expect(descriptiveAttachmentName('', 'letter.pdf')).toBe('letter.pdf');
  });

  it('uses only the claim when no patient name is parseable', () => {
    expect(descriptiveAttachmentName('Nursing Claim:10000003194', 'x.docx')).toBe(
      'Claim10000003194_x.docx',
    );
  });

  it('uses only the patient when no claim is present', () => {
    expect(descriptiveAttachmentName('Mrs Jane Smith - Claim: ', 'x.docx')).toBe(
      'Smith-Jane_x.docx',
    );
  });

  it('strips any leading path from the original filename', () => {
    expect(descriptiveAttachmentName('Watson', 'C:/tmp/letter.pdf')).toBe('letter.pdf');
  });

  it('caps overly long names while preserving the extension', () => {
    const longSubject = `Mr ${'a'.repeat(200)} Zzz - Claim:P1`;
    const out = descriptiveAttachmentName(longSubject, 'x.docx');
    expect(out.length).toBeLessThanOrEqual(150);
    expect(out.endsWith('.docx')).toBe(true);
  });
});

describe('limitFileNameLength', () => {
  it('leaves short names untouched', () => {
    expect(limitFileNameLength('short.pdf', 150)).toBe('short.pdf');
  });

  it('truncates the stem but keeps the extension', () => {
    const out = limitFileNameLength(`${'a'.repeat(300)}.docx`, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith('.docx')).toBe(true);
  });
});
