# Email & Hospital Portal — Inputs Checklist

**For:** Prakriti Chhetri (work PC)  
**Purpose:** Collect the minimum facts engineering needs to wire ACC letter ingress and hospital portal read tasks. Fill in on your work PC; screenshots are welcome for portal mapping.  
**Status:** Fill as you go — mark `[x]` when done.

**Companion:** [`EMAIL_PORTAL_ARCHITECTURE.md`](./EMAIL_PORTAL_ARCHITECTURE.md) — honest assessment of approaches.

---

## 2026-07-08 — Prakriti #2 (recorded answers)

> **Security:** Portal credentials were shared verbally in chat on 2026-07-08. **Do not store username/password in any repo file, doc, or config.** When implementing automation, use **Windows Credential Manager** (or OS keychain) only. **Rotate the portal password** — sharing credentials in chat is a security incident even on a private channel.

| Item | Answer | Checklist ref |
|------|--------|---------------|
| Outlook client | **Outlook desktop** on work PC | B-01 |
| Mailbox scope | **Both** shared mailbox **and** personal mailbox needed | B-03 |
| Outlook version | *(skipped — fill when convenient)* | B-02 |
| Attachment formats | Often **Word (.doc/.docx)**, not just PDF. Multi-file support required. Only ever seen **Word and PDF** — feasible scope. | B-08 |
| IMAP / Graph familiarity | User does not know these terms — plain-English explanation provided in parent response | B-11, C-02 |
| Portal URL | `http://cl-biprddb02/Reports_MSREPORT/browse/DHB-wide/ACC` | D-02 |
| Network access | **Work network only** — requires **Citrix VPN** from off-site | D-04 |
| Portal login | **Citrix VPN + manual SSO**; credentials provided verbally — use OS credential vault when implementing, **never commit** | D-03 |
| Automation preference | Manual VPN + manual portal login per session; then Playwright **CDP attach** to existing browser (see architecture doc) | D-10 |
| Portal mapping | Cannot browse portal from Cursor/dev environment — screenshots + one mapping session on work PC required | D-07–D-09 |
| Decline senders | **Same as approval** — `Bec.Williams@acc.co.nz`, `John.Bentley@acc.co.nz`, `Becky.Tunnell@acc.co.nz` | B-05 |
| Decline subject pattern | **Same as approval** — `{Title} {Name} - Claim:{digits} ACCID:{vendor-id}`; subject does **not** distinguish approval vs decline | B-07 |
| Letter type classification | **Attachment body only** — `classifyLetter()` in suite parses PDF/Word text (NUR02 vs NUR04VEN, "unable to approve", etc.) | B-07, §6c |
| Word parser corpus (P8-020) | User confirms a real ACC **approval letter in Word (.docx)** is satisfactory for parser fixtures — drop into `scripts/stress/fixtures/email/` when ready; existing PDF fixtures used until then | B-08, P8-020 |

**Still needed:** B-02 (Outlook version), B-09–B-14 (IT policy), D-05–D-06 (browser/session), D-02 table (fields to scrape), **one screenshot of an opened report with parameters/results**, **login page screenshot (D-07)**.

**2026-07-08 — Portal screenshots inventory (3 PNGs from email corpus):**

| # | File | Shows | Checklist |
|---|------|-------|-----------|
| 1 | `scripts/stress/fixtures/email/acc-email-screenshot-1.png` | Hospital portal tile grid; **Health & BI Reports** tile circled | D-07 partial (post-login landing — not login form) |
| 2 | `scripts/stress/fixtures/email/acc-email-screenshot-2.png` | **MidCentral-wide functions** menu; **ACC** entry circled | D-08 partial (nav path, not search form) |
| 3 | `scripts/stress/fixtures/email/acc-email-screenshot-3.png` | SSRS **Browse → DHB-wide → ACC**; 43 paginated reports; **ACC District Nursing Visit** circled | D-08/D-09 partial (report list — not opened report rows) |

`change-requests/images/` is empty (only `.gitkeep`) — screenshots live in stress fixtures above.

**Verdict (D-05/D-06 + mapper start):** The 3 screenshots are **sufficient to start** portal mapper scaffolding (nav path: tile → ACC → report folder; SSRS Browse UI; target report name). **Not sufficient** for field-level scrape config — still need: (1) which report(s) you open daily, (2) screenshot of **report parameters** + **result grid** with fields highlighted, (3) D-05 browser choice, D-06 session timeout, D-02 field table filled in. Use `npm run wfh:portal-discover` on work PC after manual login to produce `portal-map.json` (see `scripts/wfh/README.md`).

**2026-07-08 — Portal Discover full capture (work PC → Mac):**

| Artifact | Path | Notes |
|----------|------|-------|
| portal-map (full) | `change-requests/portal-samples/portal-map-2026-07-08-full.json` | `webSocketUsed: true`, **45 links**, folder browse chrome |
| portal-summary | `change-requests/portal-samples/portal-summary-2026-07-08-full.html` | Human-readable index |
| selector notes | `change-requests/portal-samples/PORTAL_SELECTORS_2026-07-08.md` | P8-010 / P8-019 engineering handoff |

**Captured page:** `ACC District Nursing Visits` folder (`.../report/DHB-wide/ACC/ACC%20District%20Nursing%20Visits`). Breadcrumb links: Home → DHB-wide → ACC. Aria-label selectors: `View`, `Search`, `Manage folder`, `New`, `Show hidden items`. **No report rows, parameters, or result grid** — chrome only. Prior partial sample (`portal-map-2026-07-08-partial.json`) had `webSocketUsed: false` and 0 links.

**2026-07-08 — Word approval fixture (P8-020):** `approval-template.docx` added (same ACC sample template as PDF — George Bellingham / claim 10000000149). `mammoth` + `extractWordText()` wired; parse/classify matches PDF fixture in tests. No redaction needed (template sample data only).

---

## How to use this file

1. Work through sections **in order** — Outlook/email first, portal second.
2. Replace `_fill in_` placeholders with your answers.
3. Check `[ ]` → `[x]` when each item is complete.
4. Drop screenshots in `change-requests/images/` and link them inline (e.g. `![](images/portal-claims-search.png)`).
5. If IT blocks something, write **what they said** — that is useful input, not failure.

---

## Section A — Work PC environment

- [ ] **A-01** Windows version: _fill in_ (e.g. Windows 10 22H2, hospital image build)
- [ ] **A-02** Can you install a small Node script locally (folder watch)? `[ ] Yes  [ ] No  [ ] Need IT`
- [ ] **A-03** Can you run PowerShell scripts (already used for ACC Suite launcher)? `[ ] Yes  [ ] Restricted`
- [ ] **A-04** Does PC stay logged in during work hours when you step away? `[ ] Yes  [ ] Locks quickly`
- [ ] **A-05** Shared I: drive path where coworkers open ACC Suite: _fill in_
- [ ] **A-06** Your preferred ACC-Inbox folder path for PDF drops: _fill in_ (default `~/ACC-Inbox`)

---

## Section B — Outlook / email (ACC letters)

### B.1 Client type

- [x] **B-01** Which email client do you use for ACC letters?
  - `[x]` Outlook **desktop** (Windows app)
  - `[ ]` Outlook **web** (browser tab)
  - `[ ]` Other: _fill in_

- [ ] **B-02** Outlook desktop version (if applicable): _Help → About_ → _fill in_

- [x] **B-03** Mailbox type:
  - `[x]` Personal work mailbox
  - `[x]` Shared / team mailbox (name: _fill in when known_)
  - `[x]` Both — ACC letters arrive in: _both mailboxes; exact folder TBD_

### B.2 ACC letter patterns (critical for filtering)

Collect **5–10 real examples** (redact patient names in this doc; keep sender/subject structure).

- [x] **B-04** Typical **From** addresses for approval letters (one per line):
  ```
  Bec.Williams@acc.co.nz
  John.Bentley@acc.co.nz
  Becky.Tunnell@acc.co.nz
  ```
  **2026-07-08:** Confirmed via email corpus sample (body text). Use as Outlook/COM/Graph allowlist for approval ingress.

- [x] **B-05** Typical **From** addresses for decline letters:
  ```
  Bec.Williams@acc.co.nz
  John.Bentley@acc.co.nz
  Becky.Tunnell@acc.co.nz
  ```
  **2026-07-08:** Same allowlist as approvals (B-04). Single Outlook/COM/Graph filter covers both letter types.

- [x] **B-06** Sample **Subject** lines — approvals (3+):
  ```
  1. Mr Gilbert Gandor - Claim:10000003194 ACCID:VEND-K96655
  2. _fill in — need 2+ more real examples (redact names)_
  3. _fill in_
  ```
  **Pattern observed:** `{Title} {Patient Name} - Claim:{digits} ACCID:{vendor-id}` — patient name in subject (PHI risk for digests; see B-14).

- [x] **B-07** Sample **Subject** lines — declines (3+):
  ```
  1. Mr Gilbert Gandor - Claim:10000003194 ACCID:VEND-K96655
  2. _same pattern as approvals — subject is neutral_
  3. _approval vs decline determined only after parsing attachment text_
  ```
  **2026-07-08:** Subject pattern identical to B-06. Do **not** filter or route by subject alone — `classifyLetter()` reads PDF/Word body (NUR02 / NUR04VEN, "unable to approve", etc.).

- [x] **B-08** Are letters always **PDF attachments**? `[ ] Always  [x] Sometimes body text  [ ] Links only`
  - **2026-07-08:** Often **Word (.doc/.docx)** attachments; sometimes PDF. Only formats seen: Word + PDF. Need **multi-file / multi-format** support.
  - **P8-020 fixture:** When you have a real ACC approval letter in Word (as ACC sends it), drop the `.docx` into `scripts/stress/fixtures/email/` — redact patient names if needed. Existing PDF fixtures remain in use until a Word sample arrives.

- [ ] **B-09** Folder where you file processed ACC mail today: _fill in_ (e.g. `ACC/Processed`)

- [ ] **B-10** Rough volume: _fill in_ letters per week

### B.3 IT / policy constraints

- [ ] **B-11** May automation **read** hospital mailbox programmatically? Ask IT if unsure.
  - `[ ]` Yes — method allowed: _IMAP / Graph API / COM only / unknown_
  - `[ ]` No — folder-watch + manual drop only
  - `[ ]` Unknown — IT contact: _fill in_

- [ ] **B-12** May a local script **move** processed emails to another folder? `[ ] Yes  [ ] No  [ ] Read-only only`

- [ ] **B-13** MFA / conditional access on mailbox: `[ ] None  [ ] App password possible  [ ] Blocks unattended access`

- [ ] **B-14** PHI in email **subject** lines today? `[ ] Yes (avoid digest subjects)  [ ] No`

---

## Section C — ACC Inbox panel (narrow in-suite view)

*Not a full mail client — filtered ACC letters only with Parse / Review buttons.*

- [ ] **C-01** Would you use an in-suite **“ACC Inbox”** panel if it showed only filtered ACC letters? `[ ] Yes  [ ] Prefer Outlook`

- [ ] **C-02** Preferred integration if Outlook desktop stays open:
  - `[ ]` Outlook COM automation (no re-login — see architecture doc)
  - `[ ]` Microsoft Graph OAuth (one-time admin consent)
  - `[ ]` IMAP with app password
  - `[ ]` Skip email API — folder watch only

- [ ] **C-03** Actions you want on each ACC Inbox row (check all that apply):
  - `[ ]` Parse PDF → HRQ staging
  - `[ ]` Open in letter import modal
  - `[ ]` Mark processed / ignore
  - `[ ]` Flag duplicate suspect

---

## Section D — Hospital portal (database / ACC status site)

### D.1 Portal identity

- [ ] **D-01** Portal name / purpose: _fill in_ (e.g. “DHB patient admin”, “ACC provider portal”)

- [x] **D-02** Portal URL(s) — full HTTPS:
  ```
  http://cl-biprddb02/Reports_MSREPORT/browse/DHB-wide/ACC
  ```
  *(internal HTTP — work network / Citrix VPN only)*

- [x] **D-03** Login method: `[x] AD/SSO  [ ] Separate username/password  [ ] Smart card  [x] VPN required first`
  - **Citrix VPN + manual SSO.** Credentials provided verbally 2026-07-08 — **never commit**; use Windows Credential Manager at implementation time. **Rotate password** after chat exposure.

- [x] **D-04** VPN required from work PC? `[ ] No  [x] Yes — which: Citrix VPN`

- [ ] **D-05** Browser you use for portal: `[ ] Edge  [ ] Chrome  [ ] IE mode  [ ] Other`
  - **2026-07-08:** Not confirmed — needed for CDP launch command in `scripts/wfh/README.md`.

- [ ] **D-06** Session stays logged in during work day? `[ ] Yes  [ ] Times out after _N_ minutes`
  - **2026-07-08:** Not confirmed — affects whether CDP attach per session is enough.

### D.2 What to scrape (read-only)

List each **page + fields** you look up manually today:

| # | Page / menu path | Fields needed | Example use |
|---|------------------|---------------|-------------|
| 1 | _fill in_ | _fill in_ | _e.g. PO status for claim_ |
| 2 | _fill in_ | _fill in_ | |
| 3 | _fill in_ | _fill in_ | |

- [~] **D-07** Screenshot: login page → `change-requests/images/` → link: _not provided_
  - Have post-login tile grid: `acc-email-screenshot-1.png` (fixtures path above)

- [x] **D-08** Screenshot: search / claim lookup page → link: `acc-email-screenshot-2.png`, `acc-email-screenshot-3.png` + `portal-map-2026-07-08-full.json`
  - SSRS Browse + ACC folder + **ACC District Nursing Visits** folder chrome captured (45 links, WebSocket). **Still need:** opened report + parameter screen.

- [~] **D-09** Screenshot: result row with fields you need highlighted → link: _still needed_
  - Portal Discover reached folder view only. Open a **paginated report** inside Visits folder and capture parameter form + result grid (or second discover run on that page).

### D.3 IT constraints for portal automation

- [~] **D-10** May Playwright attach to your **already logged-in** browser session? `[ ] Yes  [ ] No  [ ] Ask IT`
  - **2026-07-08:** User preference = manual VPN/login + CDP attach; tooling shipped: `scripts/wfh/portal-discover.mjs`

- [ ] **D-11** May a script run on **local network only** (no cloud)? `[ ] Yes  [ ] No`

- [ ] **D-12** RPA / screen-scraping policy at DHB: _fill in what IT says_

---

## Section E — Folder watch (P8-0 — available now)

No email API required. Drop PDFs or Word docs into a watched folder.

- [ ] **E-01** Confirm inbox folder path: _fill in_

- [ ] **E-02** Test: drop a sample PDF → check `ACC-Inbox/.staging/*.json` appears

- [ ] **E-03** Run folder watch:
  ```powershell
  cd <path-to-acc-suite>
  npm run wfh:folder-watch
  ```
  Or: `node scripts/wfh/folder-watch.mjs "C:\Users\You\ACC-Inbox"`

- [ ] **E-04** Import staging JSON into suite (Settings → Staging import — when UI wired) or share `.staging/` JSON with dev

---

## Section F — Sign-off

- [ ] **F-01** Completed by: _Prakriti Chhetri_  
- [ ] **F-02** Date: _fill in_  
- [ ] **F-03** Blockers for IT follow-up:
  ```
  _fill in_
  ```

---

## Quick reference — what to collect first (minimum viable)

If short on time, do these **five** first:

1. Outlook **desktop vs web** + version (B-01, B-02)
2. Three **sender addresses** and three **subject patterns** (B-04–B-07)
3. IT answer: **read-only mailbox access** allowed? (B-11)
4. Portal **URL** + one screenshot of the search/results page (D-02, D-08, D-09)
5. List of **3 fields** you look up manually on the portal (D-02 table row 1)
