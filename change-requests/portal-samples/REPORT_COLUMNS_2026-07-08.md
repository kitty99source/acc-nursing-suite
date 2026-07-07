# ACC District Nursing Visits — Report Columns (2026-07-08)

**Source screenshot:** [`acc-district-nursing-visits-report-redacted.png`](./acc-district-nursing-visits-report-redacted.png)  
**Report:** SSRS paginated report — **ACC District Nursing Visits**  
**Breadcrumb:** Home → DHB-wide → ACC → ACC District Nursing Visits  
**Pagination:** Page 1 of 2 (report toolbar visible)

---

## What this report is (plain English)

This is a **DHB-wide ACC district nursing activity report** in the hospital **Health & BI Reports** portal (SQL Server Reporting Services). It lists patients who have received district nursing under ACC, grouped by **service item code** (NS01–NS05 etc.), with **visit counts**, **total activity minutes**, **days on service**, and the **most recent visit date**. The **Notes** column holds free-text clinical/admin context (care frequency, date ranges, claim references).

Staff use it to **cross-check ACC letters and PO renewals** against what the DHB has recorded — e.g. confirm claim number, service code, visit volume, and whether care is still active.

---

## Columns visible (screenshot 2026-07-08)

| # | SSRS column header | Sample values (non-PHI) | ACC Suite mapping | Notes |
|---|-------------------|-------------------------|-------------------|-------|
| 1 | **NHI** | *(redacted)* | `Patient.nhi` | Primary patient key for cross-check with letters |
| 2 | **Patient Name** | *(redacted)* | `Patient.name` | Display / letter match |
| 3 | **Domicile** | Waiopehu, Kelvin Grove, Pahiatua, … | *(no direct field)* | Geographic/suburb; store in `Patient.notes` or `customFields` if needed for scrape |
| 4 | **Service Item Code** | `ACC NS05`, `ACC NS04`, `ACC NS01`, … | `Approval.serviceCode` / `ServiceLine.serviceCode` | Strip `ACC ` prefix → suite `ServiceCode` enum (`NS05`, etc.) |
| 5 | **ACCNumber** | *(redacted)* | `Claim.claimNumber` | Also appears in letter subjects as `Claim:{digits}` |
| 6 | **Activity Time (In Minutes)** | 1510, 720, 60, 360, … | `Approval.approvedHoursOrConsults` *(approx)* | Report shows **minutes**; suite approvals often store **hours/consults** — confirm unit on import |
| 7 | **Total Visits** | 50, 20, 2, 13, … | `ServiceLine.consultCount` | Visit count for billing/compliance cross-check |
| 8 | **Total days** | 338, 59, 16, 50, … | *(derived)* | Span of care; may map to date range between `Approval.approvalStartDate` and `lastConsultDate` |
| 9 | **Most Recent Visit** | 2 Jul 2026, 17 Apr 2026, … | `ServiceLine.lastConsultDate` | Display format `D MMM YYYY`; normalize to ISO on import |
| 10 | **Notes** | ONN date ranges, hrs/wk, Claim No. … | `Approval.notes` / `Patient.notes` | Long free-text; may embed claim refs and care plans |

**Row grain:** One row per **patient + service item code** (same patient can appear on multiple rows for NS04 vs NS05).

---

## Why Portal Discover did not capture table rows (not user error)

Portal Discover (`portal-discover.ps1` / `npm run wfh:portal-discover`) harvests **DOM links and aria-labelled chrome** from the SSRS **portal browse** shell via CDP. The prior full capture (`portal-map-2026-07-08-full.json`) correctly recorded **45 navigation links** on the **folder view** — View, Search, Manage folder, breadcrumbs — but **no data rows**.

This screenshot shows the user had navigated further: an **opened paginated report** with the SSRS **report viewer toolbar** (pagination `1 of 2`, Page Width, export, Find). Report body data is typically:

1. Rendered inside an **iframe** or report-viewer canvas, not the same DOM tree Portal Discover walks for folder links, and/or  
2. Produced **server-side** as HTML tables or images after **Run Report**, without stable `<a href>` elements for the discover script to collect.

**Conclusion:** The user was on the correct page with real data. The tooling gap is **engineering scope** (report-viewer scrape), not incorrect navigation or discover misuse.

---

## What engineering needs next for P8-010

| Priority | Item | Owner hint |
|----------|------|------------|
| 1 | **Report entry link** — From `ACC District Nursing Visits` folder, capture the **paginated report tile/link** href (View Report) | Second discover run *on opened report* or manual href copy |
| 2 | **Parameter form** — Screenshot + field names for any filters (date range, NHI, domicile, service code?) before results render | Checklist D-09 follow-up if parameters exist |
| 3 | **Result grid selectors** — After Run, target SSRS viewer table headers (`NHI`, `Patient Name`, …) and row cells; handle iframe if present | Playwright `frameLocator` or export-to-CSV path |
| 4 | **Column → suite mapping** — Use table above; confirm **Activity Time** units and whether **Total days** is stored or computed | Product + this doc |
| 5 | **User priority columns** — Which 3–4 columns are used daily for letter cross-check (pending user answer) | Prakriti |
| 6 | **D-05 / D-06** — Browser (Edge vs Chrome) and session timeout for CDP attach | Checklist |
| 7 | **PHI handling** — Scrape config must redact/log minimally; align with B-14 subject-line PHI policy | Security review |

**Suggested Playwright extension (after parameters known):**

```
1. CDP attach (VPN + SSO manual)
2. Deep-link or navigate to ACC District Nursing Visits folder
3. Click paginated report by name
4. Fill parameters (if any) → Run / View Report
5. Switch to report viewer frame → read header row + paginate (1 of N)
6. Map rows to staging JSON keyed by Patient.nhi + Claim.claimNumber + serviceCode
```

---

## Related artifacts

| File | Purpose |
|------|---------|
| [`PORTAL_SELECTORS_2026-07-08.md`](./PORTAL_SELECTORS_2026-07-08.md) | Folder chrome selectors from first discover run |
| [`portal-map-2026-07-08-full.json`](./portal-map-2026-07-08-full.json) | 45-link folder capture (no grid) |
| [`../EMAIL_PORTAL_INPUTS_CHECKLIST.md`](../EMAIL_PORTAL_INPUTS_CHECKLIST.md) | D-09 updated with this screenshot |

---

*Ingested 2026-07-08 from user-provided redacted SSRS report screenshot.*
