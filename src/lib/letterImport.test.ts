import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  extractPdfText,
  extractWordText,
  parseApprovalLetter,
  parseDeclineLetter,
  parseLetterFile,
  parseLetterFromText,
  assignRecordStatus,
  normalizeClaimNumber,
  classifyLetter,
  buildLetterIssues,
  letterKindToDocumentKind,
  sniffDocumentKindFromFileName,
  isDuplicateLetterImport,
  resolveLetterAutoCommit,
} from './letterImport';
import { emptyData } from './sampleData';
import { LETTER_CORPUS } from './fixtures/letters/corpus';
import type { AppData } from '../types';

const dir = dirname(fileURLToPath(import.meta.url));
const loadPdf = (name: string) => new Uint8Array(readFileSync(join(dir, 'fixtures', name)));
const loadDocx = (name: string) => new Uint8Array(readFileSync(join(dir, 'fixtures', name)));
const loadCorpusText = (file: string) =>
  readFileSync(join(dir, 'fixtures', 'letters', file), 'utf8');

/** Stable, snapshot-friendly view of a parse result (drops volatile rawText). */
function corpusParseSnapshot(text: string) {
  const kind = classifyLetter(text);
  if (kind === 'approval') {
    const parsed = parseApprovalLetter(text);
    return {
      kind,
      claimNumber: normalizeClaimNumber(parsed.claim.claimNumber),
      nhi: parsed.patient.nhi,
      patientName: parsed.patient.name,
      poNumber: parsed.claim.poNumber,
      serviceRowCodes: [...new Set(parsed.serviceRows.map((r) => r.serviceCode))].sort(),
      serviceRowCount: parsed.serviceRows.length,
      packageRowCodes: [...new Set(parsed.packageRows.map((r) => r.serviceCode))].sort(),
    };
  }
  if (kind === 'decline') {
    const parsed = parseDeclineLetter(text);
    return {
      kind,
      claimNumber: normalizeClaimNumber(parsed.claim.claimNumber),
      nhi: parsed.patient.nhi,
      patientName: parsed.patient.name,
      serviceRequested: parsed.serviceRequested,
      reasonPresent: !!parsed.reason?.trim(),
      alternateClaimCount: parsed.alternateClaimNumbers.length,
    };
  }
  return { kind };
}

describe('letterImport — PDF extract', () => {
  it('extracts text from approval fixture', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    expect(text.length).toBeGreaterThan(200);
    expect(classifyLetter(text)).toBe('approval');
  });

  it('extracts text from decline fixture', async () => {
    const text = await extractPdfText(loadPdf('decline-template.pdf'));
    expect(text.length).toBeGreaterThan(100);
    expect(classifyLetter(text)).toBe('decline');
  });
});

describe('letterImport — Word (.docx) extract', () => {
  it('extracts text from approval Word fixture', async () => {
    const text = await extractWordText(loadDocx('approval-template.docx'));
    expect(text.length).toBeGreaterThan(200);
    expect(classifyLetter(text)).toBe('approval');
    expect(text).toMatch(/NUR02/i);
  });

  it('extractWordText passes arrayBuffer for browser mammoth bundle', async () => {
    const bytes = loadDocx('approval-template.docx');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer, arrayBuffer: buffer });
    expect(value.replace(/\s+/g, ' ')).toMatch(/NUR02/i);
  });

  it('parses same claim/PO/NHI/rows as PDF approval template', async () => {
    const [wordText, pdfText] = await Promise.all([
      extractWordText(loadDocx('approval-template.docx')),
      extractPdfText(loadPdf('approval-template.pdf')),
    ]);
    const wordParsed = parseApprovalLetter(wordText);
    const pdfParsed = parseApprovalLetter(pdfText);

    expect(normalizeClaimNumber(wordParsed.claim.claimNumber)).toBe('10000000149');
    expect(normalizeClaimNumber(pdfParsed.claim.claimNumber)).toBe('10000000149');
    expect(wordParsed.claim.poNumber).toBe(pdfParsed.claim.poNumber);
    expect(wordParsed.patient.nhi).toBe(pdfParsed.patient.nhi);
    expect(wordParsed.serviceRows.length).toBeGreaterThanOrEqual(6);
    expect(wordParsed.serviceRows.every((r) => r.serviceCode === 'NS04')).toBe(true);
    expect(wordParsed.packageRows.some((r) => r.serviceCode === 'NS03')).toBe(true);
  });
});

describe('letterImport — parseLetterFile (.docx)', () => {
  it('routes Word files through mammoth and parses approval', async () => {
    const bytes = loadDocx('approval-template.docx');
    const file = {
      name: 'approval-template.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Blob;
    const result = await parseLetterFile(file, emptyData());
    expect(result.kind).toBe('approval');
    expect(result.parsed?.kind).toBe('approval');
    expect(normalizeClaimNumber(result.parsed?.claim.claimNumber)).toBe('10000000149');
    expect(result.usedOcr).toBe(false);
  });
});

describe('letterImport — approval parse', () => {
  it('parses claim, PO, and NS04 rows from approval template', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const parsed = parseApprovalLetter(text);
    expect(normalizeClaimNumber(parsed.claim.claimNumber)).toBe('10000000149');
    expect(parsed.claim.poNumber).toBe('15089011');
    expect(parsed.patient.nhi).toBe('ABC1234');
    expect(parsed.serviceRows.length).toBeGreaterThanOrEqual(6);
    expect(parsed.serviceRows.every((r) => r.serviceCode === 'NS04')).toBe(true);
    expect(parsed.packageRows.some((r) => r.serviceCode === 'NS03')).toBe(true);
  });

  it('marks latest NS04 row as current', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const parsed = parseApprovalLetter(text);
    const rows = assignRecordStatus(parsed.serviceRows);
    const current = rows.filter((r) => r.recordStatus === 'current');
    expect(current).toHaveLength(1);
    expect(current[0].approvalEndDate).toBe(
      rows.reduce((max, r) => (r.approvalEndDate > max ? r.approvalEndDate : max), ''),
    );
  });
});

describe('letterImport — decline parse', () => {
  it('parses decline reason and lowers confidence on alternate claim numbers', async () => {
    const text = await extractPdfText(loadPdf('decline-template.pdf'));
    const parsed = parseDeclineLetter(text);
    expect(parsed.claim.claimNumber).toBe('10000460000');
    expect(parsed.patient.name).toBe('Mille Butter');
    expect(parsed.serviceRequested).toBe('Extended Nursing');
    expect(parsed.reason).toMatch(/missing nursing consultation notes/i);
    expect(parsed.alternateClaimNumbers.length).toBeGreaterThan(0);

    const data = emptyData();
    const result = await parseLetterFromText(text, data);
    expect(result.kind).toBe('decline');
    expect(result.autoCommit).toBe(false);
    expect(result.blockers).toHaveLength(0);
    expect(result.issues.some((i) => i.id === 'claim-numbers')).toBe(true);
  });

  it('new-patient decline issues are warnings, not save blockers', async () => {
    const text = await extractPdfText(loadPdf('decline-template.pdf'));
    const result = await parseLetterFromText(text, emptyData());
    const noMatch = result.issues.find((i) => i.id === 'no-match');
    const missingNhi = result.issues.find((i) => i.id === 'missing-nhi');

    expect(noMatch?.blocking).toBe(false);
    if (missingNhi) expect(missingNhi.blocking).toBe(false);

    const openBlocking = result.issues.filter((issue) => {
      if (issue.blocking === false) return false;
      if (issue.id === 'claim-numbers') {
        return !issue.alternatives?.includes('10000460000');
      }
      if (issue.field === 'declineReason') {
        return !(result.parsed?.kind === 'decline' && result.parsed.reason?.trim());
      }
      if (issue.field === 'claimNumber') {
        return !result.parsed?.claim.claimNumber?.trim();
      }
      if (issue.field === 'patientName') {
        return !result.parsed?.patient.name?.trim();
      }
      return true;
    });
    expect(openBlocking).toHaveLength(0);
  });

  it('trims client name and service from flattened single-line decline text', () => {
    const text =
      'Client name Mille Butter Postal address 13 Money street Phone number 02 2 10000 requested the following service: • Extended Nursing After careful consideration, we are unable to approve the request.';
    const parsed = parseDeclineLetter(text);
    expect(parsed.patient.name).toBe('Mille Butter');
    expect(parsed.serviceRequested).toBe('Extended Nursing');
  });
});

describe('letterImport — matching', () => {
  it('matches existing claim by NHI and claim number', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const data: AppData = {
      ...emptyData(),
      patients: [{ id: 'p1', name: 'George Bellingham', nhi: 'ABC1234', dob: '', notes: '' }],
      claims: [
        {
          id: 'c1',
          patientId: 'p1',
          claimNumber: '10000000149',
          acc45Number: 'YN65488',
          poNumber: '',
          injuryDescription: '',
          type: 'original',
          status: 'active',
          day1Date: '2024-02-19',
        },
      ],
    };
    const result = await parseLetterFromText(text, data);
    expect(result.match.claimId).toBe('c1');
    expect(result.match.patientId).toBe('p1');
  });
  it('does not block auto-commit on name mismatch when patient+claim matched', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const data: AppData = {
      ...emptyData(),
      patients: [{ id: 'p1', name: 'George Bellingham', nhi: 'ABC1234', dob: '', notes: '' }],
      claims: [
        {
          id: 'c1',
          patientId: 'p1',
          claimNumber: '10000000149',
          acc45Number: 'YN65488',
          poNumber: '15089011',
          injuryDescription: '',
          type: 'original',
          status: 'active',
          day1Date: '2024-02-19',
        },
      ],
    };
    const result = await parseLetterFromText(text, data);
    expect(result.match.claimId).toBe('c1');
    const nameIssue = result.issues.find((i) => i.id === 'name-mismatch');
    expect(nameIssue?.blocking).toBe(false);
    expect(result.blockers.some((b) => b.includes('Client name'))).toBe(false);
  });

  it('does not auto-commit in production mode (default)', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const data: AppData = {
      ...emptyData(),
      settings: { ...emptyData().settings, productionMode: true, letterImportAutoCommit: true },
      patients: [{ id: 'p1', name: 'Andrew Flannery', nhi: 'ABC1234', dob: '', notes: '' }],
      claims: [
        {
          id: 'c1',
          patientId: 'p1',
          claimNumber: '10000000149',
          acc45Number: 'YN65488',
          poNumber: '15089011',
          injuryDescription: '',
          type: 'original',
          status: 'active',
          day1Date: '2024-02-19',
        },
      ],
    };
    const result = await parseLetterFromText(text, data);
    expect(result.autoCommit).toBe(false);
  });

  it('allows auto-commit only when dev mode and flag enabled', () => {
    const parsed = parseApprovalLetter('NUR02 approval NS04');
    parsed.serviceRows = [{ serviceCode: 'NS04', approvalStartDate: '2024-01-01', approvalEndDate: '2024-06-01', approvedHoursOrConsults: 1 }];
    const prodSettings = { ...emptyData().settings, productionMode: true, letterImportAutoCommit: true };
    const devSettings = { ...emptyData().settings, productionMode: false, letterImportAutoCommit: true };
    const scored = { overallConfidence: 100, blockers: [] as string[] };
    const match = { ambiguous: false, claimId: 'c1' };
    expect(resolveLetterAutoCommit(prodSettings, scored, match, parsed)).toBe(false);
    expect(resolveLetterAutoCommit(devSettings, scored, match, parsed)).toBe(true);
    expect(resolveLetterAutoCommit(devSettings, { overallConfidence: 99, blockers: [] }, match, parsed)).toBe(false);
  });
});

describe('letterImport — issues', () => {
  it('surfaces name mismatch with both names as alternatives', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const parsed = parseApprovalLetter(text);
    const result = await parseLetterFromText(text, emptyData());
    const nameIssue = result.issues.find((i) => i.id === 'name-mismatch');
    expect(nameIssue?.field).toBe('patientName');
    expect(nameIssue?.alternatives).toContain('George Bellingham');
    expect(nameIssue?.alternatives).toContain('Andrew Flannery');
    expect(buildLetterIssues(parsed, result.match, result.blockers).length).toBeGreaterThan(0);
  });

  it('treats no-match as warning (not blocker) for new patient approval', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const result = await parseLetterFromText(text, emptyData());
    const noMatch = result.issues.find((i) => i.id === 'no-match');
    expect(noMatch).toBeDefined();
    expect(noMatch?.blocking).toBe(false);
  });
});

describe('letterImport — document kind', () => {
  it('maps letter kinds to document kinds', () => {
    expect(letterKindToDocumentKind('approval')).toBe('acc-approval-letter');
    expect(letterKindToDocumentKind('decline')).toBe('acc-decline-letter');
    expect(letterKindToDocumentKind('unknown')).toBe('other');
  });

  it('sniffs kind from common filenames', () => {
    expect(sniffDocumentKindFromFileName('Approval template.pdf')).toBe('acc-approval-letter');
    expect(sniffDocumentKindFromFileName('DEcline template.pdf')).toBe('acc-decline-letter');
    expect(sniffDocumentKindFromFileName('invoice.pdf')).toBeNull();
  });
});

describe('letterImport — duplicate detection', () => {
  it('does not flag same filename with different size as duplicate', async () => {
    const data = emptyData();
    data.documents = [
      {
        id: 'doc1',
        claimId: 'c1',
        kind: 'acc-decline-letter',
        fileName: 'decline-template.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        addedDate: '2026-01-01',
      },
    ];
    const file = new File([new Uint8Array(500)], 'decline-template.pdf', { type: 'application/pdf' });
    const dup = await isDuplicateLetterImport(data, 'c1', file, async () => undefined);
    expect(dup).toBe(false);
  });

  it('flags same claim + name + size + hash as duplicate', async () => {
    const bytes = loadPdf('decline-template.pdf');
    const file = new File([bytes], 'decline-template.pdf', { type: 'application/pdf' });
    const data = emptyData();
    data.documents = [
      {
        id: 'doc1',
        claimId: 'c1',
        kind: 'acc-decline-letter',
        fileName: 'decline-template.pdf',
        mimeType: 'application/pdf',
        sizeBytes: bytes.length,
        addedDate: '2026-01-01',
      },
    ];
    expect(file.size).toBe(bytes.length);
    const dup = await isDuplicateLetterImport(data, 'c1', file, async () => {
      return new File([bytes], 'decline-template.pdf', { type: 'application/pdf' });
    });
    expect(dup).toBe(true);
  });
});

// ============================================================================
// P5-001 — synthetic letter corpus regression (text-layer subset).
// ============================================================================
describe('letterImport — synthetic corpus (P5-001)', () => {
  it('exposes a mix of PDF and .docx approval/decline letters', () => {
    expect(LETTER_CORPUS.length).toBeGreaterThanOrEqual(8);
    expect(LETTER_CORPUS.some((c) => c.format === 'pdf')).toBe(true);
    expect(LETTER_CORPUS.some((c) => c.format === 'docx')).toBe(true);
    expect(LETTER_CORPUS.some((c) => c.expect.kind === 'approval')).toBe(true);
    expect(LETTER_CORPUS.some((c) => c.expect.kind === 'decline')).toBe(true);
    const ids = LETTER_CORPUS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const entry of LETTER_CORPUS) {
    describe(entry.id, () => {
      it('classifies to the expected letter kind', () => {
        expect(classifyLetter(loadCorpusText(entry.file))).toBe(entry.expect.kind);
      });

      it('parses to the locked snapshot', () => {
        const snapshot = corpusParseSnapshot(loadCorpusText(entry.file));
        expect(snapshot).toMatchSnapshot();
      });

      it('extracts the expected key fields', async () => {
        const text = loadCorpusText(entry.file);
        const exp = entry.expect;

        if (exp.kind === 'approval') {
          const parsed = parseApprovalLetter(text);
          expect(normalizeClaimNumber(parsed.claim.claimNumber)).toBe(exp.claimNumber);
          if (exp.nhi) expect(parsed.patient.nhi).toBe(exp.nhi);
          if (exp.patientName) expect(parsed.patient.name).toBe(exp.patientName);
          if (exp.serviceRowCount !== undefined) {
            expect(parsed.serviceRows.length).toBe(exp.serviceRowCount);
          }
          if (exp.serviceRowCodes) {
            expect([...new Set(parsed.serviceRows.map((r) => r.serviceCode))].sort()).toEqual(
              [...exp.serviceRowCodes].sort(),
            );
          }
          if (exp.packageRowCodes) {
            for (const code of exp.packageRowCodes) {
              expect(parsed.packageRows.some((r) => r.serviceCode === code)).toBe(true);
            }
          }
        } else if (exp.kind === 'decline') {
          const parsed = parseDeclineLetter(text);
          expect(parsed.claim.claimNumber).toBe(exp.claimNumber);
          if (exp.nhi) expect(parsed.patient.nhi).toBe(exp.nhi);
          if (exp.patientName) expect(parsed.patient.name).toBe(exp.patientName);
          if (exp.serviceRequested) expect(parsed.serviceRequested).toBe(exp.serviceRequested);
          if (exp.reasonMatch) {
            expect(parsed.reason ?? '').toMatch(new RegExp(exp.reasonMatch, 'i'));
          }
          if (exp.reasonMissing) expect(parsed.reason?.trim()).toBeFalsy();
          if (exp.hasAlternateClaims) {
            expect(parsed.alternateClaimNumbers.length).toBeGreaterThan(0);
          }
        }
      });

      it('produces the expected scoring/issue outcome', async () => {
        const text = loadCorpusText(entry.file);
        const result = await parseLetterFromText(text, emptyData());
        const exp = entry.expect;
        expect(result.kind).toBe(exp.kind);
        // Synthetic corpus never carries the dev auto-commit flag → always human-reviewed.
        expect(result.autoCommit).toBe(false);
        if (exp.expectBlockers) {
          expect(result.blockers.length).toBeGreaterThan(0);
        }
        if (exp.expectNameMismatch) {
          expect(result.issues.some((i) => i.id === 'name-mismatch')).toBe(true);
        }
      });
    });
  }
});
