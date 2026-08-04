// ============================================================================
// Real service-item codes to look for in each ACC Service Schedule's price
// table, transcribed directly from the actual PDF text (see
// docs/research/raw-text/*.txt) — never invented/guessed. Used by
// scheduleParser.ts's `parsePricedCodeTable`/`parseCotrRateSheet` to find
// table-row boundaries.
//
// Elective Surgery is intentionally scoped to a verified subset (the
// "3D Intraoperative Imaging" items + the full "Ankle/Foot Arthrodesis"
// (AFT1xx) procedure family) rather than every one of the ~500+ codes in that
// 80-page schedule — per the research doc's own recommendation (§4, item 3):
// "worth scoping to just the procedure categories the owner's organisation
// actually bills, rather than the whole national table". The FULL elective
// surgery price table text is still ingested into the narrative knowledge
// base (RAG) so a question about a procedure outside this structured subset
// can still surface the real text — see scripts/ingest-acc-schedules.mjs.
// ============================================================================

export const NURSING_CODES = [
  'NS01',
  'NS02',
  'NS03',
  'NS04',
  'NS05',
  'NS06',
  'NS07',
  'NS10',
  'NS20',
  'NS20T',
  'NSTD10',
  'NSTT1',
  'NSTT1D',
  'NSTA1',
  'NST6',
  'NSAC',
];

export const ALLIED_HEALTH_CODES = [
  // Part A Table 1 — Physiotherapy
  'PT01',
  'PT02',
  'PTCG',
  'PT1T',
  'PT2T',
  'PT21',
  'PT22',
  'PTE1',
  'PTE2',
  'PTE3',
  // Part A Table 2 — Health NZ/Te Whatu Ora physiotherapy
  'PT31',
  'PT32',
  'PT31T',
  'PT32T',
  // Part A Table 3 — Physiotherapy Specialist
  'PTS1',
  'PTS2',
  'PTS1T',
  'PTS2T',
  // Part A Table 4 — Hand Therapy
  'HT01',
  'HT02',
  'HT03',
  'HT04',
  'HT13',
  'HT1T',
  'HT2T',
  // Part A Table 5 — Podiatry
  'POD21',
  'POD22',
  'POD21T',
  'POD22T',
  'POD11',
  'POD12',
  'POD13',
  'PODMB',
  'PODFS',
  'PODFS1',
  'PODLL',
  'PODLL1',
  // Part A Table 6 — Health NZ/Te Whatu Ora podiatry
  'POD31',
  'POD32',
  'POD31T',
  'POD32T',
  // Part A Table 7 — Pelvic Physiotherapy for Maternal Birth Injury
  'PTP1',
  'PTP2',
  'PTP3',
  'PTP4',
  'PP1T',
  'PP2T',
];

// Full real "AFT" (ankle/foot) arthrodesis procedure-code family + the
// "3DIMAGE" intraoperative-imaging codes — verified present in the actual
// document text via `grep -oE '^AFT[0-9]+\s*$'` against
// docs/research/raw-text/elective-surgery-service-schedule.txt (see
// scripts/ingest-acc-schedules.mjs's ingestion log for the exact command).
// Other body-region families in this schedule (knee/hip/spine/shoulder etc.)
// are NOT structured here — see the module doc comment above.
const AFT_CODE_NUMBERS = [
  ...range(100, 187),
  ...range(189, 216),
  ...range(220, 234),
  250, 251, 252, 260, 261, 262, 270, 271, 272, 280, 281, 282, 290, 295,
  300, 301, 302, 303,
];

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let n = start; n <= end; n++) out.push(n);
  return out;
}

export const ELECTIVE_SURGERY_CODES = [
  '3DIMAGE1',
  '3DIMAGE2',
  '3DIMAGE3',
  '3DIMAGE4',
  ...AFT_CODE_NUMBERS.map((n) => `AFT${n}`),
];

/** ACC1523 "specified treatment provider" TMT items (flat-or-hourly rate). */
export const COTR_TMT_CODES = ['ACU1', 'CH01', 'OT01', 'OST1', 'PHY3', 'ST01', 'POD1'];

/** ACC1523 flat-rate-only podiatry procedure items + the chiropractor x-ray item. */
export const COTR_FLAT_ONLY_CODES = ['POD3', 'POD4', 'POD5', 'XRAY'];

export const COTR_ALL_CODES = [...COTR_TMT_CODES, ...COTR_FLAT_ONLY_CODES];
