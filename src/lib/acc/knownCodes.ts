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

// Elective Surgery Table 1 ("Core Service Items and Prices") — the FULL real
// procedure-code list across every body-region family in the 80-page schedule
// (ankle/foot, knee, hip, shoulder, spine, wrist/hand, urology, ophthalmology,
// ENT, elbow/forearm, skin/plastics, nerve, general/day-surgery-other), not
// just the previously-curated AFT/3DIMAGE subset. Every code below was
// verified present as an exact, standalone table-row line in the real
// extracted text (docs/research/raw-text/elective-surgery-service-schedule.txt,
// lines 86-3576 = "Table 1: Core Service Items and Prices"), via a systematic
// extraction pass:
//   1. `grep -nE '^[0-9A-Z][A-Z0-9]*$'` over that line range to find every
//      standalone all-caps/alnum line (a superset — this is a real, structured
//      price table, so a code is always alone on its own line, per
//      scheduleParser.ts's documented layout).
//   2. Manually verified each candidate against its surrounding context to
//      drop the handful of real false positives: ordinary description words
//      that also happen to be standalone all-caps lines due to PDF word-wrap
//      (AND, DIP, IP, MCP, OR, PIP, TUR — all confirmed to be body-part
//      abbreviations or conjunctions mid-description, e.g. "PIP / DIP
//      Arthrodesis", "KNE60 ... OR one of the following"), plus one
//      mid-description reference to a DIFFERENT table's code ("...invoiced
//      using the ESR09 code." — ESR09 is real, but it is a Table 2 non-core
//      item, not a Table 1 procedure; see ELECTIVE_SURGERY_NONCORE_CODES).
//   3. Cross-checked the resulting 558-code list against a parse run with
//      zero unparsed/anomalous rows (every row got either a real price or a
//      confirmed "Actual Costs" flag — see scheduleParser.ts's
//      ACTUAL_COST_RE) and zero duplicate codes.
// Real, confirmed GAPS in ACC's own numbering are preserved as-is (e.g. no
// AFT188, no KNE02, no OPT12, no SHU02-05) rather than "filled in" — those
// numbers genuinely do not appear in the document.
function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let n = start; n <= end; n++) out.push(n);
  return out;
}

const AFT_NUMBERS = [
  ...range(100, 187),
  ...range(189, 216),
  ...range(220, 234),
  250, 251, 252, 260, 261, 262, 270, 271, 272, 280, 281, 282, 290, 295,
  300, 301, 302, 303,
];
const DNS_NUMBERS = [1, 2, 3, 4, 6];
const ELF_NUMBERS = [1, 2, 3, 6, 7, 8, 9, 10, 11, 21, 22, 23, 24, 25, 50, 51, 52, 60, 61, 62];
const GNS_NUMBERS = [1, 2, 3, 4, 5, 6];
const GOP_NUMBERS = [1, 2, 3, 4, 5, 7, 20, 21, 22, 23, 24];
const HIT_NUMBERS = [1, 2, 3, 5, 6, 7, 8, 9, 17, 18, 19, 20, 21, 22];
const HIT_A_NUMBERS = [50, 60, 70];
const IMAGE_NUMBERS = [1, 2, 3, 4, 5];
const KNE_NUMBERS = [
  1, 3, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 28, 50, 51, 52, 60, 61, 62, 66,
  70, 71, 72, 81, 83, 91, 93, 124, 125, 128, 129, 130,
];
const KNE_A_NUMBERS = [85, 95];
const NRV_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 9];
const OPT_NUMBERS = [4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 101, 102, 103, 104, 105, 106, 107, 120, 121, 122, 123, 130, 131, 132, 133];
const OTY_NUMBERS = [2, 8, 9, 10, 11, 100, 101, 103, 104, 105, 106, 107, 108, 109, 120, 121, 122, 123];
const SHU_NUMBERS = [
  1, 6, 7, 8, 9, 13, 14, 15, 16, 20, 21, 22, 23, 50, 51, 52, 60, 61, 62, 70, 71, 72, 80, 81, 82,
  85, 90, 91, 92, 95,
];
const SHU_A_NUMBERS = [17, 96];
const SKP_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
const SPN_NUMBERS = [...range(300, 335), ...range(340, 358), ...range(360, 376), ...range(380, 392)];
const URL_NUMBERS = range(1, 35);
const WAH_NUMBERS = range(100, 170);

/** Real "add-on"/actual-cost items that don't follow a plain PREFIX+number pattern. */
const ELECTIVE_SURGERY_STANDALONE_CODES = [
  '3DIMAGE1',
  '3DIMAGE2',
  '3DIMAGE3',
  '3DIMAGE4',
  'AFTABOTX',
  'OPTAEYEB',
  'OPTAFRAG',
  'ORAMAJB',
  'ORAMINB',
  'OTYATURB',
  'URABASKT',
  'URABOTOX',
  'URADILAT',
  'URAGRASP',
  'URAGWIRE',
  'URALASER',
  'URASTENT',
];

/** Table 1 "Core Service Items and Prices" — the full ~558-code real procedure price table. */
export const ELECTIVE_SURGERY_CODES = [
  ...ELECTIVE_SURGERY_STANDALONE_CODES,
  ...AFT_NUMBERS.map((n) => `AFT${n}`),
  ...DNS_NUMBERS.map((n) => `DNS${String(n).padStart(2, '0')}`),
  ...ELF_NUMBERS.map((n) => `ELF${String(n).padStart(2, '0')}`),
  ...GNS_NUMBERS.map((n) => `GNS${String(n).padStart(2, '0')}`),
  ...GOP_NUMBERS.map((n) => `GOP${String(n).padStart(2, '0')}`),
  ...HIT_NUMBERS.map((n) => `HIT${String(n).padStart(2, '0')}`),
  ...HIT_A_NUMBERS.map((n) => `HIT${n}A`),
  ...IMAGE_NUMBERS.map((n) => `IMAGE${n}`),
  ...KNE_NUMBERS.map((n) => `KNE${String(n).padStart(2, '0')}`),
  ...KNE_A_NUMBERS.map((n) => `KNE${n}A`),
  ...NRV_NUMBERS.map((n) => `NRV${String(n).padStart(2, '0')}`),
  ...OPT_NUMBERS.map((n) => `OPT${String(n).padStart(2, '0')}`),
  ...OTY_NUMBERS.map((n) => `OTY${String(n).padStart(2, '0')}`),
  ...SHU_NUMBERS.map((n) => `SHU${String(n).padStart(2, '0')}`),
  ...SHU_A_NUMBERS.map((n) => `SHU${n}A`),
  ...SKP_NUMBERS.map((n) => `SKP${String(n).padStart(2, '0')}`),
  ...SPN_NUMBERS.map((n) => `SPN${n}`),
  ...URL_NUMBERS.map((n) => `URL${String(n).padStart(2, '0')}`),
  ...WAH_NUMBERS.map((n) => `WAH${n}`),
];

/**
 * Table 2 "Non-core Service Items and Prices" (theatre time, ward/HDU/ICU stay, 2nd surgeon,
 * follow-up visits, etc.) — a real, separate price table from Table 1's procedure codes, and
 * kept as its own known-codes list (rather than merged into ELECTIVE_SURGERY_CODES and parsed
 * over the WHOLE document) specifically because "ESR09"/"ESRNC" each also appear once as a
 * mid-description REFERENCE inside a Table 1 procedure's own description text (e.g. "...invoiced
 * using the ESR09 code.") — parsing this list only over the Table-2-scoped text slice (see
 * nationalContracts.ts) avoids that earlier false occurrence being mistaken for the real table
 * row. Note ESR15 genuinely does not exist in the document (a real gap in ACC's own numbering).
 */
export const ELECTIVE_SURGERY_NONCORE_CODES = [
  'ESRNC',
  'ESR01',
  'ESR02',
  'ESR03',
  'ESR04',
  'ESR05',
  'ESR06',
  'ESR07',
  'ESR08',
  'ESR09',
  'ESR10',
  'ESR11',
  'ESR12',
  'ESR13',
  'ESR14',
  'ESR16',
  'ESR17',
  'ESR18',
];

/** ACC1523 "specified treatment provider" TMT items (flat-or-hourly rate). */
export const COTR_TMT_CODES = ['ACU1', 'CH01', 'OT01', 'OST1', 'PHY3', 'ST01', 'POD1'];

/** ACC1523 flat-rate-only podiatry procedure items + the chiropractor x-ray item. */
export const COTR_FLAT_ONLY_CODES = ['POD3', 'POD4', 'POD5', 'XRAY'];

export const COTR_ALL_CODES = [...COTR_TMT_CODES, ...COTR_FLAT_ONLY_CODES];
