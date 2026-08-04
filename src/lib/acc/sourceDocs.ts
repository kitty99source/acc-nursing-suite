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
  // --------------------------------------------------------------------------
  // Added 4 Aug 2026 per docs/research/acc-public-contract-sources-2026-08.md
  // §8 gap audit — closing the HIGH/MEDIUM/LOW-MEDIUM knowledge-base gaps
  // (review & appeal rights, complaints, non-resident eligibility, weekly
  // compensation, vocational rehabilitation, Accredited Employer claims
  // process, cultural/whānau support, allied-health telehealth). Every URL
  // was fetched and verified live on that date; none are invented.
  // --------------------------------------------------------------------------
  {
    id: 'acc-claimants-rights-notice',
    title: "Code of ACC Claimants' Rights (incl. review & appeal rights guidance)",
    url: 'https://www.legislation.govt.nz/notice/2002/gs0072.html',
    docType: 'info-sheet',
    serviceTypes: ['claims-management', 'review-and-appeals'],
    versionNote: 'Statutory Code under s44 ACC Act 2001, plus public "How review works" guidance from acc.co.nz',
    rawTextFile: 'acc-claimants-rights-notice.txt',
  },
  {
    id: 'code-of-health-disability-consumers-rights',
    title: "Code of Health and Disability Services Consumers' Rights",
    url: 'https://www.hdc.org.nz/your-rights/about-the-code/code-of-health-and-disability-services-consumers-rights/',
    docType: 'info-sheet',
    serviceTypes: ['complaints', 'health-services'],
    versionNote: 'Health and Disability Commissioner Act 1994, Code of Rights regulations — published by the Health and Disability Commissioner',
    rawTextFile: 'code-of-health-disability-consumers-rights.txt',
  },
  {
    id: 'supporting-injured-international-visitors',
    title: 'Supporting injured visitors to New Zealand, and NZ residents injured overseas',
    url: 'https://www.acc.co.nz/for-providers/knowledge-base/supporting-injured-international-visitors/',
    docType: 'info-sheet',
    serviceTypes: ['claims-management', 'eligibility'],
    versionNote: 'Public acc.co.nz guidance pages, consolidated',
    rawTextFile: 'supporting-injured-international-visitors.txt',
  },
  {
    id: 'weekly-compensation-quick-guide',
    title: 'Weekly compensation and other financial support — Provider Quick Guide',
    url: 'https://www.acc.co.nz/for-providers/knowledge-base/weekly-compensation-and-other-financial-support/',
    docType: 'info-sheet',
    serviceTypes: ['weekly-compensation', 'claims-management'],
    versionNote: 'Public acc.co.nz guidance page',
    rawTextFile: 'weekly-compensation-quick-guide.txt',
  },
  {
    id: 'vrs-og',
    title: 'Vocational Rehabilitation Services Operational Guidelines',
    url: 'https://www.acc.co.nz/assets/contracts/vrs-og.pdf',
    docType: 'operational-guidelines',
    serviceTypes: ['vocational-rehabilitation'],
    versionNote: 'May 2026 edition',
    rawTextFile: 'vrs-og.txt',
  },
  {
    id: 'allied-health-services-operational-guidelines',
    title: 'Allied Health Services Operational Guidelines (incl. Accredited Employer interactions, telehealth)',
    url: 'https://www.acc.co.nz/assets/provider/allied-health-services-operational-guidelines.pdf',
    docType: 'operational-guidelines',
    serviceTypes: ['physiotherapy', 'occupational-therapy', 'hand-therapy', 'podiatry', 'accredited-employer'],
    effectiveFrom: '2024-11-01',
    rawTextFile: 'allied-health-services-operational-guidelines.txt',
  },
  {
    id: 'acc8331-telehealth-guide',
    title: 'ACC8331 — Telehealth Guide for health practitioners',
    url: 'https://www.acc.co.nz/assets/provider/acc8331-telehealth-guide.pdf',
    docType: 'info-sheet',
    serviceTypes: ['physiotherapy', 'occupational-therapy', 'hand-therapy', 'podiatry', 'nursing', 'telehealth'],
    rawTextFile: 'acc8331-telehealth-guide.txt',
  },
  {
    id: 'acc-te-whanau-maori-guidance',
    title: 'Te Whānau Māori me ō mahi — cultural safety and competency guidance for providers',
    url: 'https://www.acc.co.nz/assets/provider/acc-te-whanau-maori-me-o-mahi-guidance.pdf',
    docType: 'info-sheet',
    serviceTypes: ['cultural-safety', 'nursing', 'physiotherapy', 'occupational-therapy', 'hand-therapy', 'podiatry', 'vocational-rehabilitation'],
    rawTextFile: 'acc-te-whanau-maori-guidance.txt',
  },
  {
    id: 'housing-modification-services-og',
    title: 'Housing Modification (HMOD) and Housing Assessment (HMA) Services Operational Guidelines',
    url: 'https://www.acc.co.nz/assets/provider/Housing-Modification-and-Housing-Assessment-Services-Operational-Guidelines.pdf',
    docType: 'operational-guidelines',
    serviceTypes: ['home-modifications', 'social-rehabilitation'],
    effectiveFrom: '2025-09-01',
    versionNote: 'Trivially-found real source for the LOW-priority "home modifications" gap noted in docs/research/acc-public-contract-sources-2026-08.md §8',
    rawTextFile: 'housing-modification-services-og.txt',
  },
  // --------------------------------------------------------------------------
  // Added 4 Aug 2026 — closing §6 (patient/provider travel) and §7 (emergency
  // transport / ambulance criteria) gaps in
  // docs/research/acc-public-contract-sources-2026-08.md. Every URL was fetched
  // and verified live on that date; nothing invented. Preferring a few strong
  // authoritative sources over thin duplicates.
  // --------------------------------------------------------------------------
  {
    id: 'ancillary-services-regulations-2002',
    title: 'Accident Compensation (Ancillary Services) Regulations 2002',
    url: 'https://www.legislation.govt.nz/regulation/public/2002/0013/latest/whole.html',
    docType: 'info-sheet',
    serviceTypes: ['emergency-transport', 'client-travel', 'accommodation'],
    versionNote: 'SR 2002/13 — version as at 10 July 2026 (PDF fetched 4 Aug 2026)',
    rawTextFile: 'ancillary-services-regulations-2002.txt',
  },
  {
    id: 'accident-services-transport-accommodation',
    title: 'Accident Services — A Guide for DHB and ACC Staff (Section 4.12 Transport and accommodation)',
    url: 'https://www.acc.co.nz/assets/provider/accident-services-a-guide-for-dhb-and-acc-staff.pdf',
    docType: 'handbook',
    serviceTypes: ['emergency-transport', 'client-travel', 'accommodation', 'inter-hospital-transfer'],
    versionNote: 'Extract of §4.12 only (emergency transport definition, ACC vs DHB funding tables, inter-hospital transfers, non-emergency air/ambulance prior approval)',
    rawTextFile: 'accident-services-transport-accommodation.txt',
  },
  {
    id: 'client-travel-and-transport',
    title: 'Travel and transport (client guidance)',
    url: 'https://www.acc.co.nz/im-injured/types-of-ongoing-support/travel-transport',
    docType: 'info-sheet',
    serviceTypes: ['client-travel', 'accommodation', 'emergency-transport'],
    versionNote: 'Public acc.co.nz client page — last published 19 June 2024 (fetched 4 Aug 2026)',
    rawTextFile: 'client-travel-and-transport.txt',
  },
  {
    id: 'travel-policy-for-providers',
    title: 'Travel Policy for Providers',
    url: 'https://www.acc.co.nz/assets/provider/supplier-road-travel-guidelines.pdf',
    docType: 'handbook',
    serviceTypes: ['provider-travel', 'nursing', 'physiotherapy', 'occupational-therapy', 'home-and-community-support'],
    versionNote: 'Dated 3 March 2025 — ACC policy on supplier/provider travel claims (distinct from client/patient travel assistance)',
    rawTextFile: 'travel-policy-for-providers.txt',
  },
  {
    id: 'ambulance-road-and-air-service',
    title: 'Ambulance - road and air (Recovery services directory)',
    url: 'https://www.acc.co.nz/for-providers/treatment-recovery/recovery-services-directory',
    docType: 'info-sheet',
    serviceTypes: ['emergency-transport', 'ambulance', 'aeromedical'],
    versionNote: 'Public ACC Recovery services directory section — emergency road/air ambulance purpose, referral, dispatch, and client cost (fetched 4 Aug 2026)',
    rawTextFile: 'ambulance-road-and-air-service.txt',
  },
];

export function sourceDocById(id: string): AccSourceDoc | undefined {
  return ACC_SOURCE_DOCS.find((d) => d.id === id);
}
