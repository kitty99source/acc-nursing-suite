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
