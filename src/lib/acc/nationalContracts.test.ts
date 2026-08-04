import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildContractsFromParsedSchedules,
  buildNationalScheduleContracts,
  hasNationalScheduleContract,
  NATIONAL_SCHEDULE_MARKER_KEY,
} from './nationalContracts';
import { parseCotrRateSheet, parsePricedCodeTable } from './scheduleParser';
import { COTR_ALL_CODES, NURSING_CODES } from './knownCodes';
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
