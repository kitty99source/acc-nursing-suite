import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildContractsFromParsedSchedules,
  buildNationalScheduleContracts,
  hasNationalScheduleContract,
  NATIONAL_SCHEDULE_MARKER_KEY,
  parseAlliedHealthText,
  parseElectiveSurgeryText,
  parseNursingText,
} from './nationalContracts';
import { parseCotrRateSheet, parsePricedCodeTable } from './scheduleParser';
import {
  ALLIED_HEALTH_CODES,
  COTR_ALL_CODES,
  ELECTIVE_SURGERY_CODES,
  ELECTIVE_SURGERY_NONCORE_CODES,
  NURSING_CODES,
} from './knownCodes';
import type { Contract } from '../../types';

const RAW_DIR = path.join(__dirname, '../../../docs/research/raw-text');

function loadRawText(): Record<string, string> {
  const files = [
    'nursing-service-schedule',
    'allied-health-services-service-schedule',
    'elective-surgery-service-schedule',
    'ACC1523-Specified-treatment-provider-costs',
  ];
  const out: Record<string, string> = {};
  for (const f of files) {
    out[f] = fs.readFileSync(path.join(RAW_DIR, `${f}.txt`), 'utf-8');
  }
  return out;
}

describe('buildNationalScheduleContracts', () => {
  it('builds one Contract per ingested schedule, from the real raw text', () => {
    const contracts = buildNationalScheduleContracts(loadRawText());
    expect(contracts).toHaveLength(4);
    const providerNames = contracts.map((c) => c.providerName);
    expect(providerNames.some((n) => n.includes('Nursing'))).toBe(true);
    expect(providerNames.some((n) => n.includes('Allied Health'))).toBe(true);
    expect(providerNames.some((n) => n.includes('Elective Surgery'))).toBe(true);
    expect(providerNames.some((n) => n.includes('Cost of Treatment Regulations'))).toBe(true);
  });

  it('every seeded contract is clearly labelled as a national published schedule, not an org-specific contract', () => {
    const contracts = buildNationalScheduleContracts(loadRawText());
    for (const c of contracts) {
      expect(c.notes).toContain('ACC NATIONAL PUBLISHED SCHEDULE');
      expect(c.notes).toContain('NOT this organisation');
      expect(c.customFields?.[NATIONAL_SCHEDULE_MARKER_KEY]).toBeTruthy();
    }
  });

  it('populates real rate tables with real prices (not placeholders) from the actual schedule text', () => {
    const contracts = buildNationalScheduleContracts(loadRawText());
    const nursing = contracts.find((c) => c.providerName.includes('Nursing'))!;
    const ns01 = nursing.rateTable.find((r) => r.serviceCode === 'NS01');
    expect(ns01?.rate).toBe(525.4);

    const allied = contracts.find((c) => c.providerName.includes('Allied Health'))!;
    const pt01 = allied.rateTable.find((r) => r.serviceCode === 'PT01');
    expect(pt01?.rate).toBe(65.97);

    const cotr = contracts.find((c) => c.providerName.includes('Cost of Treatment Regulations'))!;
    const acu1 = cotr.rateTable.find((r) => r.serviceCode === 'ACU1');
    // Flat rate (incl. GST) is used as the headline rate when both flat and hourly options exist.
    expect(acu1?.rate).toBe(31.53);
    expect(acu1?.description).toContain('79.34');
  });

  it('only includes rate rows that actually resolved to a real numeric price', () => {
    const contracts = buildNationalScheduleContracts(loadRawText());
    for (const c of contracts) {
      for (const r of c.rateTable) {
        expect(typeof r.rate).toBe('number');
        expect(Number.isFinite(r.rate)).toBe(true);
      }
    }
  });

  it('is a pure function of its input — missing a doc key simply omits that contract', () => {
    const contracts = buildNationalScheduleContracts({ 'nursing-service-schedule': loadRawText()['nursing-service-schedule'] });
    expect(contracts).toHaveLength(1);
  });
});

describe('buildContractsFromParsedSchedules', () => {
  it('produces the same Contract shape as the raw-text path, given already-parsed items (the runtime UI path)', () => {
    const raw = loadRawText();
    const nursingItems = parsePricedCodeTable(raw['nursing-service-schedule'], NURSING_CODES);
    const cotrItems = parseCotrRateSheet(raw['ACC1523-Specified-treatment-provider-costs'], COTR_ALL_CODES);

    const contracts = buildContractsFromParsedSchedules([
      { sourceDocId: 'nursing-service-schedule', items: nursingItems },
      { sourceDocId: 'ACC1523-Specified-treatment-provider-costs', items: cotrItems },
    ]);

    expect(contracts).toHaveLength(2);
    const nursing = contracts.find((c) => c.providerName.includes('Nursing'))!;
    expect(nursing.rateTable.find((r) => r.serviceCode === 'NS01')?.rate).toBe(525.4);
    expect(nursing.customFields?.[NATIONAL_SCHEDULE_MARKER_KEY]).toBe('nursing-service-schedule');
  });

  it('ignores an unrecognised sourceDocId rather than throwing', () => {
    const contracts = buildContractsFromParsedSchedules([{ sourceDocId: 'not-a-real-doc', items: [] }]);
    expect(contracts).toHaveLength(0);
  });
});

describe('parseElectiveSurgeryText — full Elective Surgery Service Schedule extraction', () => {
  const raw = loadRawText()['elective-surgery-service-schedule'];
  const items = parseElectiveSurgeryText(raw);
  const byCode = Object.fromEntries(items.map((i) => [i.code, i]));

  it('extracts the FULL real code list — every Table 1 (core) + Table 2 (non-core) code, not a curated subset', () => {
    // 558 real Table 1 "Core Service Items and Prices" procedure codes + 18 real Table 2
    // "Non-core Service Items and Prices" items = 576 total. This is the genuine count of every
    // exact-match table-row line found in the real document text (see knownCodes.ts's doc comment
    // for the extraction method) — not an estimate.
    expect(ELECTIVE_SURGERY_CODES).toHaveLength(558);
    expect(ELECTIVE_SURGERY_NONCORE_CODES).toHaveLength(18);
    expect(items).toHaveLength(576);
    // No duplicates, and no known code silently failed to produce a row.
    const codes = items.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.sort()).toEqual([...ELECTIVE_SURGERY_CODES, ...ELECTIVE_SURGERY_NONCORE_CODES].sort());
  });

  it('every row resolved to either a real numeric price or a confirmed actual-cost flag — nothing silently blank', () => {
    const unresolved = items.filter((i) => i.price === null && !i.actualCost);
    expect(unresolved).toEqual([]);
  });

  // Spot-checks across every body-region family the schedule covers (not just the
  // previously-curated 3D-imaging/ankle-foot-arthrodesis subset), each verified against the
  // real raw text at docs/research/raw-text/elective-surgery-service-schedule.txt.
  it('spot-checks real prices from the previously-covered subset (ankle/foot + 3D imaging)', () => {
    expect(byCode['3DIMAGE1'].price).toBe(1390.6);
    expect(byCode.AFT100.price).toBe(11532.74);
    expect(byCode.AFT150.price).toBe(6801.39);
  });

  it('spot-checks real prices from knee, hip, and shoulder families (previously NOT structured)', () => {
    expect(byCode.KNE81.price).toBe(12522.51);
    expect(byCode.KNE81.description).toContain('Primary Knee ACL reconstruction');
    expect(byCode.HIT50A.price).toBe(11689.06);
    expect(byCode.HIT50A.description).toContain('Hip Arthroscopy');
    expect(byCode.SHU50.price).toBe(7318.61);
    expect(byCode.SHU50.description).toContain('Shoulder Arthroscopic Surgery');
  });

  it('spot-checks real prices from spine, wrist/hand, urology, ophthalmology, and general-orthopaedic families', () => {
    expect(byCode.SPN300.price).toBe(27917.55);
    expect(byCode.SPN300.description).toContain('Occipito');
    expect(byCode.WAH150.price).toBe(11594.03);
    expect(byCode.URL15.price).toBe(10992.15);
    expect(byCode.OPT101.price).toBe(5345.58);
    expect(byCode.OPT101.description).toContain('Cataract Extraction');
    expect(byCode.GOP20.price).toBe(4637.85);
  });

  it('spot-checks Table 2 non-core items (theatre time / ward stay / 2nd surgeon), a separate real table from Table 1', () => {
    expect(byCode.ESRNC.price).toBe(1587.64);
    expect(byCode.ESR01.price).toBe(57.73);
    expect(byCode.ESR05.price).toBe(894.68);
    expect(byCode.ESR09.price).toBe(32.49);
    expect(byCode.ESR09.description).toContain('2nd surgeon');
    expect(byCode.ESR18.price).toBe(159.82);
  });

  it('correctly flags genuine "no fixed price, billed at cost" items rather than fabricating a number', () => {
    expect(byCode.ESR04.actualCost).toBe(true);
    expect(byCode.ESR04.price).toBeNull();
    expect(byCode.URABASKT.actualCost).toBe(true);
    expect(byCode.URAGRASP.actualCost).toBe(true);
    // ESR12's one dollar figure is a deduction ("actual cost LESS $799.70 already included in
    // ESRNC"), not a fixed per-unit price — correctly captured as a cost cap, not a price.
    expect(byCode.ESR12.price).toBeNull();
    expect(byCode.ESR12.costCapPrice).toBe(799.7);
  });

  it('does not treat the mid-description reference to "the ESR09 code" inside a Table 1 procedure as a false Table 1 row', () => {
    // ESR09 is a real Table 2 code; ELECTIVE_SURGERY_CODES (Table 1) deliberately excludes it.
    expect(ELECTIVE_SURGERY_CODES).not.toContain('ESR09');
    // Its single real row (from Table 2) still has the correct real price, not corrupted by the
    // earlier false in-text mention.
    expect(byCode.ESR09.price).toBe(32.49);
  });

  it('preserves real gaps in ACC\'s own code numbering rather than fabricating a code to fill them', () => {
    expect(byCode.AFT188).toBeUndefined(); // confirmed absent from the real document
    expect(byCode.ESR15).toBeUndefined(); // confirmed absent from the real document
  });
});

describe('parseNursingText — NSAC (last known code) row-boundary fix', () => {
  const raw = loadRawText()['nursing-service-schedule'];
  const items = parseNursingText(raw);
  const byCode = Object.fromEntries(items.map((i) => [i.code, i]));

  it('extracts every known Nursing code exactly once, with no duplicates', () => {
    expect(items).toHaveLength(NURSING_CODES.length);
    const codes = items.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.sort()).toEqual([...NURSING_CODES].sort());
  });

  it('bounds NSAC (the LAST known code) to its own real row, not the rest of the document', () => {
    // Before the fix, NSAC's unbounded search swallowed everything after it to the end of the
    // whole 1997-line raw document as its own description text (~62KB single item), because it is
    // the last code in NURSING_CODES and the old parse ran parsePricedCodeTable directly against
    // the whole raw text with no "Table 2 -" (Relationship Management, an unrelated section) cutoff.
    expect(byCode.NSAC).toBeDefined();
    expect(byCode.NSAC.description.length).toBeLessThan(2000);
    expect(byCode.NSAC.description).toContain('Accommodation');
    expect(byCode.NSAC.description).toContain('Part B, clause 15.5');
    // Its real cost-cap price is still captured correctly.
    expect(byCode.NSAC.actualCost).toBe(true);
    expect(byCode.NSAC.costCapPrice).toBe(282.97);
    // Must NOT have bled into the unrelated "Table 2 - Relationship Management" section's content.
    expect(byCode.NSAC.description).not.toContain('Recovery Team');
    expect(byCode.NSAC.description).not.toContain('Engagement and Performance Manager');
  });

  it('every other code is unaffected by the boundary fix (real prices still resolve)', () => {
    expect(byCode.NS01.price).toBe(525.4);
    expect(byCode.NST6.actualCost).toBe(true);
  });
});

describe('parseAlliedHealthText — PP2T (last known code) row-boundary fix', () => {
  const raw = loadRawText()['allied-health-services-service-schedule'];
  const items = parseAlliedHealthText(raw);
  const byCode = Object.fromEntries(items.map((i) => [i.code, i]));

  it('extracts every known Allied Health code exactly once, with no duplicates', () => {
    expect(items).toHaveLength(ALLIED_HEALTH_CODES.length);
    const codes = items.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.sort()).toEqual([...ALLIED_HEALTH_CODES].sort());
  });

  it('bounds PP2T (the LAST known code, last row of Table 7) to its own real row, not the rest of the document', () => {
    // Before the fix, PP2T's unbounded search swallowed everything after it to the end of the
    // whole document as its own description text (~62KB single item), because it is the last
    // code that occurs in document order and the old parse ran parsePricedCodeTable directly
    // against the whole raw text with no "Table 8" (Relationship Management, an unrelated
    // section) cutoff.
    expect(byCode.PP2T).toBeDefined();
    expect(byCode.PP2T.description.length).toBeLessThan(2000);
    expect(byCode.PP2T.description).toContain('Pelvic');
    expect(byCode.PP2T.description).toContain('MBI');
    expect(byCode.PP2T.price).toBe(124.25);
    // Must NOT have bled into the unrelated "Table 8 - Relationship Management" section's content.
    expect(byCode.PP2T.description).not.toContain('Recovery Team');
    expect(byCode.PP2T.description).not.toContain('Engagement');
  });

  it('every other code is unaffected by the boundary fix (real prices still resolve)', () => {
    expect(byCode.PT01.price).toBe(65.97);
    expect(byCode.PTP4.price).toBeDefined();
  });
});

describe('hasNationalScheduleContract', () => {
  it('detects an already-seeded contract by its source marker so seeding stays idempotent', () => {
    const existing: Contract[] = [
      {
        id: '1',
        providerName: 'ACC — Nursing Services (National Service Schedule)',
        effectiveFrom: '2025-03-01',
        serviceCodesCovered: [],
        rateTable: [],
        notes: '',
        customFields: { [NATIONAL_SCHEDULE_MARKER_KEY]: 'nursing-service-schedule' },
      },
    ];
    expect(hasNationalScheduleContract(existing, 'nursing-service-schedule')).toBe(true);
    expect(hasNationalScheduleContract(existing, 'allied-health-services-service-schedule')).toBe(false);
  });

  it('returns false for an empty contract list', () => {
    expect(hasNationalScheduleContract([], 'nursing-service-schedule')).toBe(false);
  });
});
