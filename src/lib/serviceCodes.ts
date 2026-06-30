import type { ServiceCode } from '../types';

// ============================================================================
// ACC Nursing Services contract reference data (March 2025 Service Schedule).
// All dollar values are EXCLUSIVE of GST.
// ============================================================================

export type RateBasis = 'package' | 'consult' | 'hour' | 'km' | 'night' | 'actual';

export interface ServiceCodeInfo {
  code: ServiceCode;
  name: string;
  rate: number; // dollars excl GST; 0 means "actual cost"
  basis: RateBasis;
  requiresApproval: boolean;
  /** Minimum consults required to qualify for this package (packages only). */
  minConsults?: number;
  /** Inclusive duration band in days (packages only). */
  durationMinDays?: number;
  durationMaxDays?: number;
  description: string;
  group: 'package' | 'extended' | 'ongoing' | 'subsequent' | 'oversight' | 'consumables' | 'assessment' | 'travel';
}

export const MAX_PACKAGE_CONSULTS = 25;
export const NS06_APPROVAL_THRESHOLD = 50; // approval needed beyond 50 NS06 treatments on a claim
export const NS06_WATCH_THRESHOLD = 45; // flag when approaching the 50 threshold

export const SERVICE_CODES: Record<ServiceCode, ServiceCodeInfo> = {
  NS01: {
    code: 'NS01',
    name: 'Short Term Package',
    rate: 516.11,
    basis: 'package',
    requiresApproval: false,
    minConsults: 1,
    durationMinDays: 1,
    durationMaxDays: 13,
    description: '1–13 days, minimum 1 consult, no approval required.',
    group: 'package',
  },
  NS02: {
    code: 'NS02',
    name: 'Medium Term Package',
    rate: 1173.13,
    basis: 'package',
    requiresApproval: false,
    minConsults: 6,
    durationMinDays: 14,
    durationMaxDays: 42,
    description: '14–42 days, minimum 6 consults, no approval required.',
    group: 'package',
  },
  NS03: {
    code: 'NS03',
    name: 'Long Term Package',
    rate: 2275.42,
    basis: 'package',
    requiresApproval: false,
    minConsults: 12,
    durationMinDays: 43,
    durationMaxDays: 105,
    description: '43–105 days, minimum 12 consults, no approval required.',
    group: 'package',
  },
  NS04: {
    code: 'NS04',
    name: 'Extended Nursing',
    rate: 109.69,
    basis: 'consult',
    requiresApproval: true,
    description: 'Per consult. Requires ACC approval. Used beyond 105 days or from the 26th consult.',
    group: 'extended',
  },
  NS05: {
    code: 'NS05',
    name: 'Ongoing Nursing',
    rate: 98.58,
    basis: 'hour',
    requiresApproval: true,
    description: 'Per HOUR (not per visit). Requires ACC referral + approval up to 12 months. Travel billable separately.',
    group: 'ongoing',
  },
  NS06: {
    code: 'NS06',
    name: 'Subsequent Injury',
    rate: 37.16,
    basis: 'consult',
    requiresApproval: false,
    description: 'Per consult. No prior approval (notify via ACC179). Approval required if >50 NS06 treatments on same claim.',
    group: 'subsequent',
  },
  NS07: {
    code: 'NS07',
    name: 'Oversight Consultation',
    rate: 106.86,
    basis: 'consult',
    requiresApproval: false,
    description: 'Per consult. First per claim needs no approval.',
    group: 'oversight',
  },
  NS10: {
    code: 'NS10',
    name: 'Medical (high-cost) Consumables',
    rate: 0,
    basis: 'actual',
    requiresApproval: false,
    description: 'Actual cost.',
    group: 'consumables',
  },
  NS20: {
    code: 'NS20',
    name: 'Comprehensive Nursing Assessment',
    rate: 591.78,
    basis: 'consult',
    requiresApproval: false,
    description: 'Comprehensive Nursing Assessment.',
    group: 'assessment',
  },
  NS20T: {
    code: 'NS20T',
    name: 'Comprehensive Nursing Assessment (Telehealth)',
    rate: 591.78,
    basis: 'consult',
    requiresApproval: false,
    description: 'Comprehensive Nursing Assessment (telehealth variant).',
    group: 'assessment',
  },
  NSTD10: {
    code: 'NSTD10',
    name: 'Travel — Distance',
    rate: 0.82,
    basis: 'km',
    requiresApproval: false,
    description: 'Per km. Billable only with NS05 / NS07 / NS20.',
    group: 'travel',
  },
  NSTT1: {
    code: 'NSTT1',
    name: 'Travel — Time',
    rate: 98.58,
    basis: 'hour',
    requiresApproval: false,
    description: 'Per hour. Billable only with NS05 / NS07 / NS20.',
    group: 'travel',
  },
  NSTT1D: {
    code: 'NSTT1D',
    name: 'Travel — Time (Distance rural)',
    rate: 106.86,
    basis: 'hour',
    requiresApproval: false,
    description: 'Per hour. Billable only with NS05 / NS07 / NS20.',
    group: 'travel',
  },
  NSAC: {
    code: 'NSAC',
    name: 'Travel — Accommodation',
    rate: 282.97,
    basis: 'night',
    requiresApproval: false,
    description: 'Per night (max). Billable only with NS05 / NS07 / NS20.',
    group: 'travel',
  },
};

export const ALL_SERVICE_CODES = Object.keys(SERVICE_CODES) as ServiceCode[];

/** Service codes that travel (NSTD10/NSTT1/NSTT1D/NSAC) may be billed alongside. */
export const TRAVEL_ELIGIBLE_CODES: ServiceCode[] = ['NS05', 'NS07', 'NS20', 'NS20T'];

export const PACKAGE_CODES: ServiceCode[] = ['NS01', 'NS02', 'NS03'];

/** Revenue grouping used in analytics & year summary. */
export type RevenueGroup = 'Packages (NS01-03)' | 'NS04' | 'NS05' | 'NS06' | 'Other';

export function revenueGroupForCode(code: ServiceCode): RevenueGroup {
  if (code === 'NS01' || code === 'NS02' || code === 'NS03') return 'Packages (NS01-03)';
  if (code === 'NS04') return 'NS04';
  if (code === 'NS05') return 'NS05';
  if (code === 'NS06') return 'NS06';
  return 'Other';
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: 'NZD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export function serviceCodeLabel(code: ServiceCode): string {
  const info = SERVICE_CODES[code];
  return info ? `${code} — ${info.name}` : code;
}
