import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseCotrRateSheet, parsePricedCodeTable } from './scheduleParser';
import { COTR_ALL_CODES, NURSING_CODES } from './knownCodes';

// Synthetic sample mirroring the REAL Nursing Services Service Schedule Table 1
// layout (see docs/research/raw-text/nursing-service-schedule.txt) — same
// "code alone on a line, word-wrapped description, $price, pricing unit"
// structure, but a short made-up excerpt so the test doesn't depend on the
// full real 34-page document.
const SYNTHETIC_NURSING_TABLE = `
Nursing Services Service Schedule 1 July 2026                Page 2 of 34
3.
SERVICE ITEMS AND PRICES (PART B, CLAUSE 13)
Table 1 - Service Items and Prices
Service
Item Code
Service Item
Description
NS01
Short
Term
Nursing Package
As described in Part B, clause
5.8
Travel costs are included in the
packaged price and cannot be
invoiced separately
$525.40
Package
Price
NS04
Extended Nursing
As described in Part B, clause
5.11
Travel costs are included in the
service item price and cannot
be invoiced separately
$111.88
Per
consultation
NS10
Medical
Consumables
per consultation
As described in Part B, clause
6.3
Actual and
reasonable
cost
Actual
and
reasonable
cost
NSAC
Accommodation
Payable in accordance with
Part B, clause 15.5
Actual and
reasonable
cost
to
a
maximum
of $282.97
Per night
`;

describe('parsePricedCodeTable', () => {
  it('extracts code, price and pricing unit from a normal priced row', () => {
    const items = parsePricedCodeTable(SYNTHETIC_NURSING_TABLE, NURSING_CODES);
    const ns01 = items.find((i) => i.code === 'NS01');
    expect(ns01).toBeDefined();
    expect(ns01!.price).toBe(525.4);
    expect(ns01!.actualCost).toBe(false);
    expect(ns01!.pricingUnit).toBe('Package Price');
    expect(ns01!.description).toContain('Short Term Nursing Package');
  });

  it('extracts a second row correctly (segment boundaries do not bleed into each other)', () => {
    const items = parsePricedCodeTable(SYNTHETIC_NURSING_TABLE, NURSING_CODES);
    const ns04 = items.find((i) => i.code === 'NS04');
    expect(ns04!.price).toBe(111.88);
    expect(ns04!.pricingUnit).toBe('Per consultation');
    // Must not have picked up NS01's or NS10's text.
    expect(ns04!.description).not.toContain('Package');
  });

  it('marks "actual and reasonable cost" rows as such, with no numeric price', () => {
    const items = parsePricedCodeTable(SYNTHETIC_NURSING_TABLE, NURSING_CODES);
    const ns10 = items.find((i) => i.code === 'NS10');
    expect(ns10!.price).toBeNull();
    expect(ns10!.actualCost).toBe(true);
  });

  it('also recognises the plain "Actual Costs" phrasing (no "and reasonable") used by some schedules', () => {
    const items = parsePricedCodeTable('ESR04 \nAnaesthetic other \nActual Costs \n', ['ESR04']);
    const esr04 = items.find((i) => i.code === 'ESR04')!;
    expect(esr04.actualCost).toBe(true);
    expect(esr04.price).toBeNull();
  });

  it('extracts a dollar cost-cap alongside "actual and reasonable cost" when present', () => {
    const items = parsePricedCodeTable(SYNTHETIC_NURSING_TABLE, NURSING_CODES);
    const nsac = items.find((i) => i.code === 'NSAC');
    expect(nsac!.actualCost).toBe(true);
    expect(nsac!.costCapPrice).toBe(282.97);
  });

  it('never fabricates a row for a code that is not present in the text', () => {
    const items = parsePricedCodeTable(SYNTHETIC_NURSING_TABLE, NURSING_CODES);
    expect(items.find((i) => i.code === 'NS02')).toBeUndefined();
    expect(items).toHaveLength(4);
  });

  it('does not treat a code mentioned only in narrative prose as a table row', () => {
    const withNarrative =
      SYNTHETIC_NURSING_TABLE + '\nThe Supplier may invoice ACC under Extended Nursing (NS04) from the 26th consult.\n';
    const items = parsePricedCodeTable(withNarrative, NURSING_CODES);
    // Still exactly one NS04 row (the real table row), not a second spurious one from the prose
    // mention — "NS04" only triggers a NEW row boundary when the trimmed line is EXACTLY "NS04".
    expect(items.filter((i) => i.code === 'NS04')).toHaveLength(1);
  });

  it('parses the REAL Nursing Services Service Schedule fixture and finds all known codes with plausible prices', () => {
    const raw = fs.readFileSync(
      path.join(__dirname, '../../../docs/research/raw-text/nursing-service-schedule.txt'),
      'utf-8',
    );
    const items = parsePricedCodeTable(raw, NURSING_CODES);
    const byCode = Object.fromEntries(items.map((i) => [i.code, i]));
    expect(byCode.NS01.price).toBe(525.4);
    expect(byCode.NS02.price).toBe(1194.25);
    expect(byCode.NS03.price).toBe(2316.38);
    expect(byCode.NS05.price).toBe(100.55);
    expect(byCode.NS20.price).toBe(603.62);
    expect(byCode.NSTD10.price).toBe(0.82);
    expect(byCode.NS10.actualCost).toBe(true);
    // Every known code should have produced exactly one row from the real document.
    expect(items).toHaveLength(NURSING_CODES.length);
  });
});

// Synthetic sample mirroring ACC1523's real table layout (see
// docs/research/raw-text/ACC1523-Specified-treatment-provider-costs.txt).
const SYNTHETIC_COTR_TABLE = `
Regulation
item
Billing
code
Item description
Flat rate
$ (excl.
GST)
TMT




ACU1
Acupuncture
27.42
31.53
68.99
79.34

CH01
Chiropractic
27.42
31.53
68.99
79.34

POD3
POD3
Abscess or haematoma:
drainage with incision (with
or without local anaesthetic
agent)
33.22
38.20

XRAY
XRAY
X-ray chiropractor (per film –
maximum 2 films per claimant
per personal injury)
16.81
19.33
`;

describe('parseCotrRateSheet', () => {
  it('parses a 4-number TMT (flat-or-hourly) row', () => {
    const items = parseCotrRateSheet(SYNTHETIC_COTR_TABLE, COTR_ALL_CODES);
    const acu1 = items.find((i) => i.code === 'ACU1');
    expect(acu1).toBeDefined();
    expect(acu1!.description).toBe('Acupuncture');
    expect(acu1!.flatExclGst).toBe(27.42);
    expect(acu1!.flatInclGst).toBe(31.53);
    expect(acu1!.hourlyExclGst).toBe(68.99);
    expect(acu1!.hourlyInclGst).toBe(79.34);
  });

  it('parses a 2-number flat-only row with a repeated code line and multi-line description', () => {
    const items = parseCotrRateSheet(SYNTHETIC_COTR_TABLE, COTR_ALL_CODES);
    const pod3 = items.find((i) => i.code === 'POD3');
    expect(pod3).toBeDefined();
    expect(pod3!.description).toContain('Abscess or haematoma');
    expect(pod3!.flatExclGst).toBe(33.22);
    expect(pod3!.flatInclGst).toBe(38.2);
    expect(pod3!.hourlyExclGst).toBeNull();
    expect(pod3!.hourlyInclGst).toBeNull();
  });

  it('does not confuse two adjacent flat-only rows with each other', () => {
    const items = parseCotrRateSheet(SYNTHETIC_COTR_TABLE, COTR_ALL_CODES);
    const xray = items.find((i) => i.code === 'XRAY');
    expect(xray!.flatExclGst).toBe(16.81);
    expect(xray!.flatInclGst).toBe(19.33);
  });

  it('parses the REAL ACC1523 fixture and finds all known TMT codes with the current published rate', () => {
    const raw = fs.readFileSync(
      path.join(__dirname, '../../../docs/research/raw-text/ACC1523-Specified-treatment-provider-costs.txt'),
      'utf-8',
    );
    const items = parseCotrRateSheet(raw, COTR_ALL_CODES);
    const byCode = Object.fromEntries(items.map((i) => [i.code, i]));
    // Every currently-published "specified treatment provider" TMT item shares the same rate.
    for (const code of ['ACU1', 'CH01', 'OT01', 'OST1', 'PHY3', 'ST01', 'POD1']) {
      expect(byCode[code].hourlyInclGst).toBe(79.34);
    }
    expect(byCode.POD5.flatInclGst).toBe(127.28);
  });
});
