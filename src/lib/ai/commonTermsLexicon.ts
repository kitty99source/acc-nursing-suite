// ============================================================================
// Common-terms lexicon for the AI chat assistant (2026-08-04).
//
// Short acronym / glossary facts that nursing-admin users hit constantly
// (PHAS, GPT, PHO, …). Distinct from:
//   - Static COMPLIANCE_RULES (package-cap / approval logic) — see knowledgeBase.ts
//   - Ingested RAG corpus (full contract PDFs) — see knowledgeCorpus.ts
//
// Only matching terms are injected into the model prompt for a turn (never the
// whole lexicon). Lexicon hits also count as grounding for the hard gate so
// the model is allowed to answer — with this verified text — instead of
// refusing or inventing expansions.
//
// How to add a term: append an entry to COMMON_TERMS_LEXICON below (term,
// expansion, short definition, source note). Prefer official ACC / MoH /
// legislation wording; if ambiguous, say so in `definition` rather than
// guessing. See docs/ai-features-setup.md § Common-terms lexicon.
// ============================================================================

export interface LexiconTerm {
  /** Canonical acronym or short key, e.g. "PHAS". */
  term: string;
  /** Optional alternate spellings / full-phrase triggers (matched case-insensitively). */
  aliases?: string[];
  /** Expanded form shown to the model. */
  expansion: string;
  /** One or two sentences of grounded fact — no invented policy. */
  definition: string;
  /** Optional extra operational note (e.g. how it relates to district nursing). */
  notes?: string;
  /** Short source citation for humans / "how do we know". */
  source: string;
}

/**
 * Starter set of high-frequency ACC / NZ health-admin acronyms for this suite.
 * Keep entries short — detailed schedule rules stay in COMPLIANCE_RULES / RAG.
 */
export const COMMON_TERMS_LEXICON: LexiconTerm[] = [
  {
    term: 'PHAS',
    aliases: ['Public Health Acute Services'],
    expansion: 'Public Health Acute Services',
    definition:
      'ACC funds acute treatment for covered personal injuries delivered in publicly funded ' +
      'hospitals via an annual Crown agreement with the Ministry of Health (Vote: Health), not ' +
      'via ACC’s direct community nursing contracts. Defined in the IPRC (Public Health Acute ' +
      'Services) Regulations 2002 and referenced in the Accident Compensation Act 2001 s 301.',
    notes:
      'District / community nursing under ACC’s Nursing Services contract is generally NOT ' +
      'PHAS. The Nursing Services Service Schedule excludes providing Nursing Services while a ' +
      'client’s covered injury is being managed acutely under PHAS by a Health NZ district or ' +
      'other PHAS provider. Community nursing after discharge / primary-care referral is ' +
      'purchased separately by ACC (non-PHAS).',
    source:
      'ACC/MoH Accident Services guide (PHAS definition); ACC Nursing Services Service Schedule ' +
      'cl 3.3 (PHAS exclusion). https://www.acc.co.nz/assets/provider/accident-services-a-guide-for-dhb-and-acc-staff.pdf',
  },
  {
    term: 'PHO',
    aliases: ['Primary Health Organisation', 'Primary Health Organizations'],
    expansion: 'Primary Health Organisation',
    definition:
      'A New Zealand primary-care network organisation that funds/supports general practices ' +
      'and related primary health services. Not the same as PHAS (Public Health Acute Services) ' +
      'and not an ACC hospital-acute funding stream.',
    source: 'NZ primary health system terminology; keep distinct from ACC PHAS.',
  },
  {
    term: 'ARTP',
    aliases: ['Assessment Report and Treatment Plan'],
    expansion: 'Assessment Report and Treatment Plan',
    definition:
      'The prior-approval request process used for most contracted ACC elective surgery: the ' +
      'surgeon submits an ARTP for ACC approval before surgery proceeds (some Appendix 4 ' +
      'procedures are non-prior-approval).',
    source: 'ACC Elective Surgery Operational Guidelines (public contract docs).',
  },
  {
    term: 'GPT',
    aliases: ['General Practice Team'],
    expansion: 'General Practice Team',
    definition:
      'The client’s enrolled general practice team. ACC Nursing Services are for injury-related ' +
      'nursing needs that cannot be delivered by the GPT.',
    source: 'ACC Nursing Services Operational Guidelines / Service Schedule.',
  },
  {
    term: 'DHB',
    aliases: ['District Health Board', 'District Health Boards'],
    expansion: 'District Health Board',
    definition:
      'Former regional public hospital/health funder-provider organisations in New Zealand. ' +
      'Public hospital services are now delivered under Health New Zealand – Te Whatu Ora; older ' +
      'ACC documents still say DHB.',
    source: 'NZ health system restructure; ACC Accident Services guide still uses DHB language.',
  },
  {
    term: 'Te Whatu Ora',
    aliases: ['Health New Zealand', 'Health NZ', 'HNZ'],
    expansion: 'Health New Zealand – Te Whatu Ora',
    definition:
      'The national public health system entity that replaced DHBs for delivering publicly ' +
      'funded hospital and many community health services. ACC Nursing Schedules refer to ' +
      '“Health New Zealand - Te Whatu Ora district” in PHAS exclusion wording.',
    source: 'ACC Nursing Services Service Schedule; NZ health system naming.',
  },
  {
    term: 'NHI',
    aliases: ['National Health Index'],
    expansion: 'National Health Index',
    definition:
      'New Zealand’s unique patient identifier used across health and ACC claim documentation.',
    source: 'NZ Ministry of Health NHI; used throughout this app’s patient/claim records.',
  },
  {
    term: 'PO',
    aliases: ['purchase order', 'purchase order number'],
    expansion: 'Purchase order',
    definition:
      'ACC purchase-order / approval reference often required before billing certain services ' +
      '(e.g. second nursing package, NS04 Extended Nursing). Tracked on claims in this app.',
    source: 'ACC provider invoicing practice; this app’s compliance rules (second package / NS04).',
  },
  {
    term: 'AE',
    aliases: ['Accredited Employer', 'Accredited Employers'],
    expansion: 'Accredited Employer',
    definition:
      'An employer accredited under ACC’s Accredited Employers Programme that manages work-related ' +
      'injury claims for its employees (often via a third-party administrator) instead of standard ' +
      'ACC case management. Distinct from PHAS funding.',
    source: 'ACC Accredited Employers Programme; Allied Health OG §20; this app’s reason codes.',
  },
  {
    term: 'CoTR',
    aliases: ['Cost of Treatment Regulations', 'Cost of Treatment Regulation'],
    expansion: 'Cost of Treatment Regulations',
    definition:
      'The regulatory payment pathway for certain ACC treatment (as opposed to a specific ' +
      'service-schedule contract). Nursing OGs note limits on mixing CoTR nursing with Nursing ' +
      'Services contract care for the same injury.',
    source: 'ACC Nursing Services Operational Guidelines / Service Schedule.',
  },
  {
    term: 'NS01',
    aliases: ['Short Term Nursing Package'],
    expansion: 'Short Term Nursing Package',
    definition:
      'ACC Nursing Services packaged service item for short-term community nursing (travel and ' +
      'low-cost consumables included in the package price).',
    source: 'ACC Nursing Services Service Schedule Table 1.',
  },
  {
    term: 'NS02',
    aliases: ['Medium Term Nursing Package'],
    expansion: 'Medium Term Nursing Package',
    definition:
      'ACC Nursing Services packaged service item for medium-term community nursing.',
    source: 'ACC Nursing Services Service Schedule Table 1.',
  },
  {
    term: 'NS03',
    aliases: ['Long Term Nursing Package'],
    expansion: 'Long Term Nursing Package',
    definition:
      'ACC Nursing Services packaged service item for long-term community nursing.',
    source: 'ACC Nursing Services Service Schedule Table 1.',
  },
  {
    term: 'NS04',
    aliases: ['Extended Nursing'],
    expansion: 'Extended Nursing',
    definition:
      'Per-consultation Extended Nursing under the Nursing Services contract — typically after ' +
      'the 25-consult / 105-day package threshold; requires ACC prior approval. Detailed rules ' +
      'live in this app’s static compliance KB.',
    source: 'ACC Nursing Services Service Schedule; AdminSuite COMPLIANCE_RULES.',
  },
  {
    term: 'NS05',
    aliases: ['Ongoing Nursing'],
    expansion: 'Ongoing Nursing',
    definition:
      'Ongoing community nursing service item; subject to annual review / Comprehensive Nursing ' +
      'Assessment expectations in this app’s compliance rules.',
    source: 'ACC Nursing Services Service Schedule; AdminSuite COMPLIANCE_RULES.',
  },
  {
    term: 'NS06',
    aliases: ['Subsequent Injury'],
    expansion: 'Subsequent Injury (nursing service item)',
    definition:
      'Subsequent-injury nursing treatments on a claim; more than 50 on one claim require ACC ' +
      'approval per this app’s compliance rules.',
    source: 'AdminSuite COMPLIANCE_RULES (NS06 threshold).',
  },
  {
    term: 'NS07',
    aliases: ['Oversight Consultation', 'Oversight'],
    expansion: 'Oversight Consultation',
    definition:
      'Oversight consultation service item; first per claim is typically approval-free, second ' +
      'and later need prior ACC approval.',
    source: 'AdminSuite COMPLIANCE_RULES (NS07).',
  },
  {
    term: 'CNA',
    aliases: ['Comprehensive Nursing Assessment'],
    expansion: 'Comprehensive Nursing Assessment',
    definition:
      'In-depth nursing assessment used with ongoing nursing pathways (often coded NS20/NS20T ' +
      'in schedules); related to annual review expectations for NS05.',
    source: 'ACC Nursing Services schedules; AdminSuite compliance copy.',
  },
  {
    term: 'DP',
    aliases: ['Designated Provider'],
    expansion: 'Designated Provider',
    definition:
      'A Registered Nurse or Nurse Practitioner meeting Designated Provider criteria on a ' +
      'Nursing Services supplier’s staff (postgraduate quals / experience). From 1 March 2025 ' +
      'ACC pre-approval of DPs is not required; the supplier must still have at least one DP.',
    source: 'ACC Nursing Services Operational Guidelines (Designated Provider).',
  },
  {
    term: 'ACC',
    aliases: ['Accident Compensation Corporation'],
    expansion: 'Accident Compensation Corporation',
    definition:
      'New Zealand’s no-fault accident compensation scheme / Crown entity that covers treatment ' +
      'and rehabilitation for personal injury.',
    source: 'acc.co.nz.',
  },
  {
    term: 'Service Schedule',
    aliases: [
      'service schedules',
      'ACC schedule',
      'ACC schedules',
      'schedule',
      'schedules',
      'other schedules',
      'schedules like this',
      'service contract',
      'service contracts',
    ],
    expansion: 'ACC Service Schedule (provider contract schedule)',
    definition:
      'In ACC provider work and this app, a “schedule” / “Service Schedule” / “contract” usually ' +
      'means ACC’s published national provider Service Schedule for a service type — the document ' +
      'that sets covered services, service codes, and prices (e.g. Nursing Services Service ' +
      'Schedule, Elective Surgery Services Service Schedule, Allied Health Services Service ' +
      'Schedule). Not a school timetable, bus route, or calendar roster.',
    notes:
      'When users ask for “other schedules like this” after nursing/PHAS discussion, summarise ' +
      'other distinct ingested ACC schedules (Elective Surgery, Allied Health / physio, vocational ' +
      'rehab where available) with real source titles — do not invent non-ACC industry schedule ' +
      'taxonomies.',
    source:
      'ACC public contract PDFs ingested in this app (Nursing / Elective Surgery / Allied Health ' +
      'Service Schedules and Operational Guidelines).',
  },
];

/** Cap how many lexicon entries we inject even if many acronyms appear in one question. */
export const MAX_LEXICON_TERMS_INJECTED = 6;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `needle` appears as a whole word/phrase in `haystack` (case-insensitive). */
function containsPhrase(haystack: string, needle: string): boolean {
  const n = needle.trim();
  if (!n) return false;
  // Multi-word aliases: loose whitespace; single tokens: word boundary (digits ok for NS04).
  const pattern =
    n.includes(' ')
      ? escapeRegExp(n).replace(/\s+/g, '\\s+')
      : `\\b${escapeRegExp(n)}\\b`;
  return new RegExp(pattern, 'i').test(haystack);
}

/**
 * Returns lexicon entries that match the user query (term or alias hit).
 * Order: longer/more specific terms first among hits, then lexicon order.
 * Never returns the full lexicon — empty when nothing matches.
 */
export function matchLexiconTerms(
  query: string,
  opts: { maxTerms?: number } = {},
): LexiconTerm[] {
  const maxTerms = opts.maxTerms ?? MAX_LEXICON_TERMS_INJECTED;
  const q = query.trim();
  if (!q) return [];

  const hits: LexiconTerm[] = [];
  for (const entry of COMMON_TERMS_LEXICON) {
    const keys = [entry.term, ...(entry.aliases ?? [])];
    if (keys.some((k) => containsPhrase(q, k))) {
      hits.push(entry);
    }
  }

  // Prefer longer term keys when both e.g. "Te Whatu Ora" and a shorter alias could apply —
  // stable sort by canonical term length desc, then original order.
  hits.sort((a, b) => b.term.length - a.term.length);
  return hits.slice(0, maxTerms);
}

/**
 * System-prompt section for matched lexicon terms only. Empty string when no hits.
 */
export function buildLexiconSections(terms: LexiconTerm[]): string[] {
  if (terms.length === 0) return [];
  const block = terms
    .map((t) => {
      const note = t.notes ? ` ${t.notes}` : '';
      return (
        `- ${t.term} (${t.expansion}): ${t.definition}${note} ` +
        `[Source note: ${t.source}]`
      );
    })
    .join('\n');
  return [
    'REFERENCE MATERIAL for this turn only — common-terms lexicon entries that matched THIS ' +
      'question (short acronym/glossary facts; NOT the full lexicon, NOT prior user messages). ' +
      'Use these definitions when the user asks what a term means or whether a service falls ' +
      'under it. Do not invent alternate expansions (e.g. do not mash PHAS into PHO):\n' +
      block,
  ];
}
