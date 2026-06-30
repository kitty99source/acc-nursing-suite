# ACC District Nursing Admin Suite

A **100% offline, single-file** web app for supplier-side ACC Nursing Services billing & claims
administration. It replaces the Excel toolkit workbook and exports straight back to it.

Everything runs locally in your browser. There is **no server, no install, no telemetry, and no
network access of any kind** — a strict Content-Security-Policy blocks all outbound connections.

---

## Run it on her work laptop (recommended)

This is the easiest, most reliable way to run the app on a locked-down corporate Windows
laptop — **no install and no admin rights required**. It uses only what already ships with
Windows (PowerShell + .NET).

1. **Copy the entire `dist` folder** to the laptop (anywhere — Desktop, Documents, a USB
   stick). It contains everything needed: `index.html` plus the two launcher files
   (`Start ACC Suite.cmd` and `launch.ps1`).
2. **Double-click `Start ACC Suite.cmd`.** A small console window opens and Microsoft Edge
   launches straight to the local app (e.g. `http://127.0.0.1:8765/`).
3. **Keep that small console window open** while you use the app. To stop, close the window
   (or press `Ctrl+C` in it).

### Why the launcher (instead of just opening the file)?

Opening `index.html` directly uses a `file://` address, where browsers treat the page as an
*insecure context* and unpredictably disable key features. The launcher serves the very same
file over **`http://127.0.0.1` (localhost)**, which browsers treat as a **secure context**, so
the app gets full, reliable access to:

- **Autosave-to-file** (the File System Access API),
- **AES-GCM encryption** of your data file (Web Crypto), and
- **IndexedDB** storage of the in-browser working copy.

It stays **100% local and private**: the tiny built-in web server binds to the **loopback
address `127.0.0.1` only** — never `0.0.0.0` — so nothing is ever exposed to the network, and a
strict Content-Security-Policy still blocks all outbound connections. The server picks a free
port automatically (it tries `8765` first and scans upward) and only ever serves this one file.

> **No-frills fallback:** you can still just double-click **`index.html`** to open it directly.
> It works, but the file picker, encryption and storage are more reliable via the launcher
> above, so the launcher is preferred.

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
- **Export Center** — one-click `.xlsx` workbook (reproduces your toolkit exactly) and JSON
  backup/restore.
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

1. Open the **`dist/index.html`** file by double-clicking it. It opens in your default browser —
   use **Microsoft Edge** (or Chrome).
2. The app starts with a few obviously-fake **SAMPLE** records so you can explore. Clear them any
   time in **Settings → Clear sample data**.
3. **Save your data to a file you control:**
   - Click **"Save to file…"** in the top bar and choose where to create your `.accdata` file
     (e.g. `Documents\acc-nursing-data.accdata`).
   - After that, **autosave** keeps that file updated about a second after each change.
   - Next time, click **"Open"** to re-open it (the app also remembers it between sessions and will
     ask permission to keep saving).
4. **Your work is never lost** even before you pick a file — a working copy is kept inside the
   browser's local storage on this machine.
5. **Optional encryption:** in **Settings → Security**, set a passphrase and enable encryption. The
   data file is then AES-GCM encrypted and you'll be asked for the passphrase when you open it.
6. **Idle auto-lock:** the app locks itself after the configured minutes of inactivity (default 15).
7. **Export to Excel:** **Export Center → Export Excel workbook** produces the full `.xlsx` toolkit
   (Start Here, Billing Log, Year Summary, NS04-NS05 Approvals, Complex Cases, Decline Tracker) with
   dropdowns, conditional formatting and computed totals.

> **Note on the file picker:** "Save to file…" / "Open" use the browser's File System Access API.
> If your browser blocks it for local files, just use **Export Center → JSON backup / restore**
> instead — your data is always safe in the in-browser working copy regardless.

### Privacy

No data ever leaves your computer. There are no analytics and no network requests — the app's
Content-Security-Policy (`connect-src 'none'`) blocks them entirely.

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
│  │  ├─ excel.ts             # ExcelJS workbook export
│  │  ├─ excel.test.ts        # export validity / column-label tests
│  │  ├─ theme.ts             # apply theme/accent/density/font-scale
│  │  ├─ format.ts            # date/number/id helpers (timezone-safe)
│  │  └─ sampleData.ts        # fake seed data + empty-data factory
│  ├─ state/store.ts          # Zustand store: entities, CRUD, autosave, lock
│  ├─ components/             # Sidebar, TopBar, LockScreen, DataTable, Modal, UI, icons
│  └─ modules/                # Dashboard, Patients, CalculatorModule, Approvals,
│                             # Billing, ComplexCases, Declines, QuickPaste,
│                             # ExportCenter, SettingsModule
└─ scripts/verify-build.mjs   # checks the built file is offline + Excel is valid
```

### Tech stack

Vite · React · TypeScript · Tailwind CSS · Zustand · Recharts · ExcelJS · `vite-plugin-singlefile`.
Persistence: File System Access API + IndexedDB working copy + Web Crypto (AES-GCM).
