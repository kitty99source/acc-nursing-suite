// ============================================================================
// ACC remittance "reason code" lookup.
//
// When ACC short-pays or declines an invoice line, the remittance advice
// carries a reason code (and/or free text) in its comment column. This table
// maps the documented codes from ACC's "Sort out a payment problem" page
// (https://www.acc.co.nz/for-providers/invoicing-us/payment-problem) to a
// plain-English description + a "what you can do" tip, so the Billing
// module's Needs Review filter can show WHY a line is held and the first
// thing to try.
//
// Ported wholesale from ACC-RemittanceTracker (src/lib/reasonCodes.ts) — these
// are ACC's own documented codes, not specific to any one suite.
//
// ASSUMPTION (surfaced as a banner-style note on the Billing module): the
// exact spelling ACC prints in the CSV comment column hasn't been byte-
// confirmed for every code, so `lookupReasonCode` also degrades gracefully
// for unknown / free-text reasons.
// ============================================================================

export interface ReasonCodeInfo {
  code: string;
  /** Short label for the badge / table cell. */
  label: string;
  /** Plain-English description of what the code means. */
  description: string;
  /** ACC's suggested "what you can do" next step. */
  action: string;
}

/** The documented ACC payment-problem reason codes. Keyed by upper-case code. */
export const REASON_CODES: Record<string, ReasonCodeInfo> = {
  '12M': {
    code: '12M',
    label: 'Older than 12 months',
    description: 'The service was provided more than 12 months ago, so it is outside the standard invoicing window.',
    action: 'Contact ACC to ask whether a late-invoice exception applies before re-invoicing.',
  },
  ACM: {
    code: 'ACM',
    label: 'Accredited employer',
    description: 'The claim belongs to an ACC Accredited Employer / third-party administrator, not ACC.',
    action: 'Re-invoice the accredited employer named on the remittance instead of ACC.',
  },
  AGE: {
    code: 'AGE',
    label: 'Claim too old / inactive',
    description: 'The claim is closed or too old to accept new costs.',
    action: 'Check the claim status with ACC; a claim review or reopen may be needed.',
  },
  AP: {
    code: 'AP',
    label: 'Prior approval needed',
    description: 'The service required prior approval from ACC that was not in place.',
    action: 'Request retrospective approval from ACC, then re-invoice.',
  },
  APT: {
    code: 'APT',
    label: 'Appointment / attendance',
    description: 'An issue with the appointment or attendance record for the service.',
    action: 'Confirm the attendance details with ACC and re-submit.',
  },
  CTR4: {
    code: 'CTR4',
    label: 'Contract rule',
    description: 'The line breaches a rule in the relevant ACC contract (e.g. frequency or eligibility).',
    action: 'Check the contract schedule for the service, correct, and re-invoice.',
  },
  ECAP: {
    code: 'ECAP',
    label: 'Cap reached',
    description: 'A contracted cap / limit for this service or period has been reached.',
    action: 'Confirm remaining entitlement with ACC before re-invoicing.',
  },
  ER: {
    code: 'ER',
    label: 'Invoicing error',
    description: 'A data error on the invoice (e.g. incorrect code, provider, or claim number).',
    action: 'Correct the flagged field and re-invoice.',
  },
  GST: {
    code: 'GST',
    label: 'GST issue',
    description: 'A GST calculation or registration problem on the invoice.',
    action: 'Check the GST amount / registration number and re-invoice.',
  },
  IRI: {
    code: 'IRI',
    label: 'Incorrect rate / item',
    description: 'The rate or item billed does not match the ACC schedule.',
    action: 'Bill the scheduled rate/item and re-invoice.',
  },
  MAX1: {
    code: 'MAX1',
    label: 'Maximum reached',
    description: 'The maximum number of this service allowed has already been paid.',
    action: 'Confirm the allowance with ACC; a variation may be required.',
  },
  MSD: {
    code: 'MSD',
    label: 'MSD / other payer',
    description: 'Another agency (e.g. Ministry of Social Development) is responsible for the cost.',
    action: 'Re-direct the invoice to the responsible payer.',
  },
  NAF: {
    code: 'NAF',
    label: 'No active claim / cover',
    description: 'There is no active claim or accepted cover for the injury at the service date.',
    action: 'Check cover with ACC; lodge or reopen a claim if appropriate.',
  },
  NCN: {
    code: 'NCN',
    label: 'Incorrect claim number',
    description: 'The claim number on the invoice does not match ACC records.',
    action: 'Confirm the correct claim number with ACC and re-invoice.',
  },
  NOC: {
    code: 'NOC',
    label: 'Not on contract',
    description: 'The provider or service is not on the contract used to invoice.',
    action: 'Invoice under the correct contract, or confirm the provider is contracted.',
  },
  OTH: {
    code: 'OTH',
    label: 'Other',
    description: 'A reason not covered by a specific code — see the remittance comment text.',
    action: 'Read the full comment on the line and contact ACC if unclear.',
  },
  PI: {
    code: 'PI',
    label: 'Provider ID issue',
    description: 'A problem with the provider ID / vendor on the invoice.',
    action: 'Confirm the provider/vendor ID with ACC and re-invoice.',
  },
  PRV2: {
    code: 'PRV2',
    label: 'Provider not recognised',
    description: 'The billing provider is not recognised for this service.',
    action: 'Confirm provider registration/contract status with ACC.',
  },
  QAC: {
    code: 'QAC',
    label: 'Query / clarification',
    description: 'ACC has queried the line and needs clarification before paying.',
    action: 'Respond to the ACC query with the requested detail.',
  },
  RATE: {
    code: 'RATE',
    label: 'Rate mismatch',
    description: 'The rate billed differs from the agreed contract rate.',
    action: 'Re-invoice at the contracted rate.',
  },
  RTD: {
    code: 'RTD',
    label: 'Returned / duplicate',
    description: 'The invoice was returned, or is a duplicate of one already processed.',
    action: 'Check for an existing payment before re-invoicing.',
  },
  SBA: {
    code: 'SBA',
    label: 'Should be another code',
    description: 'The service should be billed under a different service item / code.',
    action: 'Re-bill using the correct service code.',
  },
  SC1: {
    code: 'SC1',
    label: 'Service code issue',
    description: 'The service code is invalid or not valid for this contract/date.',
    action: 'Use a valid service code for the contract and re-invoice.',
  },
  TRV: {
    code: 'TRV',
    label: 'Travel issue',
    description: 'A problem with a travel/mileage line.',
    action: 'Check the travel rules for the contract and re-invoice.',
  },
};

/** Codes are 2–4 letters/digits; scan the reason text for a known one as a whole token. */
const CODE_TOKEN_RE = /\b([A-Z]{2,4}[0-9]?|[0-9]{2}[A-Z])\b/g;

/**
 * Given a remittance line's raw comment/reason text, extract a documented ACC reason code (if one
 * appears) and return the trimmed full reason text. Prefers a KNOWN code token over a random match.
 */
export function parseReason(rawComment: string | undefined): {
  reasonCode?: string;
  reasonText?: string;
} {
  const text = (rawComment ?? '').trim();
  if (!text) return {};
  const upper = text.toUpperCase();
  let match: RegExpExecArray | null;
  CODE_TOKEN_RE.lastIndex = 0;
  const candidates: string[] = [];
  while ((match = CODE_TOKEN_RE.exec(upper)) !== null) {
    candidates.push(match[1]);
  }
  const known = candidates.find((c) => c in REASON_CODES);
  return { reasonCode: known, reasonText: text };
}

/** Look up a reason code (case-insensitive); returns undefined for unknown/blank codes. */
export function lookupReasonCode(code: string | undefined): ReasonCodeInfo | undefined {
  if (!code) return undefined;
  return REASON_CODES[code.trim().toUpperCase()];
}
