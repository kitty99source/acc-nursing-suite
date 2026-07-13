# ACC District Nursing Admin Suite

A **100% offline, single-file** web app for supplier-side ACC Nursing Services billing & claims
administration. It replaces the Excel toolkit workbook and exports straight back to it.

Everything runs locally in your browser. There is **no telemetry and no internet access** — a
strict Content-Security-Policy (`connect-src 'self'`) blocks every outbound connection except to
the app's own local loopback launcher (the `/_acc/*` bridge that reads letters from ACC-Inbox).
Nothing is ever sent off the machine.

---

## Run it (the simple way) — just open the file

This is all you need on a locked-down work laptop. **No install, no admin rights, no command,
no launcher.**

1. **Download** `acc-nursing-suite-dist.zip` from the
   [latest release](https://github.com/PhotonEntangled/acc-nursing-suite/releases) and **extract**
   it anywhere (Desktop, Documents, a USB stick).
2. **Double-click `index.html`.** It opens in your default browser (use **Microsoft Edge** or
   Chrome).
3. **Keep your work safe with the two big buttons in the top bar:**
   - **Save my data** — downloads a backup file (`acc-nursing-data.accdata`) to your Downloads
     folder. Do this whenever you want to keep your work.
   - **Load my data** — pick a previously-saved file to bring all your data back.
4. While the page stays open, your in-progress data is also kept automatically inside the
   browser on this machine, so a refresh or accidental reload won't lose it. The browser will
   also warn you if you try to close the tab with **unsaved** changes.

That's it. Everything stays on your computer — no server, no network, no telemetry.

> **Tip:** Save my data after a session of edits (and keep the downloaded `.accdata` file
> somewhere safe, e.g. `Documents`). To continue later, open `index.html` again and click
> **Load my data**.

---

## The full experience on a work laptop: the localhost launchers

The `dist` folder also ships launcher files that serve the app over
**`http://127.0.0.1` (localhost)** instead of `file://`. This is the way to run it on the work
laptop, because localhost is a **secure context**, which enables **silent autosave to a file you
choose** (via the browser's File System Access API) and lets the app read ACC letters through its
local `/_acc/*` bridge. It stays **100% local**: the tiny built-in server binds to
**`127.0.0.1` only** and only ever serves this one file.

### Quiet (preferred Desktop shortcut): `Start ACC Suite (quiet).vbs`

**Double-click `Start ACC Suite (quiet).vbs`** for day-to-day use with **no visible
PowerShell/cmd windows**. It starts a hidden **supervisor** that opens the browser, keeps the app
server and Folder Watch **Hidden** (and silently restarts them if they die mid-session), checks
Outlook mail once at session start, and **checks mail again** when you press **Refresh** in ACC
Inbox. **Closing the last app browser tab** ends the session. Only one supervisor runs at a time.
Pin a Desktop shortcut to the **`.vbs`**.

**If the app acts weird or you can't delete the folder:** run
`Stop ACC District Nursing Suite (force).vbs` (or the `.cmd`) — it closes leftover helpers for
this suite only and clears stale PID files under `%USERPROFILE%\ACC-Suite\`.

### Recommended (visible console): `Start ACC Suite (recommended).cmd`

**Double-click `Start ACC Suite (recommended).cmd`** when you want to **see** progress in a console.
Same supervised session as quiet mode:

- the **ACC Suite app** (local server + `/_acc` bridge),
- **Folder Watch** (kept alive by the supervisor), and
- **Email Sync** (at session start, and again from ACC Inbox Refresh).

Use this one because it also starts **folder-watch + email-sync**, so ACC letters actually flow
into the **Review Queue** instead of you importing them by hand. (It runs `supervisor.ps1`; the
older `Start WFH Mode.cmd` / `wfh-mode.ps1` forwarder is kept for existing shortcuts.) It needs
**Outlook desktop open** for the email-sync step.

### Minimal fallback: `Start ACC Suite.cmd`

**Double-click `Start ACC Suite.cmd`** only if you want the **app alone with no sync** — no
folder-watch, no email-sync. A small console window opens and Microsoft Edge launches the app over
localhost. Keep that window open while you work; close it (or press `Ctrl+C`) to stop. You still
get silent autosave via the **Open** / **Save to file…** buttons, but ACC letters will not flow in
automatically.

Why the launchers exist: opening `index.html` directly uses a `file://` address, where browsers
treat the page as an *insecure context* and hide the File System Access API. Serving the same file
over localhost makes it a **secure context**, which re-enables the de-emphasised **Open** /
**Save to file…** buttons in the top bar for silent autosave. Encryption and the in-browser working
copy work in every mode.

---

## What it does

- **Dashboard** — an action queue (expiring approvals, awaiting-billing, overdue declines, complex
  cases past review, coverage gaps) plus billing analytics charts.
- **Patients & Cases** — patients, their claims/episodes, and service lines with a live package
  recommendation on each line.
- **Package Calculator** — works out the correct package of care (NS01/02/03, plus NS04 extension)
  from duration, consults and interruptions; includes the subsequent-injury reclassification helper
  and an NS06 treatment watch.
- **Approvals (NS04/NS05)** — tracks approval/PO expiry with auto days-until-expiry and status;
  rows turn salmon when expiring soon or expired.
- **Billing Log** — the core ledger with the Awaiting Billing → Billed → Remittance workflow,
  inline status editing, filters and totals. Salmon = follow-up needed, green = billed.
- **Complex Cases** — structured "don't make me re-research this" log; highlights overdue reviews.
- **Decline Tracker** — receipt → nurse emailed → resubmission → outcome, with status dropdown.
- **Quick Paste-In** — paste rows from your billing report, map the columns, review, then commit
  them as invoice lines. (Toggle off in Settings if you don't want it.)
- **Export Center** — one-click `.xlsx` workbook (reproduces your toolkit exactly), **Excel import**
  (`.xlsx` → JSON, with a preview + merge/replace), and JSON backup/restore.
- **Imported Tables** — appears in the sidebar only after you import a workbook containing sheets
  outside the standard set; shows each one as a generic table.
- **Settings** — themes (Clinical Light / Warm Light / Dark / High Contrast), accent colour,
  density, font scale, expiry threshold, idle auto-lock, optional encryption, and data management.

### Service codes baked in (excl GST)

| Code | Name | Rate | Notes |
| --- | --- | --- | --- |
| NS01 | Short Term Package | $516.11 | 1–13 days, min 1 consult |
| NS02 | Medium Term Package | $1,173.13 | 14–42 days, min 6 consults |
| NS03 | Long Term Package | $2,275.42 | 43–105 days, min 12 consults |
| NS04 | Extended Nursing | $109.69 / consult | approval required; >105 days or 26th consult |
| NS05 | Ongoing Nursing | $98.58 / **hour** | referral + approval up to 12 months |
| NS06 | Subsequent Injury | $37.16 / consult | notify via ACC179; approval only if >50 on a claim |
| NS07 | Oversight Consultation | $106.86 / consult | first per claim no approval |
| NS10 | Medical Consumables | actual cost | |
| NS20 / NS20T | Comprehensive Nursing Assessment | $591.78 | |
| NSTD10 / NSTT1 / NSTT1D / NSAC | Travel | $0.82/km, $98.58/hr, $106.86/hr, $282.97/night | only with NS05/NS07/NS20 |

All packages cap at **25 consults** — consults 26+ bill as NS04.

---

## How to USE it (no install)

1. Open **`index.html`** by double-clicking it. It opens in your default browser — use
   **Microsoft Edge** (or Chrome).
2. The app starts with a few obviously-fake **SAMPLE** records so you can explore. Clear them any
   time in **Settings → Clear sample data**.
3. **Save / load your work with the top-bar buttons:**
   - **Save my data** downloads `acc-nursing-data.accdata` (your full backup). Keep it somewhere
     safe like `Documents`.
   - **Load my data** reads a saved file back in (it replaces the current data). Accepts
     `.accdata` and `.json`.
   - The status next to the buttons shows **"Unsaved changes — click Save my data"** (amber) or
     **"Saved · <time>"** (green) so you always know where you stand.
4. **Your work is never lost on refresh** — a working copy is kept inside this browser on this
   machine, and the browser warns you before closing a tab with unsaved changes.
5. **Optional encryption:** in **Settings → Security**, set a passphrase and enable encryption. The
   saved file is then AES-GCM encrypted, and **Load my data** will prompt for the passphrase.
6. **Idle auto-lock:** the app locks itself after the configured minutes of inactivity (default 15).
7. **Export to Excel:** **Export Center → Export Excel workbook** produces the full `.xlsx` toolkit
   (Start Here, Billing Log, Year Summary, NS04-NS05 Approvals, Complex Cases, Decline Tracker) with
   dropdowns, conditional formatting and computed totals.

> **Advanced (optional):** if you run the app via the localhost launcher (see above), two extra
> de-emphasised buttons — **Open** and **Save to file…** — appear in the top bar for *silent
> autosave* to a file you choose. They never appear when you just open `index.html`, which is the
> intended simple experience. **Export Center → JSON backup / restore** also remains available.

### Importing an Excel file

You can pull an existing Excel workbook (`.xlsx`) back into the app — the reverse of the Excel
export, and a convenient way to bring in your old toolkit data.

1. Go to **Export Center → Import from Excel (.xlsx)** and choose a workbook.
2. A **preview** appears showing what was found: counts per section, any **extra columns** (kept as
   custom fields), any **unrecognised sheets** (imported as custom tables), and a **Merge vs
   Replace** choice.
   - **Merge** (default) adds the imported records to your existing data, skipping exact
     duplicates.
   - **Replace** clears billing, approvals, complex cases, declines, patients, claims and custom
     tables first (your Settings are kept), then imports.
3. Confirm to apply, or Cancel to discard.

The importer is deliberately **flexible**:

- **Header rows are detected**, so title/description rows above the header (as on the Approvals,
  Complex Cases and Decline Tracker tabs) don't matter.
- **Recognised tabs** — `Billing Log`, `NS04-NS05 Approvals`, `Complex Cases`, `Decline Tracker` —
  map straight to your data. `Start Here` and `Year Summary` (a computed tab) are skipped.
- **Unknown columns** on a recognised tab are preserved into a per-record *custom fields* bag and
  shown as extra columns in that table.
- **Unknown sheets** are captured verbatim as *custom tables* and shown under a new **Imported
  Tables** section in the sidebar (only visible when you have some).
- Claim / PO / ACC45 numbers are kept as **text** (so long numbers aren't mangled), dates are
  normalised to the app's format, and free-text values like `6 hours p/month` are preserved.

Everything you import is written back out on your next **Export Excel workbook**, so the round-trip
is lossless. A fake demo workbook is included at [`samples/AdminSuite-DEMODATA.xlsx`](samples/AdminSuite-DEMODATA.xlsx)
if you'd like to try the import (it contains obviously-fake demo data only).

### Privacy

No data ever leaves your computer. There are no analytics and no internet requests — the app's
Content-Security-Policy (`connect-src 'self'`) permits connections only to the local loopback
launcher on your own machine and blocks everything else.

---

## How to DEV / REBUILD (to tweak it yourself in Cursor)

Requires [Node.js](https://nodejs.org/) 18+ (built and tested on Node 22).

```bash
# from C:\Projects\Med\acc-nursing-suite
npm install        # install dependencies (one time)
npm run dev        # start the dev server with hot reload
npm run build      # type-check + bundle to the single dist/index.html
npm run test       # run the unit tests (calculator + Excel export)
```

- `npm run build` produces **one self-contained file** at `dist\index.html` (all JS/CSS inlined via
  `vite-plugin-singlefile`). That single file is the whole product — copy it anywhere and open it.
- `npm run dev` opens a local dev server (handy while editing); the shipped artifact is always the
  built `dist\index.html`.

### Project structure

```
acc-nursing-suite/
├─ index.html                 # app shell + strict offline CSP meta tag
├─ vite.config.ts             # Vite + React + single-file + Vitest config
├─ tailwind.config.js         # theme tokens mapped to CSS variables
├─ src/
│  ├─ main.tsx                # React entry
│  ├─ App.tsx                 # shell: routing, theming, idle-lock, activity tracking
│  ├─ index.css               # theme tokens (4 themes), density, components
│  ├─ types/                  # all TypeScript data-model types (+ FSA ambient types)
│  ├─ lib/
│  │  ├─ calculator.ts        # pure package-calculator engine
│  │  ├─ calculator.test.ts   # worked-example unit tests
│  │  ├─ serviceCodes.ts      # contract reference data / rates
│  │  ├─ analytics.ts         # dashboard metrics, approval status, year summary
│  │  ├─ storage.ts           # file format, File System Access API, fallbacks
│  │  ├─ crypto.ts            # AES-GCM + PBKDF2 (Web Crypto)
│  │  ├─ idb.ts               # IndexedDB working copy + file-handle store
│  │  ├─ excel.ts             # ExcelJS workbook export (+ custom-field/sheet round-trip)
│  │  ├─ excel.test.ts        # export validity / column-label tests
│  │  ├─ excelImport.ts       # flexible ExcelJS import (xlsx -> JSON) + merge logic
│  │  ├─ excelImport.test.ts  # header-detection / mapping / merge tests
│  │  ├─ theme.ts             # apply theme/accent/density/font-scale
│  │  ├─ format.ts            # date/number/id helpers (timezone-safe)
│  │  └─ sampleData.ts        # fake seed data + empty-data factory
│  ├─ state/store.ts          # Zustand store: entities, CRUD, autosave, lock
│  ├─ components/             # Sidebar, TopBar, LockScreen, DataTable, Modal, UI, icons
│  └─ modules/                # Dashboard, Patients, CalculatorModule, Approvals,
│                             # Billing, ComplexCases, Declines, QuickPaste,
│                             # ExportCenter, ImportedTables, SettingsModule
├─ samples/                   # AdminSuite-DEMODATA.xlsx (fake demo data for import testing)
└─ scripts/verify-build.mjs   # checks the built file is offline + Excel is valid
```

### Tech stack

Vite · React · TypeScript · Tailwind CSS · Zustand · Recharts · ExcelJS · `vite-plugin-singlefile`.
Persistence: manual **Save my data / Load my data** (JSON `.accdata` download/upload, works on
`file://`) + IndexedDB working copy for crash recovery + Web Crypto (AES-GCM) encryption.
Optional File System Access API autosave when served over localhost.
