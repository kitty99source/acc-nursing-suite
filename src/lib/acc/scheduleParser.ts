// ============================================================================
// Real, testable parsing logic for ACC's published Service Schedule /
// Cost-of-Treatment-Regulations price tables (extracted PDF text ->
// structured rows). See docs/research/acc-public-contract-sources-2026-08.md
// for where these documents came from, and scripts/ingest-acc-schedules.mjs
// for the build-time script that runs this against the real raw text under
// docs/research/raw-text/ to produce the seed data shipped in the app.
//
// Layout this is built against (confirmed against the real extracted text of
// the Nursing/Allied Health/Elective Surgery Service Schedules — pdfjs/PyMuPDF
// text extraction of a multi-column PDF table renders each cell's words on
// their own line, in reading order, with NO reliable column delimiters):
//
//   NS01                                <- code, alone on its own line
//   Short                               <- description word-wrapped
//   Term
//   Nursing Package
//   As described in Part B, clause 5.8  <- "definition" filler text, folded
//   Travel costs are included in the      into the description (harmless —
//   packaged price and cannot be          this is intentionally NOT trying
//   invoiced separately                   to separate description vs.
//   $525.40                             <- first dollar amount in the segment
//   Package                             <- pricing-unit words, until the next
//   Price                                  known code line
//
// A segment for a given known code runs from just after that code's line up
// to (but not including) the next known code's line — so this only works
// given an explicit list of codes to look for (see knownCodes.ts), not a
// fully-generic "detect any code" heuristic (tried and rejected — see
// docs/research/acc-public-contract-sources-2026-08-ingestion-notes.md for
// why: free-form regex code-detection produces too many false positives from
// ordinary all-caps words like "AND"/"PAGE"/"NOTE" in this document family).
// ============================================================================

export interface ScheduleItem {
  code: string;
  /** Cleaned, single-line description (whitespace-collapsed). */
  description: string;
  /** Dollar price excl. GST, or null when the schedule says "actual and reasonable cost" instead of a fixed price. */
  price: number | null;
  /** True when price is null because this item is billed at "actual and reasonable cost" rather than a fixed rate. */
  actualCost: boolean;
  /** A dollar cap mentioned alongside "actual and reasonable cost", if any (e.g. "up to $282.97"). */
  costCapPrice: number | null;
  /** Cleaned pricing-unit text, e.g. "Package Price", "Per hour", "Per Kilometre". '' if none was found. */
  pricingUnit: string;
}

const ANY_PRICE_RE = /\$\s*([\d,]+\.\d{2})/;
const ACTUAL_COST_RE = /actual\s+and\s+reasonable/i;

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function parseDollar(raw: string): number {
  return parseFloat(raw.replace(/,/g, ''));
}

/**
 * Parses a "known code, standalone on its own line -> free-flowing
 * description/price/pricing-unit text -> next known code" style price table,
 * as used by every ACC Service Schedule Table 1/Part A price table found in
 * this research pass. `knownCodes` must be the exact, real codes to look for
 * (see knownCodes.ts) — lines are only treated as a table row boundary when
 * they are an EXACT (trimmed) match for one of these, so ordinary narrative
 * text elsewhere in the document (which may mention a code in passing, e.g.
 * "...may invoice under NS04...") is never mistaken for a table row.
 */
export function parsePricedCodeTable(text: string, knownCodes: string[]): ScheduleItem[] {
  const codeSet = new Set(knownCodes);
  const lines = text.split(/\r?\n/);

  // Record the line index of each known code's FIRST occurrence, in document order.
  const occurrences: { code: string; lineIdx: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (codeSet.has(t) && !seen.has(t)) {
      occurrences.push({ code: t, lineIdx: i });
      seen.add(t);
    }
  }

  const items: ScheduleItem[] = [];
  for (let idx = 0; idx < occurrences.length; idx++) {
    const { code, lineIdx } = occurrences[idx];
    const endIdx = idx + 1 < occurrences.length ? occurrences[idx + 1].lineIdx : lines.length;
    const segmentLines = lines.slice(lineIdx + 1, endIdx).map((l) => l.trim());

    // Join first — the source PDF's word-wrapping can split a phrase like "actual and
    // reasonable" or "up to $282.97" across multiple lines (and, in some tables, put the price
    // on the SAME line as trailing description text, e.g. the Elective Surgery schedule's
    // "...includes minor bone graft  $11,532.74") — so per-line matching would miss it.
    const segmentJoined = collapseWhitespace(segmentLines.join(' '));
    const actualCostMatch = ACTUAL_COST_RE.test(segmentJoined);

    let description: string;
    let pricingUnit: string;
    let price: number | null = null;
    let costCapPrice: number | null = null;

    const priceMatch = ANY_PRICE_RE.exec(segmentJoined);
    if (priceMatch) {
      const before = segmentJoined.slice(0, priceMatch.index);
      const after = segmentJoined.slice(priceMatch.index + priceMatch[0].length);
      if (actualCostMatch) {
        // The one dollar figure present is a cost CAP alongside "actual and reasonable cost"
        // (e.g. NSAC's "...to a maximum of $282.97"), not a fixed price.
        description = segmentJoined;
        pricingUnit = '';
        costCapPrice = parseDollar(priceMatch[1]);
      } else {
        description = before.trim();
        pricingUnit = after.trim();
        price = parseDollar(priceMatch[1]);
      }
    } else {
      // No dollar figure found at all — still record the row (with description) rather than
      // silently dropping it, so gaps are visible/reportable instead of invisible.
      description = segmentJoined;
      pricingUnit = '';
    }

    items.push({
      code,
      description,
      price,
      actualCost: actualCostMatch,
      costCapPrice,
      pricingUnit,
    });
  }

  return items;
}

export interface CotrRateItem {
  code: string;
  description: string;
  flatExclGst: number | null;
  flatInclGst: number | null;
  hourlyExclGst: number | null;
  hourlyInclGst: number | null;
}

const PLAIN_NUMBER_RE = /^([\d,]+\.\d{2})$/;

/**
 * Parses ACC's Cost of Treatment Regulations "specified treatment provider
 * costs" info-sheet table style (ACC1523/ACC1520): code line, one description
 * line, then a run of 2 or 4 plain decimal-number lines (flat excl/incl GST,
 * and — for the "TMT" hourly-eligible items only — hourly excl/incl GST too).
 */
export function parseCotrRateSheet(text: string, knownCodes: string[]): CotrRateItem[] {
  const codeSet = new Set(knownCodes);
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const occurrences: { code: string; lineIdx: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (codeSet.has(lines[i]) && !seen.has(lines[i])) {
      occurrences.push({ code: lines[i], lineIdx: i });
      seen.add(lines[i]);
    }
  }

  const items: CotrRateItem[] = [];
  for (const { code, lineIdx } of occurrences) {
    let i = lineIdx + 1;
    // Some rows repeat the billing code as its own "Regulation item" column value immediately
    // before the description (e.g. POD3/POD4/POD5/XRAY) — skip blank lines and any immediate
    // repeat(s) of the code itself before collecting description text.
    while (i < lines.length && (lines[i] === '' || lines[i] === code)) i++;

    const descriptionLines: string[] = [];
    while (i < lines.length && !PLAIN_NUMBER_RE.test(lines[i])) {
      if (lines[i] !== '') descriptionLines.push(lines[i]);
      i++;
    }
    const description = collapseWhitespace(descriptionLines.join(' '));

    const numbers: number[] = [];
    while (i < lines.length && numbers.length < 4) {
      if (lines[i] === '') {
        i++;
        continue;
      }
      const m = PLAIN_NUMBER_RE.exec(lines[i]);
      if (!m) break;
      numbers.push(parseDollar(m[1]));
      i++;
    }

    items.push({
      code,
      description,
      flatExclGst: numbers[0] ?? null,
      flatInclGst: numbers[1] ?? null,
      hourlyExclGst: numbers[2] ?? null,
      hourlyInclGst: numbers[3] ?? null,
    });
  }

  return items;
}
