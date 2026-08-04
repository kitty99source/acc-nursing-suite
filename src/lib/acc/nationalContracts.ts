// ============================================================================
// Builds real `Contract` seed records from the parsed ACC national Service
// Schedules (see scheduleParser.ts / knownCodes.ts / sourceDocs.ts). These are
// ACC's PUBLISHED NATIONAL TEMPLATE price tables — never the owner's own
// organisation-specific negotiated contract (see docs/research/
// acc-public-contract-sources-2026-08.md §3). Every record built here is
// clearly labelled as such via `providerName`/`notes` so it can never be
// mistaken for a real signed agreement in the Contracts UI.
// ============================================================================

import type { Contract, ContractRateEntry } from '../../types';
import { ALLIED_HEALTH_CODES, COTR_ALL_CODES, ELECTIVE_SURGERY_CODES, NURSING_CODES } from './knownCodes';
import { parseCotrRateSheet, parsePricedCodeTable, type CotrRateItem, type ScheduleItem } from './scheduleParser';
import { sourceDocById } from './sourceDocs';

/** Marker written into every seeded record's `customFields`, so seeding can be idempotent/detectable. */
export const NATIONAL_SCHEDULE_MARKER_KEY = 'accNationalScheduleSourceId';

const NATIONAL_SCHEDULE_DISCLAIMER =
  'ACC NATIONAL PUBLISHED SCHEDULE — this is the public template price table ACC applies to every ' +
  'supplier of this service type nationally, NOT this organisation\'s own specific signed/negotiated ' +
  'contract. The real contract number, named-provider list, and any locally negotiated rate variations ' +
  'live only in this organisation\'s own contracts/records system — see the README/report from the ' +
  '2026-08 ACC public source-document ingestion for what to check for internally.';

function toRateTable(items: ScheduleItem[]): ContractRateEntry[] {
  return items
    .filter((i) => i.price !== null)
    .map((i) => ({
      serviceCode: i.code,
      description: i.description.slice(0, 200),
      rate: i.price as number,
    }));
}

// ----------------------------------------------------------------------------
// Pure "shaping" helpers — each takes ALREADY-PARSED items (never raw text
// directly) and returns the one Contract record for that schedule. Kept
// separate from parsing so both (a) the raw-text-driven build below (used by
// this module's own tests, which want to exercise the real parser end-to-end
// against the real extracted PDF text) and (b) the runtime UI path (which
// fetches already-parsed JSON produced by scripts/ingest-acc-schedules.mjs —
// see lib/acc/scheduleData.ts — and never re-parses raw text in the browser)
// share exactly one Contract-shaping implementation.
// ----------------------------------------------------------------------------

function contractFromNursingItems(items: ScheduleItem[]): Omit<Contract, 'id'> {
  const doc = sourceDocById('nursing-service-schedule')!;
  return {
    providerName: 'ACC — Nursing Services (National Service Schedule)',
    customerNumber: '',
    claimsEmail: 'health.procurement@acc.co.nz',
    effectiveFrom: doc.effectiveFrom!,
    effectiveTo: doc.effectiveTo,
    serviceCodesCovered: items.map((i) => i.code),
    rateTable: toRateTable(items),
    notes: `${NATIONAL_SCHEDULE_DISCLAIMER}\n\nSource: ${doc.title} (${doc.url}).`,
    customFields: { [NATIONAL_SCHEDULE_MARKER_KEY]: doc.id },
  };
}

function contractFromAlliedHealthItems(items: ScheduleItem[]): Omit<Contract, 'id'> {
  const doc = sourceDocById('allied-health-services-service-schedule')!;
  return {
    providerName: 'ACC — Allied Health Services: Physiotherapy, Hand Therapy, Podiatry (National Service Schedule)',
    customerNumber: '',
    claimsEmail: 'alliedhealth@acc.co.nz',
    effectiveFrom: '2025-11-01',
    effectiveTo: undefined,
    serviceCodesCovered: items.map((i) => i.code),
    rateTable: toRateTable(items),
    notes: `${NATIONAL_SCHEDULE_DISCLAIMER}\n\nSource: ${doc.title} (${doc.url}). Printed version dated 1 November 2025.`,
    customFields: { [NATIONAL_SCHEDULE_MARKER_KEY]: doc.id },
  };
}

function contractFromElectiveSurgeryItems(items: ScheduleItem[]): Omit<Contract, 'id'> {
  const doc = sourceDocById('elective-surgery-service-schedule')!;
  return {
    providerName: 'ACC — Elective Surgery Services: 3D Imaging + Ankle/Foot Arthrodesis subset (National Service Schedule)',
    customerNumber: '',
    claimsEmail: '',
    effectiveFrom: doc.effectiveFrom!,
    effectiveTo: doc.effectiveTo,
    serviceCodesCovered: items.map((i) => i.code),
    rateTable: toRateTable(items),
    notes:
      `${NATIONAL_SCHEDULE_DISCLAIMER}\n\nSource: ${doc.title} (${doc.url}). NOTE: this Service Schedule ` +
      'covers ~500+ procedure codes across many body regions (knee, hip, spine, shoulder, etc.) — only the ' +
      '3D Intraoperative Imaging codes and the full Ankle/Foot Arthrodesis (AFT1xx) family are structured ' +
      'here as a verified subset (per the research doc\'s own scoping recommendation). The complete price ' +
      'table text is still searchable via the AI chat assistant (full-text knowledge base), so ask about a ' +
      'specific procedure even if it is not in this structured rate table.',
    customFields: { [NATIONAL_SCHEDULE_MARKER_KEY]: doc.id },
  };
}

function contractFromCotrItems(items: CotrRateItem[]): Omit<Contract, 'id'> {
  const doc = sourceDocById('ACC1523-Specified-treatment-provider-costs')!;
  const rateTable: ContractRateEntry[] = items.map((i) => ({
    serviceCode: i.code,
    description: i.description ? `${i.description} (hourly incl. GST $${i.hourlyInclGst ?? i.flatInclGst})` : undefined,
    rate: i.flatInclGst ?? i.hourlyInclGst ?? 0,
  }));
  return {
    providerName: 'ACC — Cost of Treatment Regulations: Specified Treatment Provider Rates (ACC1523)',
    customerNumber: '',
    claimsEmail: '',
    effectiveFrom: doc.effectiveFrom!,
    effectiveTo: undefined,
    serviceCodesCovered: items.map((i) => i.code),
    rateTable,
    notes:
      `${NATIONAL_SCHEDULE_DISCLAIMER}\n\nSource: ${doc.title} (${doc.url}). Rate shown is the flat-rate ` +
      '(incl. GST) figure, or the hourly (incl. GST) figure where no flat rate applies — see the rate table ' +
      'description for the alternate hourly/flat figure. Applies only to NON-contracted specified treatment ' +
      'providers (acupuncturist, chiropractor, occupational therapist, osteopath, physiotherapist, ' +
      'podiatrist, speech therapist) billing under the Cost of Treatment Regulations, not under a Service ' +
      'Schedule contract.',
    customFields: { [NATIONAL_SCHEDULE_MARKER_KEY]: doc.id },
  };
}

/**
 * Builds one `Contract` record per structured national schedule ingested. `rawText` maps each
 * `sourceDocs.ts` id to the real extracted PDF text (see docs/research/raw-text/) — kept as a
 * parameter (rather than reading files directly) so this stays a pure, unit-testable function.
 * This is the raw-text-driven path used by this module's own tests; the runtime app UI instead
 * calls `buildContractsFromParsedSchedules` against pre-parsed JSON (see lib/acc/scheduleData.ts)
 * so the browser never re-runs the text parser itself.
 */
export function buildNationalScheduleContracts(rawText: Record<string, string>): Omit<Contract, 'id'>[] {
  const out: Omit<Contract, 'id'>[] = [];

  const nursingText = rawText['nursing-service-schedule'];
  if (nursingText) out.push(contractFromNursingItems(parsePricedCodeTable(nursingText, NURSING_CODES)));

  const alliedText = rawText['allied-health-services-service-schedule'];
  if (alliedText) out.push(contractFromAlliedHealthItems(parsePricedCodeTable(alliedText, ALLIED_HEALTH_CODES)));

  const electiveText = rawText['elective-surgery-service-schedule'];
  if (electiveText) out.push(contractFromElectiveSurgeryItems(parsePricedCodeTable(electiveText, ELECTIVE_SURGERY_CODES)));

  const cotrText = rawText['ACC1523-Specified-treatment-provider-costs'];
  if (cotrText) out.push(contractFromCotrItems(parseCotrRateSheet(cotrText, COTR_ALL_CODES)));

  return out;
}

export interface ParsedScheduleFile {
  sourceDocId: string;
  items: ScheduleItem[] | CotrRateItem[];
}

/**
 * Runtime-path equivalent of `buildNationalScheduleContracts`, taking ALREADY-PARSED schedule
 * items (as produced by scripts/ingest-acc-schedules.mjs and fetched at runtime via
 * lib/acc/scheduleData.ts) rather than raw text — the browser never re-parses PDF text itself.
 */
export function buildContractsFromParsedSchedules(schedules: ParsedScheduleFile[]): Omit<Contract, 'id'>[] {
  const out: Omit<Contract, 'id'>[] = [];
  for (const s of schedules) {
    if (s.sourceDocId === 'nursing-service-schedule') out.push(contractFromNursingItems(s.items as ScheduleItem[]));
    else if (s.sourceDocId === 'allied-health-services-service-schedule')
      out.push(contractFromAlliedHealthItems(s.items as ScheduleItem[]));
    else if (s.sourceDocId === 'elective-surgery-service-schedule')
      out.push(contractFromElectiveSurgeryItems(s.items as ScheduleItem[]));
    else if (s.sourceDocId === 'ACC1523-Specified-treatment-provider-costs')
      out.push(contractFromCotrItems(s.items as CotrRateItem[]));
  }
  return out;
}

/** True if a Contract in `existing` already carries the given national-schedule source marker. */
export function hasNationalScheduleContract(existing: Contract[], sourceDocId: string): boolean {
  return existing.some((c) => c.customFields?.[NATIONAL_SCHEDULE_MARKER_KEY] === sourceDocId);
}
