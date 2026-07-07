# ACC Admin Suite — Operations Runbook

Plain-language steps for nursing admins and IT on the **work laptop**. No developer tools required for day-to-day use.

**Audience:** Ward admin staff, team leads, and hospital IT helping with deploy or recovery.

---

## 1. How the app is deployed (I: drive)

The suite is a **folder of files** on your shared drive — not a website you log into.

| What | Where |
|------|--------|
| App files | Copy the whole `dist/` folder to your shared I: drive (path decided by your team — see `EMAIL_PORTAL_INPUTS_CHECKLIST.md` A-05) |
| Your patient data | A separate `.accdata` file you save/load via the TopBar (not inside `dist/`) |
| Full archive with PDFs | Optional `.zip` from **Export Center → Full backup** |

### First-time setup (IT or lead admin)

1. Run `npm run build` on a dev machine (or take a pre-built `dist/` zip from your release owner).
2. Copy the entire `dist/` folder to the shared drive, e.g. `I:\ACC-Suite\dist\`.
3. Tell staff to double-click **`Start ACC Suite.cmd`** inside that folder.
4. Edge opens at `http://127.0.0.1:8765` — **keep the black command window open** while working.
5. Each user loads their `.accdata` via **TopBar → Open / Connect file** (shared file on I: drive per U-07).

### Updating to a new version

1. **Export first** — TopBar **Save my data** (`.accdata`) and, if you use letter PDFs, **Export Center → Full backup (.zip)**.
2. Close the app (close the browser tab and the command window).
3. Replace the old `dist/` folder on I: drive with the new build (same path as before).
4. Double-click **`Start ACC Suite.cmd`** again.
5. Load your `.accdata` — your data is in the file, not in `dist/`.

> **Settings blurb:** Open **Settings → How saving works** for the same launch and save explanation shown in the app.

### Planned: diagnostics export (roadmap P7-003)

A future release will add **Settings → Download diagnostics** — a local text file of recent errors and key actions (no network). Until then, if something breaks, note the time, what you clicked, and use **Error recovery → Download error report** if the red error screen appears.

---

## 2. Backup — what to do and when

### Two layers of protection

| Layer | What it is | Protects against |
|-------|------------|------------------|
| **IndexedDB autosave** | Automatic working copy in this browser | Browser crash, accidental tab close |
| **`.accdata` export** | File you control on I: drive or USB | New PC, browser data cleared, corrupt IDB |

**Important:** Autosave does **not** replace exporting. The TopBar shows **Unsaved changes** until you **Save my data** to `.accdata`.

### Recommended routine

1. **Every day you edit data:** TopBar → **Save my data** before leaving.
2. **Weekly (or when prompted):** Accept the backup reminder modal, or snooze for 24 hours if you already exported today.
3. **Monthly / before upgrades:** **Export Center → Full backup (.zip)** — includes all letter PDFs stored in the browser.

### Full backup (.zip)

- **Export:** Export Center → **Export full backup (.zip)** — checksum manifest inside (`manifest.json`).
- **Restore:** Export Center → **Restore full backup** — use if you moved to a new laptop or IDB blobs are missing.

### Shared `.accdata` on I: drive (multi-user)

Only **one person should edit at a time**. Last save wins. Coordinate via team chat or a rota. See `USER_INPUTS_NEEDED.md` U-07.

---

## 3. Corrupt load — what you will see

The app **never silently loads sample data** in production. If the browser working copy is damaged, you get a **Recovery** screen instead of an empty dashboard.

### Symptoms

- App opens to **Recovery required** modal on startup.
- TopBar flash: corrupt load or failed import.
- Importing a bad `.accdata` or `.zip` rolls back — nothing is half-applied.

### What to do (in order)

1. **Restore from `.accdata`** (Recovery modal → **Restore from .accdata**) — pick your last good file from I: drive or USB.
2. If letters/PDFs are missing after restore → **Restore from ZIP** (full backup from Export Center archive).
3. **Start empty** — only if you have no backup and accept losing the corrupt browser copy (disk backups are untouched).
4. **Load sample data** — development/demo only; hidden unless production mode is off in Settings.

### Clearing browser data (IT)

If IT wipes Chrome/Edge site data for `127.0.0.1:8765`, the working copy is gone — **not** your `.accdata` on disk. Reload the app and **Open** your `.accdata` file again.

Chrome IndexedDB path (for IT support):  
`%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\`  
(Edge uses a similar path under `Microsoft\Edge\User Data\`.)

---

## 4. Portal discovery (non-technical steps)

Use this **once per portal UI change** so developers can update automation scripts. **You** log in; the tool only maps what is on screen.

### Before you start

- Work laptop on hospital network / Citrix VPN as usual.
- Copy `dist/` to the laptop (same folder as **Start ACC Suite.cmd**).

### Steps

1. Double-click **`Start Portal Discover.cmd`** in the `dist/` folder.
2. A browser window opens — **log into Citrix and the ACC portal** the way you normally would.
3. Navigate to the ACC report or browse page you use for claim status.
4. When you are on the right page, click **OK** on the popup dialog.
5. Wait for the script to finish — File Explorer opens automatically.
6. Results are saved to **`%USERPROFILE%\ACC-Suite\`**:
   - `portal-map.json` — machine-readable page map (send to dev team).
   - `portal-summary.html` — human-readable summary.

### If it fails

- Make sure you clicked **OK** only after the portal page fully loaded.
- Close extra browser windows and run the `.cmd` again.
- Do not share `portal-map.json` outside the team until patient names and claim numbers are redacted (see `scripts/wfh/README.md`).

**No typing commands, no Node.js** — PowerShell is built into Windows.

---

## 5. Folder watch (optional, dev machine today)

Overnight PDF drops use **`ACC-Inbox/`** and a folder-watch script. On the work laptop, folder watch is **not** bundled yet (`folder-watch.ps1` shows “coming soon”).

When enabled:

1. Drop PDFs in `~/ACC-Inbox` (or team inbox path).
2. Run folder watch on a machine with Node.js (`npm run wfh:folder-watch`).
3. In the app: **Review Queue → Import folder-watch sidecars**.
4. Review each letter — or **batch approve** high-confidence items that show **Batch ready**.

Low-confidence and duplicate-suspect items always need **Review & import** (one at a time).

---

## 6. Quick reference

| Task | Where in app |
|------|----------------|
| Save data to file | TopBar → **Save my data** |
| Load shared data | TopBar → **Open** / **Connect** |
| Full backup with PDFs | Export Center |
| Recent changes log | Settings → **Recent activity** |
| Data health warnings | Settings → **Data health** |
| Letter import help | Settings → **How saving works** (links to `LETTER_IMPORT_UX.md`) |
| Human review / batch approve | Sidebar → **Review Queue** |
| Production vs dev auto-file | Settings → **Production mode** (keep ON at hospital) |

---

## 7. Who to call

| Issue | Contact |
|-------|---------|
| App won’t start / I: drive path | IT + team lead (U-01 path) |
| Lost data / restore drill | Team lead + last `.accdata` owner (U-02) |
| Portal script broke after ACC UI change | Re-run §4, send redacted `portal-map.json` to dev |
| Privacy / overnight automation | DHB privacy officer (U-08) before enabling SUPER WFH |

---

*Related docs:* `change-requests/PRODUCTION_READINESS.md`, `scripts/wfh/README.md`, `change-requests/USER_INPUTS_NEEDED.md` (U-01, U-07).
