# ACC public contract / service-schedule research (2026-08)

Research pass only — **no application code was touched**. This catalogues real,
publicly-fetchable documents from acc.co.nz (and developer.acc.co.nz / gets.govt.nz)
about ACC's *standard national* health-provider contracts, service schedules, fee
schedules, and operational guidelines. Every URL below was actually fetched/searched
today (4 Aug 2026) and returned real ACC content — nothing here is fabricated or
guessed. Where a PDF's substance is summarized, that summary is based on real text
extracted from the document, not assumption.

## 0. TL;DR

There is a **surprising amount** of real, fully public ACC contract material —
far more than the "zero real contract data" audit implies was ever pulled into
AdminSuite. ACC publishes the actual **Service Schedules** (the real contract
annexes with real service-item codes and real dollar prices), **Operational
Guidelines**, and the **Standard Terms and Conditions** for essentially every
major treatment-provider contract type directly as PDFs under
`acc.co.nz/assets/contracts/` and `acc.co.nz/assets/provider/` — no login wall,
no provider-portal gate. This is not marketing copy; it's the literal contract
text suppliers sign, just with the specific supplier's name/signature/contract
number left blank as a template.

Per service type:

| Service type | Real public material found |
|---|---|
| **Nursing** | **Strong.** Full Nursing Services Service Schedule (real NS01–NS20 codes + prices, dated 1 Mar 2025 – 29 Feb 2028) + Operational Guidelines PDF. Plus adjacent Home & Community Support (HCSRTI / HCSMI) schedules that also cover nursing treatment components. |
| **Elective Surgery** | **Strong.** Full Elective Surgery Services Service Schedule (huge real procedure-code price table, e.g. AFT1xx ankle arthrodesis codes with real $ prices) + Operational Guidelines PDF, both currently live/in-term (schedule to 30 Jun 2027). |
| **Physiotherapy** | **Strong.** Covered by the Allied Health Services Service Schedule (real PT01/PT02/etc. codes + prices) *and* the Cost of Treatment Regulations info sheet (ACC1523) for non-contracted physios, *and* a Dec 2025 ACC "Physiotherapy Services Market Review" report with real fee/market data. |
| **Allied Health (broader)** | **Strong for OT/podiatry/hand therapy** (all in the same Allied Health Services Service Schedule as physio). **Moderate for social work** (separate real schedules exist — ISSC, SRNA, Concussion Services — but social work there is bundled into multi-discipline schedules, not a single "social work contract"). |

None of this is Te Whatu Ora's own bilateral contract — see §3.

## 1. How ACC structures this (context for the tables below)

From `acc.co.nz/for-providers/provide-services/contract` (public page, last
published 14 Mar 2024): every ACC health contract is legally three layered
documents:

1. **Cover page + Standard Terms and Conditions** — one shared document
   (`health-contract-terms-conditions.pdf`) used across *all* health contracts.
2. **Service Schedule(s)** — the service-specific annex with eligibility, service
   items, prices, term dates. This is the closest public equivalent to "the
   contract" for a given service type.
3. **Operational Guidelines** — narrative implementation guidance for some
   (not all) service schedules; explicitly subordinate to the Service Schedule
   if they conflict.

New suppliers apply via **GETS** (Government Electronic Tenders Services,
`gets.govt.nz`) tenders; existing contract holders don't re-tender. This
matches what the owner already expected.

## 2. Per service type

### 2.1 Nursing

| URL | Doc type | Covers | Date/version | Public? |
|---|---|---|---|---|
| [nursing-service-schedule.pdf](https://www.acc.co.nz/assets/contracts/nursing-service-schedule.pdf) | Service Schedule (real contract annex) | Nursing Services: NS01 Short Term Package ($525.40), NS02 Medium Term ($1,194.25), NS03 Long Term ($2,316.38), NS04 Extended Nursing ($111.88/consult, prior-approval gated), NS05 Ongoing Nursing ($100.55/hr), NS07 Oversight ($109.00), NS20 Comprehensive Nursing Assessment ($603.62); travel-inclusion rules per code | Term 1 Mar 2025 – 29 Feb 2028 (current/in-force) | **Y** — plain PDF, no login |
| [nurse-og.pdf](https://www.acc.co.nz/assets/contracts/nurse-og.pdf) | Operational Guidelines | How to choose the right package (Table Two service-item overview), consultation counting rules, when Extended Nursing kicks in (after 2 consults or on day X), travel-inclusion narrative | References the same schedule; undated cover but internally consistent with the 2025–2028 schedule | **Y** |
| [HCSRTI-SS.pdf](https://www.acc.co.nz/assets/contracts/HCSRTI-SS.pdf) | Service Schedule | Home & Community Support (Return to Independence) — includes Table 3 "Nursing and Allied Health Support Service Items": HCRIAH1 Physiotherapy ($155.27/hr), HCRIN1 Nursing Treatment (max 10 combined hrs before prior approval needed) | Current | **Y** |
| [HCSMI-Operational-guidelines.pdf](https://www.acc.co.nz/assets/provider/HCSMI-Operational-guidelines.pdf) | Operational Guidelines | Home & Community Support (Maximise Independence) — nursing-treatment component rules (22 consults/3 months before prior approval; HCSNS3/HCSNS4 codes) | Current | **Y** |

**Relation to this app's existing `serviceCodes.ts`/`COMPLIANCE_RULES`:** the
NS01–NS20 codes/prices above are real and can directly validate or correct
whatever nursing codes are currently hard-coded in the app — this is the single
best "ground truth" document found in this whole research pass for the app's
existing nursing focus.

### 2.2 Elective Surgery

| URL | Doc type | Covers | Date/version | Public? |
|---|---|---|---|---|
| [elective-surgery-service-schedule.pdf](https://www.acc.co.nz/assets/contracts/elective-surgery-service-schedule.pdf) | Service Schedule | Real per-procedure price table (e.g. 3DIMAGE1–4 intraoperative imaging $1,390.60–$2,161.84; AFT100/101/102 ankle arthrodesis $11,532.74/$12,240.48/$14,227.34; many more orthopaedic/surgical codes); contracted price = surgery + 6 weeks post-discharge care; implants billed separately at cost | Term 1 Nov 2019 – 30 Jun 2027 (current/in-force) | **Y** |
| [elective-surgery-og.pdf](https://www.acc.co.nz/assets/contracts/elective-surgery-og.pdf) | Operational Guidelines | Contracted vs "regulation" (non-contracted, 60%-funded) surgery funding routes; ARTP (Assessment Report & Treatment Plan) prior-approval process; invoicing rules (12-month invoice deadline, one e-schedule per client, purchase order number, supporting docs required) | References current schedule | **Y** |
| [How to apply](https://www.acc.co.nz/for-providers/provider-contracts-and-services/elective-surgery-services/how-to-apply) | Web page | Facility certification (MoH-certified), named-provider process, GETS tender process, contracted-vs-regulation funding explainer | Live page | **Y** |
| [GETS tender 26159518](https://www.gets.govt.nz/ACC/ExternalTenderDetails.htm?id=26159518) | Tender listing | Confirms existing contract holders don't need to reapply; open tender window through 14 Aug 2026 for new suppliers | Open now (closes 14 Aug 2026) | **Y** (some tender detail sections need a free GETS account) |
| [Submit a request](https://www.acc.co.nz/for-providers/provider-contracts-and-services/elective-surgery-services/submit-a-request) | Web page | ARTP submission channels (HealthLink mailbox ACCEARTP), Non-Prior-Approval procedure list (Appendix 4 of the OG), invoice routing | Live page | **Y** |

### 2.3 Physiotherapy

| URL | Doc type | Covers | Date/version | Public? |
|---|---|---|---|---|
| [allied-health-services-service-schedule.pdf](https://www.acc.co.nz/assets/contracts/allied-health-services-service-schedule.pdf) | Service Schedule | Real physio price table: PT01 Initial Consult $65.97, PT02 Follow-up $49.47, PTCG Group follow-up $31.07, PT1T/PT2T Telehealth variants, PT21/PT22 Offsite variants, PT31/PT32 Health NZ/Te Whatu Ora-specific rates ($84.53/$59.67), PTS1 Physiotherapy Specialist Initial $491.82, PTP1–3 Pelvic Physiotherapy for Maternal Birth Injury ($82.84/$124.25/$165.67); term 1 Nov 2021 – 31 Oct 2026 (physio/hand-therapy/podiatry part) | 1 Nov 2021 – 31 Oct 2026 | **Y** |
| [ACC1523 Specified treatment provider costs](https://www.acc.co.nz/assets/provider/ACC1523-Specified-treatment-provider-costs.pdf) | Regulation info sheet | Cost of Treatment Regulations rates for non-contracted physios (+ acupuncture, chiropractic, OT, osteopathy, podiatry, speech therapy): flat per-treatment $79.34 incl GST, or hourly $68.99 excl GST; legislative clause text (Reg 17) | From 1 June 2024 amendment | **Y** |
| [Physiotherapy-market-review-report-FINAL-10-December-2025.pdf](https://www.acc.co.nz/assets/provider/Physiotherapy-market-review-report-FINAL-10-December-2025.pdf) | Market review report | Independent-style ACC report: fee benchmarking tables (initial vs follow-up fee ranges incl. GST, by region and by contract type), treatment-session cap (50 before extra approval), >95% of CoTR physios use hourly rate not per-session | 10 Dec 2025 (very current) | **Y** |
| [beginners-guide-physiotherapists-webinar-slides.pdf](https://www.acc.co.nz/assets/provider/beginners-guide-physiotherapists-webinar-slides.pdf) | Onboarding slide deck | Side-by-side CoTR vs Allied Health contract explainer, contact emails (alliedhealth@acc.co.nz), links to the two source documents above | Undated webinar deck, content consistent with current rates | **Y** |
| [Paying you for your services](https://www.acc.co.nz/for-providers/invoicing-us/paying-patient-treatment) | Web page | "Specified treatment provider" invoicing rules (time-based vs per-treatment, same-day-treatment limits) | Live page, references 1 June 2024 changes | **Y** |

### 2.4 Allied Health (broader — OT, podiatry, hand therapy, social work)

| URL | Doc type | Covers | Date/version | Public? |
|---|---|---|---|---|
| [allied-health-services-service-schedule.pdf](https://www.acc.co.nz/assets/contracts/allied-health-services-service-schedule.pdf) *(same file as §2.3)* | Service Schedule | Same schedule also covers **Occupational Therapy** and **Podiatry and Hand Therapy** under Part B "Service Schedule for Physiotherapy, Hand Therapy and Podiatry Services" — shared scope-of-practice/registration-body rules (Physiotherapy Board / Occupational Therapy Board / Podiatrists Board of NZ), student-provider rules | 1 Nov 2021 – 31 Oct 2026 | **Y** |
| [ACC1523 Specified treatment provider costs](https://www.acc.co.nz/assets/provider/ACC1523-Specified-treatment-provider-costs.pdf) *(same as §2.3)* | Regulation info sheet | OT01 Occupational Therapy CoTR rate (same $79.34/$68.99 structure as physio) for non-contracted OTs | 1 June 2024 | **Y** |
| [issc-schedule.pdf](https://www.acc.co.nz/assets/contracts/issc-schedule.pdf) | Service Schedule | Integrated Services for Sensitive Claims — real **Social Worker** rates (e.g. SCFW Whānau sessions, SCAL Social work: $136.32/hr, max 10–20 hrs/claim/12 months) alongside psychologist/counsellor rates | Current | **Y** |
| [Sensitive-Claims-Service-Service-Schedule.pdf](https://www.acc.co.nz/assets/contracts/Sensitive-Claims-Service-Service-Schedule.pdf) | Service Schedule | Broader Sensitive Claims Service — Social Work component defined as a discrete service line (up to 30 combined hrs with Whānau Support for under-18s) | Current | **Y** |
| [srna-serivce-schedule.pdf](https://www.acc.co.nz/assets/contracts/srna-serivce-schedule.pdf) | Service Schedule | Social Rehabilitation Needs Assessment — multidisciplinary team requirement (incl. OT/social work), assessment-tool and geographic-area rules | Term 1 Dec 2024 – 30 Nov 2027 | **Y** |
| [concussion-services-service-schedule.pdf](https://www.acc.co.nz/assets/contracts/concussion-services-service-schedule.pdf) | Service Schedule | Concussion Services — core interdisciplinary team incl. OT, physio; non-core team incl. registered nurses, speech therapists, social workers; competency/supervision requirements per discipline | Current | **Y** |
| [psychological-service-schedule.pdf](https://www.acc.co.nz/assets/contracts/psychological-service-schedule.pdf) | Service Schedule | Adjacent allied-health-type schedule (psychology, not requested but found alongside) | Term 1 May 2026 – 30 Apr 2029 (newest term found in this research) | **Y** |

**Note on social work specifically:** unlike physio/OT/podiatry, ACC does not
appear to publish a single standalone "Social Work Services Service Schedule."
Social work is a real, priced service line, but only inside these
multi-discipline schedules (ISSC, Sensitive Claims, SRNA, Concussion). If the
owner's org does social-work-adjacent billing, the relevant real source is
whichever of those 4 schedules matches the referral pathway they actually use.

### 2.5 Bonus / adjacent (found while casting the wider net, per the task's "cast a reasonably wide net" instruction)

| URL | Doc type | Covers | Date/version | Public? |
|---|---|---|---|---|
| [health-contract-terms-conditions.pdf](https://www.acc.co.nz/assets/contracts/health-contract-terms-conditions.pdf) | Standard Terms and Conditions | The shared legal boilerplate underlying *every* ACC health Service Schedule (definitions of Supplier/Service provider/ACC, contract structure) | Template (blank contract-number/party fields) — current in-force version | **Y** |
| [htis-service-schedule.pdf](https://www.acc.co.nz/assets/contracts/htis-service-schedule.pdf) | Service Schedule | High Tech Imaging Services (radiology/MRI) — real procedure prices (e.g. R41 MRI Cervical Spine $830.28, R41A GP-referred variant $664.23), 5 referral pathways, prior-approval-required procedure list | Current | **Y** |
| [htis-og.pdf](https://www.acc.co.nz/assets/contracts/htis-og.pdf) | Operational Guidelines | HTIS referral pathways explainer (specialist referral, GPMRI, GPSI, ICPMSK, direct ACC purchase order) | Current | **Y** |
| [clinical-services-og.pdf](https://www.acc.co.nz/assets/contracts/clinical-services-og.pdf) | Operational Guidelines | Clinical Services contract — umbrella specialist-assessment/treatment pathway that HTIS sits under | Current | **Y** |
| [gp-referred-mri-service-schedule.pdf](https://www.acc.co.nz/assets/contracts/gp-referred-mri-service-schedule.pdf) | Service Schedule | GP-Referred MRI (GPMRI) pathway — direct GP/NP referral to MRI for knee/lumbar/cervical injuries meeting clinical criteria | Current | **Y** |
| [ACC1520 GP/nurse/nurse-practitioner costs](https://www.acc.co.nz/assets/provider/ACC1520-Med-pract-nurse-pract-and-nurses-costs-v2.pdf) | Regulation info sheet | General Practice CoTR rates — consultation rate + procedure codes (M-prefixed, e.g. MW wound closure, MB burns), multi-procedure 100%/50% stacking rule | From 1 June 2024 amendment | **Y** |
| [acc7909-working-together-cotr-providers.pdf](https://www.acc.co.nz/assets/provider/acc7909-working-together-cotr-providers.pdf) | Provider handbook | "Working Together" — general CoTR provider handbook (GPs, nurses, physios, acupuncturists, chiropractors, osteopaths, podiatrists, speech therapists): clinical-justification expectations, billing-proportionality rules, links to source legislation | Current | **Y** |
| [radiologist-quick-guide.pdf](https://www.acc.co.nz/assets/provider/radiologist-quick-guide.pdf) | Onboarding quick-guide | Short radiologist-specific orientation (CoTR vs HTI contract choice) | Current | **Y** |
| ProviderHub pages: [About ProviderHub](https://www.acc.co.nz/for-providers/working-with-us-using-our-digital-services/providerhub/learn-about-providerhub), [How to invoice us](https://www.acc.co.nz/for-providers/invoicing-us/how-to-invoice-us), [Invoicing essentials PDF](https://www.acc.co.nz/assets/provider/how-to-invoice-provider-quick-guide.pdf.pdf) | Web pages + quick-guide PDF | ProviderHub feature list (ACC45 claim lodgement, ACC32 treatment extension, ACC40 invoicing, remittance-advice search); IRD tax-invoice requirements for ACC invoices; payment SLAs (8 business days electronic / 10 manual) | Live | **Y** — pages/PDF; ProviderHub *itself* (the actual logged-in tool) is provider-login-gated, see §5 |
| [Invoicing API](https://developer.acc.co.nz/invoicing-api) | Developer docs | Real EDI-style invoicing API spec reference (`ICS-Invoice-API-v09-portal.pdf`, Swagger design link); requires API key + Health Secure Digital Certificate | Draft spec v09 | **Y** (docs page); actual API access requires provider credentials |

## 3. Explicit call-out — this is NOT Te Whatu Ora's own contract

**None of the documents above are Te Whatu Ora's (or any other specific
provider's) actual signed, negotiated contract with ACC.** Every Service
Schedule found is a **template/national-standard document** — most have blank
`CONTRACT NO: ______` fields, blank named-provider tables, and blank
supplier-notice-address fields waiting to be filled in per-supplier. The real
prices, term dates, eligibility rules, and clause structure in these templates
are genuine and nationally standard (ACC applies the same Service Schedule
text to every supplier of that service type), but:

- The **specific named providers**, **any negotiated variations**, **the
  exact contract number**, and **any organisation-specific side letters**
  Te Whatu Ora actually has on file are private and were not (and could not
  be) found here.
- If Te Whatu Ora's actual contract differs from the public template in any
  way (e.g. a locally negotiated rate, an approved named-provider list, a
  regional variation clause), **only the owner's own contracts/records team
  can supply that** — this research is background grounding, not a
  substitute.

Recommend the app UI make this distinction explicit wherever this material is
surfaced (see recommendation below on assumption banners, consistent with the
rescoping playbook's "surface every assumption as a dismissible banner"
pattern already used elsewhere in this app).

## 4. Recommendation — what's worth ingesting now

Ranked by real, near-term value to AdminSuite's compliance/billing assistant:

1. **Nursing Services Service Schedule + Operational Guidelines** (`nursing-service-schedule.pdf`,
   `nurse-og.pdf`) — **highest priority.** Directly overlaps the app's existing
   nursing focus (`serviceCodes.ts`/`COMPLIANCE_RULES`). The Service Schedule's
   Table 1 (service items/prices) is a genuinely clean, parseable table —
   worth structuring into real `Contract`/`ServiceCode` records (code, name,
   price, pricing unit, travel-inclusion flag, prior-approval threshold).
   The Operational Guidelines PDF is mostly narrative decision logic ("how to
   pick the right package") — better suited to full-text search / RAG than
   structured fields, but still worth ingesting as grounding text so the
   assistant can explain *why* a code applies, not just what it costs.

2. **Allied Health Services Service Schedule** (physio/OT/podiatry/hand
   therapy) — same treatment: Part A price tables (PT01–PTP3 etc.) are clean
   and structurable; Part B clinical/registration-body requirements are
   narrative → RAG.

3. **Elective Surgery Service Schedule** — the procedure-price table (Table 1,
   hundreds of real orthopaedic/surgical codes) is the single largest
   structured price list found and would be valuable if the org does any
   elective-surgery billing, but it's also the largest single ingestion job
   (2,105 lines) — worth scoping to just the procedure categories the owner's
   organisation actually bills, rather than the whole national table.

4. **Cost of Treatment Regulations info sheets** (ACC1520 general practice,
   ACC1523 specified treatment providers) — short, clean, currently-dated
   (June 2024 amendment) rate sheets; easy structured wins for any
   non-contracted-provider billing the org does.

5. **Standard Terms and Conditions** (`health-contract-terms-conditions.pdf`)
   — pure legal boilerplate shared across all contract types. Low priority
   for structured data; only useful as RAG background if the assistant needs
   to answer general "what are our contractual obligations" questions rather
   than pricing/coding questions.

6. **Provider handbooks** (`acc7909-working-together-cotr-providers.pdf`,
   Elective Surgery / HTIS Operational Guidelines) — narrative-only, best as
   RAG/full-text search corpus, not structured records. Useful for
   "explain the rule" style assistant answers.

**Not recommended to ingest as structured data (RAG-only, if at all):** the
Sensitive Claims / ISSC / SRNA / Concussion Services schedules, unless the
owner's organisation actually delivers those specific services — they're real
and current but likely out of scope for a nursing/elective-surgery/physio/
allied-health-focused billing team.

## 5. What's still missing (provider-portal-gated, not achievable via public research)

- **ProviderHub itself** (the live invoicing/claims self-service tool) requires
  a registered-provider login. The public pages above describe *what it does*,
  but not live account-specific data (actual invoice history, actual named
  providers on file, actual remittance advices) — only the owner, as an
  enrolled provider, can pull that.
- **The org's actual contract number, named-provider list, and any negotiated
  variations** to the standard Service Schedules — these live inside ACC's
  and/or the owner's own contracts/records systems, not on the public site.
  Only the owner's contracts/records team can supply the real signed
  document.
- **Invoicing API production access** (the actual EDI/SOAP integration) needs
  an API key + Health Secure Digital Certificate issued to a specific
  registered provider — the spec PDF is public, but live API access is not.
- **GETS tender detail pages** for some tenders require a free GETS account
  to view full RFT documents (the summary/overview page was viewable without
  one, per §2.2).

None of the above can be resolved by further public web research — they
require the owner's own provider credentials or their organisation's internal
contracts records, exactly as the owner already anticipated.

## 6. Follow-up ingestion candidate found 2026-08-04 — travel / emergency transport billing

While investigating an owner-reported AI-chat quality bug (the assistant was asked
about emergency-vs-non-emergency **flight/travel transport billing** — a patient
choosing Auckland over a geographically closer Wellington for surgery), a search of
the actually-ingested `public/data/acc/knowledge-chunks.json` corpus (415 chunks
across the 8 currently-ingested source documents: `nursing-service-schedule`,
`nurse-og`, `elective-surgery-service-schedule`, `elective-surgery-og`,
`allied-health-services-service-schedule`, `health-contract-terms-conditions`,
`acc1523-specified-treatment-provider-costs`, `acc7909-working-together-cotr-providers`)
found only 3 chunks mentioning travel/flight/transport at all, and all 3 are about
**provider** travel (a treating nurse travelling to a client's home, invoiced via
Travel service items under the Nursing Services Service Schedule) — none address
**patient** travel/flight assistance, emergency-vs-non-emergency transport
classification, or ACC's mileage/accommodation cost-coverage rules.

One nursing-schedule chunk (`nursing-service-schedule#27`) explicitly references
**"ACC's Travel Policy for Providers (available on ACC's website)"** as the actual
governing document for those provider travel expenses — that document was never
searched for, fetched, or ingested during the original Aug 2026 research pass
(§0–§5 above), which was scoped to nursing/elective-surgery/allied-health service
schedules + their operational guidelines + the Standard Terms and Conditions. ACC
also very likely publishes a separate patient-facing travel/accommodation
assistance policy (client travel and accommodation cost coverage, including any
emergency-vs-non-emergency air-travel distinction) that is a different document
again from the provider-travel-reimbursement policy referenced above — neither was
found in, or was ever in scope for, the 4 currently-ingested schedules.

**Conclusion: this is a genuine content-coverage gap, not a retrieval-algorithm bug.**
The TF-IDF-lite scorer (`knowledgeRetrieval.ts`) correctly found the closest real
content that exists in the corpus (ARTP priority classification, nursing eligibility
and service-location rules) — there is no chunk about patient flight/travel billing
criteria in the corpus for it to have missed. Confirmed live at the fix in this same
pass: the AI-chat system prompt now instructs the model to say the reference
material it has doesn't specifically cover a topic, rather than either denying
document access outright or inventing an answer, once a gap like this is genuinely
hit — see `src/lib/aiChatContext.ts` `AI_ASSISTANT_SYSTEM_PROMPT`.

**Recommended future ingestion pass (not done in this task — scoped separately):**
research and ingest ACC's actual "Travel Policy for Providers" (referenced by name
above) and, separately, ACC's patient/client travel-and-accommodation assistance
policy (the document that would define any emergency-vs-non-emergency air-travel
billing distinction), using the same public-fetch-and-chunk methodology as §1–§5
above. Both would need to be confirmed as real, currently-fetchable public
documents (not assumed) before ingestion, per this doc's own "nothing here is
fabricated or guessed" standard.

## 7. Follow-up ingestion candidate found 2026-08-04 — emergency transport / ambulance triage criteria

A repeat/related owner-reported AI-chat quality bug: asked about **emergency
transport criteria** (again framed around a real Auckland-vs-Wellington
scenario), the assistant invented a fully fabricated, confident-sounding
**"Red/Silver/Gold/Green" ambulance triage classification** attributed to "New
Zealand's ambulance services", plus invented specific clinical criteria/
timeframes (e.g. "MI >30 min for PCI", "stroke patients <3hrs for
thrombolysis") — then cited "Sources (3)" that were real retrieved chunks
about completely unrelated topics (Elective Surgery ARTP priority
classification; Nursing client travel/GPT eligibility), attached only because
they weakly/coincidentally shared a few common words with the question, not
because they actually addressed it.

Searched the same ingested `public/data/acc/knowledge-chunks.json` corpus
(415 chunks, same 8 source documents as §6) directly for ambulance/emergency-
transport-criteria content:

| Term searched | Chunks found | What they actually are |
| --- | --- | --- |
| `ambulance` | 1 | `elective-surgery-og` — a single passing mention of "ambulance transfer" as an example of a billable **ESR13 unusual/unspecified cost** line item (equipment hire/ambulance transfer with supplier invoice), not any triage/eligibility criteria |
| `emergency transport` | 0 | none |
| `triage` | 2 | `nursing-service-schedule` and `allied-health-services-service-schedule` — both about **ARTP/service prioritisation for elective procedures**, unrelated to ambulance dispatch |
| `thrombolysis` / `PCI` / `red/silver` | 0 each | none |

**Conclusion: this is a genuine content-coverage gap, not a retrieval-algorithm
bug** — the same pattern as §6's patient-travel gap. No ingested document
addresses ambulance dispatch/emergency-transport eligibility criteria, clinical
triage timeframes, or any named triage classification scheme at all; the
"Red/Silver/Gold/Green" system, the specific clinical timeframes, and the
implied linkage to Elective Surgery ARTP/Nursing travel content were all
invented by the model, not retrieved.

Fixed in the same pass (not ingestion — see `src/lib/aiChatContext.ts` and
`src/lib/ai/knowledgeRetrieval.ts`):
1. **Citation integrity** — retrieval's `minScore` cutoff (`MIN_RELEVANT_SCORE`
   in `knowledgeRetrieval.ts`, was `0`) now excludes not just zero-overlap
   chunks but weakly/coincidentally-overlapping ones too, so a genuinely
   off-topic question like this one now retrieves **zero** chunks (no
   "Sources" shown at all) instead of the 2-3 nearest-but-irrelevant chunks
   that got misleadingly cited before.
2. **System-prompt "OK to say you don't know"** — new explicit instructions
   telling the model it is fine, and preferred, to say its knowledge base
   doesn't specifically cover a topic (or to ask one brief clarifying
   question on an ambiguous request) rather than fabricate a confident,
   fully-structured answer; and to never cite a retrieved source as if it
   supports content it does not actually contain.

**Recommended future ingestion pass (not done in this task — scoped
separately):** research and ingest ACC's real ambulance/emergency-transport
policy (e.g. any published criteria for ACC-funded ambulance transport,
inter-hospital transfer, or air ambulance eligibility), confirmed as a real,
currently-fetchable public document (not assumed) before ingestion, per this
doc's own "nothing here is fabricated or guessed" standard.

## 8. Proactive coverage audit (2026-08-04) — what else is missing, found *before* a bad answer this time

§6 and §7 above were both found *reactively* — an owner asked the assistant a
real question, got a fabricated answer, and only then did an investigation
find the corpus never covered that topic. This section is the proactive
follow-up the owner asked for: systematically checking a broad list of
topics a real case worker/nursing biller in this app would plausibly ask
about, against the actually-ingested corpus, **before** anyone hits another
bad answer.

### 8.0 Method

1. Read this app's own domain model (`src/types/index.ts`) to ground the
   topic list in what this app's real entities/workflows actually are —
   **not** a generic guess, and notably **not** an equipment-loan domain: this
   is the ACC District Nursing Admin Suite (`Patient`, `Claim`, `ServiceLine`,
   `Approval`, `InvoiceLine`, `Decline`, `Contract`, `Memo`, case-workflow
   stages) — nursing/elective-surgery/allied-health claims and billing, with
   no equipment-loan/return entity or workflow anywhere in the schema. (The
   task that requested this audit assumed an "equipment/loan tracker"
   adjacency that does not actually apply to this specific app; noted here so
   the topic list below is grounded in the real schema instead.)
2. Built a candidate topic list (below) combining: (a) topics named in the
   task brief, (b) topics implied directly by real fields/entities in
   `types/index.ts` — e.g. `Decline`/`DeclineStatus` implies "what happens
   after a decline" is a real, recurring workflow; `ClaimType: 'original' |
   'subsequent'` implies eligibility-for-a-new-vs-linked-claim questions;
   `Contract`/GST/invoicing fields imply billing-mechanics questions.
3. For each topic, searched the actual ingested
   `public/data/acc/knowledge-chunks.json` corpus (415 chunks, the same 8
   source documents as §6/§7 — no ingestion has happened since) for
   topic-specific terms, the same technique used by hand in the §6/§7
   investigations, now also captured as a reusable script (§8.3).
4. Spot-checked every non-zero hit's actual surrounding text (not just the
   count) — several keyword hits turned out to be false positives from an
   unrelated clinical/legal meaning of the same word (see "minor" and
   "vocational" in the table below), which a naive automated count alone
   would have wrongly marked as "covered."

### 8.1 Findings — prioritized gap list

**(c) Zero coverage — same category as the §6/§7 gaps:**

| Topic | Why a user would plausibly ask this | Evidence | Priority |
|---|---|---|---|
| **Client review & appeal rights after a decline** | The app has a first-class `Decline` record with `DeclineStatus` values (`Awaiting response from ACC`, `Declined again`, etc.) — a case worker handling a repeat decline will plausibly ask "what are the client's/our review or appeal options" | 0 chunks for `appeal`, `review right`, `reconsideration`, `district court`, `section 135` across all 415 chunks. The 5 `dispute` / 3 `complaint` hits that do exist are all about the **provider-vs-ACC contract dispute clause** (health-contract-terms-conditions §19) — a completely different thing (supplier billing disagreement, not a client's statutory right to challenge an ACC cover/entitlement decision under the Accident Compensation Act 2001) | **High** — this is a real, recurring case-worker workflow (the app already models it via `Decline`), not an edge case |
| **Client complaints process** (Code of Health and Disability Services Consumers' Rights) | Distinct from the review/appeal path above — "how does a client raise a service-quality complaint" | Only 1 passing mention of "Code of Health and Disability Services Consumers' Rights" (`health-contract-terms-conditions#14`), framed as a *supplier's* contractual obligation to cooperate with an ACC-received complaint — no client-facing "how to complain" guidance ingested | **Medium** |
| **Non-resident / historical-claim eligibility (beyond the one incidental mention found)** | `Claim.type` distinguishes `original`/`subsequent`; a case worker will eventually hit an overseas-injury, returning-resident, or years-old-claim scenario | Only 1 real, useful chunk exists at all (`acc7909-working-together-cotr-providers#7`: NZ residents injured overseas within 6 months, temporary visitors covered) — a real fact, but a single sentence, not a policy document; "historical claim" itself: 0 chunks | **Medium** |
| **Sensitive claims** | Real, separate ACC service line (ISSC/Sensitive Claims Service schedules identified as real public documents in §2.4, deliberately not ingested as out-of-scope for a nursing/surgery/allied-health team) | 0 chunks for `sensitive claim` | **Low** — genuinely out of this app's core service-line scope per §2.4's own recommendation; only relevant if the org's caseload ever includes sensitive claims |
| **Independence allowance / whole-person impairment** | A real, distinct ACC entitlement a client's claim can also involve | 0 chunks | **Low** — not a nursing/surgery/allied-health billing concern; adjacent ACC entitlement, not this team's workflow |
| **Home modifications** | Real ACC-funded support, adjacent to the equipment/orthotics content that *is* well covered for the 6-week post-surgery window | 0 chunks (distinct from the well-covered short-term post-surgery equipment/orthotics content — see §8.1's "well covered" list below) | **Low-Medium** |

**(b) Partially covered / thin — real content exists but is narrow, tangential, or a single sentence:**

| Topic | Why a user would plausibly ask this | Evidence | Priority |
|---|---|---|---|
| **Weekly compensation interactions with treatment** | Weekly compensation is a common concurrent entitlement for the same client whose nursing/surgery claim this app tracks | 5 chunks, but every one is either (a) surgery-priority-classification criteria ("H3 Receiving weekly compensation" as an *urgency factor* for elective surgery ARTP scoring) or (b) a passing example of a "negative response" trigger (`nurse-og#64`) — no chunk actually explains weekly compensation's own eligibility/rate/interaction rules | **Medium** |
| **Vocational rehabilitation / return-to-work support** | Same client population; case workers coordinate around return-to-work timelines | Naive keyword count looks reasonable (41 hits for `rehabilitation`, 9 for `vocational`), but manual inspection found most `vocational` hits are actually about **surgeon vocational registration/scope of practice** (an unrelated legal meaning) — genuine vocational-rehab-as-a-client-service content is really only 1 real passage (`acc7909-working-together-cotr-providers#10`, on medical certification enabling weekly compensation + vocational rehab access) plus a handful of incidental `return to work` mentions | **Medium** |
| **Cultural / whānau support provisions** | App's own nursing schedule text explicitly commits to "reduce disruption to the Client and their whānau/family" (`nursing-service-schedule#25`) and Treaty-of-Waitangi obligations (`health-contract-terms-conditions#20`) — real content exists, but it's contractual-obligation boilerplate, not practical guidance a case worker could act on (e.g. what whānau-support services/hours are actually available) | 12 chunks total across `cultural`/`whānau`/`Māori`, all either Treaty-obligation clauses or a single "reduce disruption" sentence — no operational whānau-support service description (compare to the real, but not-ingested, ISSC/Sensitive Claims Whānau Support service line identified in §2.4) | **Low-Medium** |
| **Accredited Employer claims** | `Contract.providerName`/`claimsEmail` fields were explicitly modeled "after the sibling ACC-RemittanceTracker suite's `AccreditedEmployer` shape" per this codebase's own type comment — a case worker could plausibly ask how an Accredited Employer claim differs from a standard ACC claim | 6 chunks, but every one is the **glossary definition** of "Accredited Employer" from the Standard Terms and Conditions (`health-contract-terms-conditions#3/#7/#23`) — real, but zero operational/process guidance on billing or handling an actual Accredited Employer claim | **Medium** |
| **Provider accreditation / named-provider requirements** | Case workers may field "is this provider accredited/named for this service" questions | 31 hits, mostly real and substantive (registration-board requirements, named-surgeon requirements for elective surgery) — genuinely reasonably well covered, listed here only because the *general* "how does a provider become accredited/named" process (vs. the specific competence/registration requirements) isn't separately covered | **Low** |
| **Telehealth eligibility (allied health, beyond nursing)** | Physiotherapy/OT/podiatry telehealth codes (`PT1T`/`PT2T` per §2.3's table) are real and priced, but ingested telehealth *guidance* content (19 hits) is almost entirely about **nursing** `NS20T` telehealth assessments — allied-health telehealth eligibility criteria specifically aren't covered by any narrative chunk | **Low-Medium** |

**Well covered (spot-checked, no action needed):** GST/invoicing mechanics (62
chunks, real and substantive), privacy/consent (49 chunks, real — Privacy Act,
Health Information Privacy Code, informed consent for telehealth
assessments), short-term post-surgery equipment/orthotics/aids (27 chunks,
real and detailed — six-week funding window, specific item examples), prior
approval processes (49 chunks), case-stage discharge/handoff narrative (44
chunks, real nursing-discharge-summary content — note this is about
discharging a *client from a supplier's nursing service*, not the app's
`ClaimStatus: 'discharged'` concept at the whole-claim level, which is a
narrower but related idea worth keeping distinct if the assistant is ever
asked directly "when is a claim closed").

### 8.2 Why didn't we catch these before — grounded in what was actually found

Not just "coverage was built by which documents we happened to find" in the
abstract — concretely, in this corpus:

1. **The original Aug 2026 research pass (§1–§5) was scoped by *service
   type* (nursing/elective-surgery/physio/allied-health), not by *client-
   facing process*.** Every one of today's zero-coverage findings — review/
   appeal, complaints, sensitive claims, independence allowance, home
   modifications — is a **cross-cutting client-rights or client-entitlement**
   topic that doesn't live inside any nursing/surgery/allied-health Service
   Schedule at all; it lives in the Accident Compensation Act itself or in
   separate, un-ingested schedules (ISSC/Sensitive Claims). A service-type-
   scoped research pass structurally cannot surface a topic that isn't
   *inside* any of the documents it was scoped to look at — this is the same
   root cause §6 and §7 already identified for travel/ambulance, just now
   confirmed to also apply to several *other* topics, not a one-off.
2. **Keyword-count coverage checks (including this audit's own first pass,
   and the sketch script in §8.3) can look "covered" when they aren't**,
   because a term can be real and present for a completely different sense
   than the one a user means — confirmed twice in this pass alone (`minor`
   matching surgical bone-graft codes not "minor" as in child; `vocational`
   matching surgeon registration scope, not vocational rehabilitation).
   Anyone relying on a fast automated count (including future runs of
   §8.3's script) needs to spot-check the actual matching text, not just
   trust a non-zero count, exactly as this audit had to do by hand.
3. **The 8 ingested documents are themselves supplier/provider contract
   documents (Service Schedules, Operational Guidelines, Standard Terms and
   Conditions) — they describe what ACC pays a *provider* for, not a
   client's statutory rights.** Review/appeal rights, the Code of Health and
   Disability Services Consumers' Rights, and similar client-protection
   topics are legally a different document family (legislation/consumer-
   rights guidance, not provider Service Schedules) that was never going to
   appear in this corpus regardless of how many more nursing/surgery/allied-
   health documents got added — this is a *document-family* gap, not just a
   missing individual PDF.

### 8.3 Recommended lightweight ongoing practice

A new script, `scripts/check-knowledge-coverage.mjs`
(`npm run check-knowledge-coverage`), sketches a repeatable version of the
manual keyword-search technique used in §6, §7, and this section: it holds a
small, growable list of topic names + search terms, counts matching chunks
in the real ingested corpus, and reports `[ZERO]` / `[THIN]` / `[OK]` per
topic. It currently seeds the exact topics found zero/thin in §8.1 above (so
re-running it after a future ingestion pass shows whether a gap was actually
closed) plus the two already-known §6/§7 gaps.

This is intentionally a small report script, not a new system: run it by hand
(a) before pointing users at the assistant for a genuinely new use case, or
(b) periodically (e.g. before a release) — not on every commit, and its exit
code is always 0 (informational, not a CI gate). Per §8.2's finding #2 above,
always spot-check a topic's actual matching chunk text before trusting a
non-zero count as real coverage — the script deliberately does not attempt
that judgment call itself.
