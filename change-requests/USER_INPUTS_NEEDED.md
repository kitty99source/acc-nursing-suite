# User / Hospital Inputs Required

**Purpose:** Items the engineering team cannot infer, default safely, or fabricate. Gather before or during the phases noted. See `MASTER_ROADMAP.md` §1 for full context.

**How to respond:** Reply in chat or add a dated section to this file. Mark each item **blocking** or **can default** when answering.

---

## 2026-07-08 — Prakriti responses

| ID | Decision | Status |
|----|----------|--------|
| **U-01** | **Decided (2026-07-08):** Shared-drive HTML bundle + local static server launcher. Copy built `dist/` to I: drive; coworkers double-click `Start ACC Suite.cmd` (PowerShell serves `index.html` on `127.0.0.1:8765`). **Not** `npm run dev` for staff; **not** `file://` as primary. Dev: `npm run launch` after build. | ✅ Decided |
| **U-02** | **Engineering team (Prakriti) holds canonical `.accdata` / ZIP backup** until a formal handoff owner is established; off-site copy maintained by same team for now. Handoff to hospital IT/ops documented later. | ✅ Answered |
| **U-03** | **No passphrase for now** — faster daily use. If encryption enabled later, engineering team responsible for reset; **data loss on lost passphrase accepted**. No strict login yet. | ✅ Answered (can default → confirmed) |
| **U-04** | **Sole UAT contact:** Prakriti Chhetri. No IT liaison. Solo builder — **pilot sign-off = self-sign-off for now**; named hospital admins when team expands. | ✅ Answered |
| **U-05** | **No real letter corpus.** Use **intelligent synthetic fixtures** + adaptable parser tuned to same ACC letter format. Real anonymised PDFs still welcome but not blocking for initial pilot. | ✅ Answered (approach) |
| **U-06** | **Peak 10,000 patients.** Other volumes derived from stress-test ratios + throughput model (see appendix below). | ✅ Answered |
| **U-07** | **Single shared `.accdata` on network I: drive** (shared with coworkers). Future server when embedded in main hospital system. Industry comparison requested in chat. | ✅ Answered |
| **U-08** | **Email automation: yes, programmatic (not LLM).** **Working hours only** — not 24/7 overnight daemon. **PC need not stay on overnight.** | ✅ Answered |
| **U-26** *(new)* | **Baseline forkable template** — empty seed data profile with no real user data; office-specific config layer so different district-nursing offices can reuse front/back and repurpose. Required before multi-office rollout. | 📋 New requirement |

---

## Blocking (cannot ship hospital pilot without)

| ID | Input needed | Used in phase | Why blocking |
|----|--------------|---------------|--------------|
| U-01 | **Deployment target** — shared drive HTML, per-PC install, Citrix/VDI, or managed browser policy | P7 | Packaging, updates, and backup runbooks differ |
| U-02 | **Data custody owner** — who holds the canonical `.accdata` / ZIP backup, rotation schedule, off-site copy | P0, P3 | Save-model UX and backup reminders must match real practice |
| U-03 | **Encryption policy** — mandatory AES passphrase vs optional; who resets lost passphrase (data loss accepted?) | P0, P4 | Default-off encryption may violate DHB policy |
| U-04 | **UAT contacts** — 2–3 district nursing admins + IT liaison for pilot sign-off | All gates | Quality gates require named sign-off owners |
| U-05 | **Real ACC letter corpus** — 10–30 anonymised PDFs: text-layer approvals, text declines, scanned approvals, scanned declines, edge cases (dual claim number, name mismatch, multi-row NS04) | P5 | OCR regression and confidence tuning cannot be validated on 2 fixtures alone |
| U-06 | **Volume baselines** — patient count, claims, invoice lines, approvals/month, letters/week | P1, P2 | Stress thresholds and virtualization priority |
| U-07 | **Multi-user intent** — single shared file on network drive vs one install per admin vs future server | P4, P8 | Architecture fork; cannot defer past P4 gate |
| U-08 | **SUPER WFH policy** — may automation read ACC email on hospital mailbox? PHI in morning digest? PC must stay on overnight? | P8 | Email/browser automation may be prohibited |

---

## Can default (engineering proposes; user confirms later)

| ID | Input needed | Default if silent | Phase |
|----|--------------|-------------------|-------|
| U-09 | ACC portal URLs used today (status check, PO, remittance) | Manual-only; no browser automation | P8-2 |
| | **2026-07-08 — mostly complete:** Full `portal-map-2026-07-08-full.json` — base `http://cl-biprddb02/Reports_MSREPORT/`, nav `browse/DHB-wide/ACC`, target folder `ACC District Nursing Visits` (plural in URL/title). 45 SSRS chrome links + aria-label selectors. **Gap:** daily report name, parameter fields, result columns (D-09). See `change-requests/portal-samples/PORTAL_SELECTORS_2026-07-08.md`. | 🟡 Mostly complete |
| U-10 | Email system — O365 Graph vs generic IMAP, shared mailbox vs personal | Folder-watch only in P8-0 | P8-1 |
| U-11 | Portal credentials storage — OS keychain vs suite passphrase vault | Suite passphrase vault | P8-2 |
| U-12 | Role model — admin / clerk / read-only / export-only | Admin + read-only | P4 |
| U-13 | Idle lock minutes | 15 (current default) | P4 |
| U-14 | Backup reminder interval | 7 days since last export | P0 |
| U-15 | Action queue display cap | Top 50 by severity | P1 |
| U-16 | Compliance page group cap | 50 patient/claim groups | P1 |
| U-17 | Auto-commit | **Disabled** in production config | P0, P5 |
| U-18 | Hardware reference — hospital-issue laptop spec for perf UAT | 8 GB RAM, Chrome current−1 | P1 |
| U-19 | Finance export format — existing Excel template columns | Current `buildWorkbookBuffer` sheets | P6 |
| U-20 | ACC policy doc version for compliance rule citations | 2024 Nursing Service Schedule PDF (user to confirm) | P6 |
| U-21 | Sample patient for demos — use George fixture vs synthetic | George in `sampleData` | P5 |
| U-22 | Management reporting — PDF period close vs Excel only | Excel export only | P6 |
| U-23 | Travel (NS06) workflow priority | Defer post-P6 | P6 |
| U-24 | EMR / patient management integration | Out of scope | — |
| U-25 | Branding / sidebar title | "ACC District Nursing Admin Suite" | P7 |
| U-26 | **Baseline forkable template** — empty seed profile + office config layer for reuse across sites | Ship with P7 packaging; `emptyData()` + settings export/import | P7 |

---

## Appendix A — U-06 volume baselines (peak 10,000 patients)

**Source:** `scripts/stress/generate-mock-data.mjs` large preset (2,000 patients, all stress benchmarks passed per `STRESS_TEST_REPORT.md`), scaled ×5 to 10,000 patients. Ratios reflect engineering stress fixture, not audited hospital census — treat as **planning ceiling**.

| Entity | Stress @ 2k | Derived @ 10k | Ratio / patient |
|--------|------------:|--------------:|----------------:|
| Patients | 2,000 | **10,000** | 1.0 |
| Claims | 3,600 | **18,000** | 1.8 |
| Service lines | 12,000 | **60,000** | 6.0 |
| Invoice lines | 12,000 | **60,000** | 6.0 |
| Approvals (NS04/NS05 rows) | 1,080 | **5,400** | 0.54 |
| Declines | 300 | **1,500** | 0.15 |
| Complex cases | 120 | **600** | 0.06 |
| Documents | 400 | **2,000** | 0.20 |
| Import history (letters) | 800 | **4,000** | 0.40 (cumulative) |

**Operational letter-rate estimates (district nursing, planning range):**

| Metric | Low | Mid | High | Basis |
|--------|----:|----:|-----:|-------|
| Letters / week | 40 | 80 | 150 | Fixture import-history rate (~38/wk if 4k entries ≈ 2 yr); active-claim correspondence ~0.3–0.8% of 18k claims/wk |
| Approvals renewed / month | 200 | 400 | 600 | ~5–11% of 5,400 approval stock churning monthly (90-day avg package) |
| New declines / month | 15 | 30 | 50 | Scaled from fixture decline count + open-case workflow |

**Working-copy size @ 10k (extrapolated):** JSON ~51 MB serialized; ZIP backup ~3 MB compressed (linear scale from 10.27 MB / 0.60 MB @ 2k).

---

## Appendix B — U-06 letter throughput (8-hour working shift)

**Purpose:** Size SUPER WFH batch windows and HRQ capacity for working-hours-only automation (U-08).

### Assumptions

1. **Letter types:** ACC approval + decline PDFs arriving via email (same format as manual import).
2. **Pipeline:** email fetch → PDF text extract (pdf.js) or OCR (Tesseract if sparse text) → parse → patient/claim match → confidence score → **Human Review Queue (HRQ)** → manual sign-off → commit.
3. **Human review:** 30–60 s per item (45 s midpoint) — confirm fields, resolve low-confidence, reject duplicates (`SUPER_WFH_MODE.md` morning sign-off model).
4. **Email fetch:** programmatic IMAP/Graph poll during working hours; batch amortized ~2 s/letter (includes attachment download + dedupe).
5. **Measured timings** (`STRESS_TEST_REPORT.md`, text-layer PDFs, 2k-patient fixture):

| Step | Approval | Decline | Notes |
|------|----------|---------|-------|
| `extractPdfText` | 308 ms | 108 ms | pdf.js text layer |
| Parse | 3.6 ms | 7.2 ms | deterministic parser |
| Duplicate check (×100) | — | 0.30 ms/letter | amortized |
| Match + prefill | ~0.1 ms | ~0.1 ms | negligible vs human step |

6. **OCR (unbenchmarked):** estimate **8–20 s/letter** (1–2 pages, main-thread today; P2-008 worker planned). Assume **30% scanned mix** in production (`SUPER_WFH_MODE.md` cites 30–50% human-touch on scans).

### Automated stage (per letter)

| Path | Auto time | Formula |
|------|----------:|---------|
| Text-layer PDF | ~0.5 s | 2 s email + 0.31 s extract + 0.01 s parse/match |
| Scanned PDF (est.) | ~12 s | 2 s email + 10 s OCR (mid) + 0.01 s parse |
| **Blended (70/30)** | **~4 s** | 0.7×0.5 + 0.3×12 |

**Machine capacity:** ~900 letters/hour automated ingest (blended) — **not the bottleneck**.

### Human sign-off (binding constraint)

| Review time | Letters / hour | Letters / 8 hr shift | Notes |
|-------------|---------------:|---------------------:|-------|
| 30 s (fast, high-confidence batch) | 120 | **960** | Theoretical; requires batch UI (P8) |
| 45 s (realistic mid) | 80 | **640** | Mixed confidence, context switching |
| 60 s (careful, low-confidence) | 60 | **480** | Scanned / mismatch heavy days |

**Practical planning number:** **60–80 letters/hour → 480–640 letters per full 8-hour shift** if admin dedicates time solely to HRQ sign-off.

**Partial-shift model (SUPER WFH working-hours):** 2× 30-min review blocks/day → **40–80 letters/day** at 45 s each — sufficient for mid estimate **~80 letters/week** with headroom.

### Batch schedule implication (U-08)

- Email polls e.g. **08:00, 10:00, 13:00, 15:00** (4×/day, working hours).
- Each poll: fetch → parse → stage HRQ drafts; **no overnight daemon**.
- PC may close at end of day; missed polls resume next working day (SLA warns on stale HRQ items).

---

## Requested artifacts (send when available)

1. **Anonymised letters zip** — filename pattern `type_scan|text_approval|decline_NNN.pdf` *(optional per U-05; synthetic fixtures proceed)*
2. **Redacted screenshot** of current manual workflow (email → desktop → filing)
3. **IT constraints doc** — blocked executables, extension policy, IndexedDB quota, File System Access API allowed?
4. **Existing `.accdata` or ZIP** (test environment only) for migration/load testing
5. **Excel templates** staff already use for billing handoff to finance
6. **List of recurring compliance false positives** admins ignore today (tune rules)

---

## Sign-off checklist (user)

- [x] U-01 deployment target confirmed *(shared I: drive dist/ + Start ACC Suite.cmd launcher)*
- [x] U-02 backup owner named *(Prakriti / engineering team)*
- [x] U-05 letter corpus approach confirmed *(synthetic fixtures; real PDFs optional)*
- [x] U-06 volumes documented *(10k peak + appendix)*
- [x] U-07 multi-user decision recorded *(shared I: drive `.accdata`)*
- [x] U-08 WFH automation policy yes/no *(yes, working-hours programmatic email)*
- [x] UAT contacts listed *(Prakriti Chhetri — solo self-sign-off)*

*Last updated: 2026-07-08 — Prakriti responses + throughput appendix + U-01 launch verification*

---

## Appendix C — U-01 verified launch paths (engineering audit 2026-07-08)

**User belief:** `dist/` contains a script that runs `npm run dev` and opens the browser.

**Actual state (verified in repo):**

| Path | What it does | Who uses it |
|------|----------------|-------------|
| **`npm run dev`** | Vite dev server (hot reload, `src/` sources) | Developers only — **not** in `dist/` |
| **`npm run build`** | `tsc` + `vite build` → single-file `dist/index.html` (~10 MB) | Release step before copying to share |
| **`dist/index.html`** | Self-contained offline app (`vite-plugin-singlefile`); open via `file://` or any static server | **End-user production** |
| **`npm run preview`** | Vite preview of built `dist/` on localhost | Dev smoke-test after build |
| **`dist/Start ACC Suite.cmd` + `dist/launch.ps1`** | **Deleted** (were in git HEAD). Did **not** run `npm run dev`. PowerShell `TcpListener` served sibling `index.html` on `127.0.0.1:8765` and opened Edge — for File System Access API (secure context). | Was Windows hospital launcher |

**Recommended deployment for U-07 (shared I: drive `.accdata`):**

1. Run `npm run build` on a dev machine.
2. Copy entire `dist/` folder (currently just `index.html` + `eng.traineddata` if OCR needed) to e.g. `I:\ACC-Suite\`.
3. Users double-click `index.html` **or** restore/recreate `launch.ps1` for FSA autosave-to-file.
4. Canonical data: shared `acc-nursing-data.accdata` on I: — loaded via TopBar **Load my data**; exported via **Save my data**.

**Decided deployment (U-01):** copy `dist/` to `I:\ACC-Suite\` → double-click `Start ACC Suite.cmd` → browser opens at `http://127.0.0.1:8765/`. Keep the terminal window open (that is the server). Load shared `.accdata` via TopBar — data is separate from the app bundle.

**Blockers still open for packaging polish:** MDM/Citrix, PWA install vs plain HTML.
