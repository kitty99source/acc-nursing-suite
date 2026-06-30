import type { Interruption, ServiceCode } from '../types';
import {
  MAX_PACKAGE_CONSULTS,
  NS06_WATCH_THRESHOLD,
  NS06_APPROVAL_THRESHOLD,
  SERVICE_CODES,
} from './serviceCodes';

// ============================================================================
// Pure package-calculator engine for ACC District Nursing packages of care.
// No I/O, no dates from "now()" — fully deterministic for unit testing.
// ============================================================================

export type PrimaryPackage = 'NS01' | 'NS02' | 'NS03';

export interface PackageInput {
  day1: string; // ISO date
  lastConsult?: string; // ISO date; undefined => ongoing (treated as not-yet-complete)
  consultCount: number;
  interruptions?: Interruption[];
}

export interface PackageDetermination {
  /** Recommended billing code(s), e.g. ['NS02'] or ['NS03', 'NS04']. */
  recommendedCodes: ServiceCode[];
  primaryPackage: PrimaryPackage;
  /** True when an Extended Nursing (NS04) portion applies. */
  needsExtended: boolean;
  /** Estimated NS04 consults when derivable from the consult count. */
  extendedConsults?: number;
  durationDays: number;
  consultCount: number;
  packageValue: number;
  extendedValue?: number;
  totalValue: number;
  reason: string;
  reminder: string;
  capApplied: boolean;
  ongoing: boolean;
  interruptionNote?: string;
  requiresApproval: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole-day difference between two ISO dates (lastConsult - day1). */
export function daysBetween(startISO: string, endISO: string): number {
  const start = Date.parse(startISO + 'T00:00:00Z');
  const end = Date.parse(endISO + 'T00:00:00Z');
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / MS_PER_DAY);
}

/** Tentative package purely from the duration band (ignores consult minimums). */
function tentativeByDuration(durationDays: number): { pkg: PrimaryPackage; overLongTerm: boolean } {
  if (durationDays > 105) return { pkg: 'NS03', overLongTerm: true };
  if (durationDays >= 43) return { pkg: 'NS03', overLongTerm: false };
  if (durationDays >= 14) return { pkg: 'NS02', overLongTerm: false };
  return { pkg: 'NS01', overLongTerm: false };
}

const PACKAGE_ORDER: PrimaryPackage[] = ['NS03', 'NS02', 'NS01'];

/** Largest package (NS03 > NS02 > NS01) whose minimum consult count is satisfied. */
function largestPackageMeetingConsults(consultCount: number): PrimaryPackage {
  for (const pkg of PACKAGE_ORDER) {
    const min = SERVICE_CODES[pkg].minConsults ?? 1;
    if (consultCount >= min) return pkg;
  }
  return 'NS01';
}

function packageName(pkg: PrimaryPackage): string {
  return SERVICE_CODES[pkg].name;
}

export const PACKAGE_COMPLETION_REMINDER =
  'Reminder: packages of care are invoiced only AFTER the package is completed.';

/**
 * Determine the recommended package of care from duration, consult count and
 * interruptions, applying the downgrade rule, the 25-consult cap and the
 * 105-day / NS04 extension rule.
 */
export function determinePackage(input: PackageInput): PackageDetermination {
  const consultCount = Math.max(0, Math.floor(input.consultCount || 0));
  const ongoing = !input.lastConsult;
  const durationDays = input.lastConsult ? Math.max(0, daysBetween(input.day1, input.lastConsult)) : 0;

  const interruptions = input.interruptions ?? [];
  const interruptionNote =
    interruptions.length > 0
      ? `${interruptions.length} interruption(s) recorded; per ACC rules these days remain counted within the package span.`
      : undefined;

  const tentative = tentativeByDuration(durationDays);
  const tentativeMin = SERVICE_CODES[tentative.pkg].minConsults ?? 1;

  // Downgrade rule: not enough consults for the duration-tentative package.
  let primaryPackage = tentative.pkg;
  let downgraded = false;
  if (consultCount < tentativeMin) {
    primaryPackage = largestPackageMeetingConsults(consultCount);
    downgraded = primaryPackage !== tentative.pkg;
  }

  // NS04 extension applies when duration exceeds 105 days OR consults exceed the cap.
  const capApplied = consultCount > MAX_PACKAGE_CONSULTS;
  const needsExtended = tentative.overLongTerm || capApplied;

  let extendedConsults: number | undefined;
  if (capApplied) {
    extendedConsults = consultCount - MAX_PACKAGE_CONSULTS;
  }

  const packageValue = SERVICE_CODES[primaryPackage].rate;
  const extendedValue =
    extendedConsults !== undefined ? extendedConsults * SERVICE_CODES.NS04.rate : undefined;
  const totalValue = packageValue + (extendedValue ?? 0);

  const recommendedCodes: ServiceCode[] = [primaryPackage];
  if (needsExtended) recommendedCodes.push('NS04');

  // Build a human-readable reason.
  const parts: string[] = [];
  if (ongoing) {
    parts.push(
      `Episode is ongoing (no last-consult date yet). Based on ${consultCount} consult(s) so far, current best fit is ${primaryPackage} (${packageName(primaryPackage)}).`,
    );
  } else if (downgraded) {
    parts.push(
      `${packageName(tentative.pkg)} needs ${tentativeMin} visits, only ${consultCount} logged → ${packageName(primaryPackage)} (${primaryPackage}).`,
    );
  } else {
    parts.push(
      `Duration of ${durationDays} day(s) with ${consultCount} consult(s) → ${packageName(primaryPackage)} (${primaryPackage}).`,
    );
  }

  if (tentative.overLongTerm) {
    parts.push(
      `Duration exceeds 105 days → Long Term Package plus Extended Nursing (NS04) from day 106 / 26th consult. NS04 requires ACC prior approval.`,
    );
  }
  if (capApplied) {
    parts.push(
      `Consult count (${consultCount}) exceeds the ${MAX_PACKAGE_CONSULTS}-consult package cap → consults beyond ${MAX_PACKAGE_CONSULTS} bill as Extended Nursing (NS04)${
        extendedConsults !== undefined ? ` (~${extendedConsults} NS04 consult(s))` : ''
      }.`,
    );
  }

  return {
    recommendedCodes,
    primaryPackage,
    needsExtended,
    extendedConsults,
    durationDays,
    consultCount,
    packageValue,
    extendedValue,
    totalValue,
    reason: parts.join(' '),
    reminder: PACKAGE_COMPLETION_REMINDER,
    capApplied,
    ongoing,
    interruptionNote,
    requiresApproval: needsExtended,
  };
}

export interface SubsequentReclassification extends PackageDetermination {
  newDay1: string;
  note: string;
}

/**
 * When an original claim is resolved and a subsequent injury becomes the new
 * primary injury, the NEW day 1 is the reassessment date (NOT backdated).
 * Produces a fresh determination from that date.
 */
export function reclassifySubsequentInjury(input: {
  reassessmentDate: string;
  lastConsult?: string;
  consultCount: number;
  interruptions?: Interruption[];
}): SubsequentReclassification {
  const determination = determinePackage({
    day1: input.reassessmentDate,
    lastConsult: input.lastConsult,
    consultCount: input.consultCount,
    interruptions: input.interruptions,
  });
  return {
    ...determination,
    newDay1: input.reassessmentDate,
    note:
      'New Day 1 is the reassessment date. NS06 consults given before reassessment do NOT count toward this new package’s day-count or minimum consults. Invoice/close out the original injury package first.',
  };
}

export interface NS06Watch {
  count: number;
  approaching: boolean;
  exceeded: boolean;
  message: string;
}

/** NS06 watch: flag at >=45 treatments (approaching the 50-treatment approval threshold). */
export function ns06Watch(treatmentCount: number): NS06Watch {
  const count = Math.max(0, Math.floor(treatmentCount || 0));
  const exceeded = count > NS06_APPROVAL_THRESHOLD;
  const approaching = count >= NS06_WATCH_THRESHOLD;
  let message: string;
  if (exceeded) {
    message = `${count} NS06 treatments — exceeds ${NS06_APPROVAL_THRESHOLD}; ACC approval is required for further NS06 on this claim.`;
  } else if (approaching) {
    message = `${count} NS06 treatments — approaching the ${NS06_APPROVAL_THRESHOLD}-treatment approval threshold.`;
  } else {
    message = `${count} NS06 treatments logged.`;
  }
  return { count, approaching, exceeded, message };
}
