// ============================================================================
// Registry of the real, public ACC documents ingested per
// docs/research/acc-public-contract-sources-2026-08.md (fetched/verified
// 4 Aug 2026). Every URL/date here was actually checked against the live PDF —
// nothing is invented. This is the single source of truth for "what document
// did this fact/price come from" so every downstream consumer (structured
// Contract seed data, narrative RAG chunks, chat citations) can point back to
// a real, checkable source instead of an anonymous blob of text.
//
// IMPORTANT — national template, not the owner's own contract: every Service
// Schedule below is ACC's published NATIONAL template (blank contract-number/
// named-supplier fields) — never Te Whatu Ora's or any other specific
// provider's actual signed, negotiated contract. See docs/research/
// acc-public-contract-sources-2026-08.md §3 for the full explanation. Anything
// built from this registry must keep that distinction visible to the user.
// ============================================================================

export type AccDocType = 'service-schedule' | 'operational-guidelines' | 'terms-and-conditions' | 'info-sheet' | 'handbook';

export interface AccSourceDoc {
  /** Stable key — matches the raw-text filename stem under docs/research/raw-text/. */
  id: string;
  /** Human-readable title as it appears on acc.co.nz. */
  title: string;
  /** The real, public URL the PDF was fetched from. */
  url: string;
  docType: AccDocType;
  /** Which real-world service type(s) this document covers. */
  serviceTypes: string[];
  /** Term/version/date info exactly as printed in the document — never invented. */
  effectiveFrom?: string;
  effectiveTo?: string;
  /** Free-text version/date note when there is no clean single "term", e.g. info sheets. */
  versionNote?: string;
  /** Raw-text fixture filename under docs/research/raw-text/ (source for both structured parsing and RAG chunking). */
  rawTextFile: string;
}

export const ACC_SOURCE_DOCS: AccSourceDoc[] = [
  {
    id: 'nursing-service-schedule',
    title: 'Nursing Services Service Schedule',
    url: 'https://www.acc.co.nz/assets/contracts/nursing-service-schedule.pdf',
    docType: 'service-schedule',
    serviceTypes: ['nursing'],
    effectiveFrom: '2025-03-01',
    effectiveTo: '2028-02-29',
    rawTextFile: 'nursing-service-schedule.txt',
  },
  {
    id: 'nurse-og',
    title: 'Nursing Services Operational Guidelines',
    url: 'https://www.acc.co.nz/assets/contracts/nurse-og.pdf',
    docType: 'operational-guidelines',
    serviceTypes: ['nursing'],
    versionNote: 'References the 1 Mar 2025 – 29 Feb 2028 Nursing Services Service Schedule',
    rawTextFile: 'nurse-og.txt',
  },
  {
    id: 'allied-health-services-service-schedule',
    title: 'Allied Health Services Service Schedule (Physiotherapy, Hand Therapy, Podiatry)',
    url: 'https://www.acc.co.nz/assets/contracts/allied-health-services-service-schedule.pdf',
    docType: 'service-schedule',
    serviceTypes: ['physiotherapy', 'occupational-therapy', 'hand-therapy', 'podiatry'],
    versionNote: 'Printed version dated 1 November 2025',
    rawTextFile: 'allied-health-services-service-schedule.txt',
  },
  {
    id: 'elective-surgery-service-schedule',
    title: 'Elective Surgery Services Service Schedule',
    url: 'https://www.acc.co.nz/assets/contracts/elective-surgery-service-schedule.pdf',
    docType: 'service-schedule',
    serviceTypes: ['elective-surgery'],
    effectiveFrom: '2019-11-01',
    effectiveTo: '2027-06-30',
    rawTextFile: 'elective-surgery-service-schedule.txt',
  },
  {
    id: 'elective-surgery-og',
    title: 'Elective Surgery Services Operational Guidelines',
    url: 'https://www.acc.co.nz/assets/contracts/elective-surgery-og.pdf',
    docType: 'operational-guidelines',
    serviceTypes: ['elective-surgery'],
    versionNote: 'References the current (to 30 Jun 2027) Elective Surgery Services Service Schedule',
    rawTextFile: 'elective-surgery-og.txt',
  },
  {
    id: 'health-contract-terms-conditions',
    title: 'Standard Terms and Conditions (shared across all ACC health contracts)',
    url: 'https://www.acc.co.nz/assets/contracts/health-contract-terms-conditions.pdf',
    docType: 'terms-and-conditions',
    serviceTypes: ['nursing', 'physiotherapy', 'occupational-therapy', 'hand-therapy', 'podiatry', 'elective-surgery'],
    versionNote: 'Template — current in-force version, contract-number/party fields blank',
    rawTextFile: 'health-contract-terms-conditions.txt',
  },
  {
    id: 'ACC1523-Specified-treatment-provider-costs',
    title: 'ACC1523 — Specified treatment provider costs (Cost of Treatment Regulations)',
    url: 'https://www.acc.co.nz/assets/provider/ACC1523-Specified-treatment-provider-costs.pdf',
    docType: 'info-sheet',
    serviceTypes: ['physiotherapy', 'occupational-therapy', 'podiatry', 'acupuncture', 'chiropractic', 'osteopathy', 'speech-therapy'],
    effectiveFrom: '2024-06-01',
    versionNote: '1 June 2024 amendment',
    rawTextFile: 'ACC1523-Specified-treatment-provider-costs.txt',
  },
  {
    id: 'acc7909-working-together-cotr-providers',
    title: 'ACC7909 — Working Together: a guide for Cost of Treatment Regulations providers',
    url: 'https://www.acc.co.nz/assets/provider/acc7909-working-together-cotr-providers.pdf',
    docType: 'handbook',
    serviceTypes: ['nursing', 'physiotherapy', 'occupational-therapy', 'podiatry', 'acupuncture', 'chiropractic', 'osteopathy', 'speech-therapy'],
    rawTextFile: 'acc7909-working-together-cotr-providers.txt',
  },
];

export function sourceDocById(id: string): AccSourceDoc | undefined {
  return ACC_SOURCE_DOCS.find((d) => d.id === id);
}
