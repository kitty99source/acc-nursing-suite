// ============================================================================
// Short Helper Mode explainers keyed for UI wiring. Each tip points at an FAQ id
// so "Learn more" opens Help Center without duplicating long-form answers.
// Office-safe only — no patient/PHI examples.
// ============================================================================

import { FAQ_ENTRIES, getFaqById, type FaqEntry } from './helpContent';

export interface HelperTipDef {
  id: string;
  faqId: string;
  title: string;
  body: string;
}

export const HELPER_TIPS: HelperTipDef[] = [
  {
    id: 'tip-sidebar-badges',
    faqId: 'faq-sidebar-badges',
    title: 'Sidebar badge numbers',
    body:
      'Attention counts — not page totals. Dashboard = open action-queue items; Review Queue = pending letters; Billing = awaiting billing/remittance; Approvals/Declines/Complex/Compliance count follow-ups.',
  },
  {
    id: 'tip-accept',
    faqId: 'faq-undo-accept',
    title: 'Accept → create patient case',
    body:
      'Attaches this letter to a patient/claim. Nothing auto-files without you. Undo on the green banner (~45s) or later via “Undo this accept” on the claim document when shown.',
  },
  {
    id: 'tip-idrive-checkbox',
    faqId: 'faq-stage-to-idrive',
    title: 'Also file to I-drive',
    body:
      'Optional. When checked, Accept also stages a copy under _Staging using the Letters path grammar — not straight into the live District Nursing archive.',
  },
  {
    id: 'tip-stage-later',
    faqId: 'faq-stage-to-idrive',
    title: 'Stage to I-drive (later)',
    body:
      'Use when Accept skipped I-drive. Writes under _Staging when the file is still stored locally and no staging path is recorded yet.',
  },
  {
    id: 'tip-needs-review',
    faqId: 'faq-needs-review',
    title: 'Needs review (Billing)',
    body:
      'Invoice lines held/declined or otherwise flagged after remittance import — not every invoice, and not the same as sidebar page totals.',
  },
  {
    id: 'tip-remove-remittance',
    faqId: 'faq-remove-remittance',
    title: 'Remove remittance import',
    body:
      'Drops only that file’s payment lines and re-checks invoices that batch touched. Other imports stay.',
  },
  {
    id: 'tip-connecting',
    faqId: 'faq-connecting',
    title: 'Connecting vs Reconnecting',
    body:
      'Connecting = first contact with the local /_acc helper. Reconnecting = it dropped mid-session (supervisor usually restarts it). Prefer the quiet .vbs launcher.',
  },
  {
    id: 'tip-export-excel',
    faqId: 'faq-export-excel',
    title: 'Export Excel workbook',
    body:
      'One-click multi-tab workbook (Billing Log, Approvals, Complex, Declines, summaries) that opens clean in Excel. Replaces the old toolkit spreadsheet workflow.',
  },
  {
    id: 'tip-export-accdata',
    faqId: 'faq-backup',
    title: 'JSON / .accdata backup',
    body:
      'Portable working copy. IndexedDB autosaves on this PC; .accdata protects against disk wipe or a new computer.',
  },
  {
    id: 'tip-calculator',
    faqId: 'faq-calculator',
    title: 'Package Calculator',
    body:
      'Picks NS01–NS03 package from Day 1, duration, consults, and interruptions. Rates are excl GST from Settings → Contract pricing. Not a claim submitter.',
  },
  {
    id: 'tip-helper-mode',
    faqId: 'faq-helper-mode',
    title: 'Helper Mode',
    body:
      'When on, hover or focus key controls for short tips. Off by default. Same toggle in Settings.',
  },
  {
    id: 'tip-quiet-launcher',
    faqId: 'faq-quiet-launcher',
    title: 'Quiet launcher',
    body:
      'Pin Start ACC Suite (quiet).vbs — no PowerShell windows. Closing the last browser tab stops the helpers.',
  },
  {
    id: 'tip-hrq',
    faqId: 'faq-hrq',
    title: 'Review Queue (HRQ)',
    body:
      'Human Review Queue: synced/dropped letters wait here until you Accept. Auto-accept only for high-confidence eligible items you choose to run.',
  },
];

const BY_ID = new Map(HELPER_TIPS.map((t) => [t.id, t]));

export function getHelperTip(id: string): HelperTipDef | undefined {
  return BY_ID.get(id);
}

export { getFaqById };
export type { FaqEntry };

export function helperTipFaqIds(): string[] {
  return HELPER_TIPS.map((t) => t.faqId);
}

export function helperTipsHaveValidFaqs(): boolean {
  const ids = new Set(FAQ_ENTRIES.map((e) => e.id));
  return HELPER_TIPS.every((t) => ids.has(t.faqId));
}
