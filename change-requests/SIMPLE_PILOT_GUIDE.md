# Simple Pilot Guide — Last Steps to Finish the Roadmap

Plain English. Tiny steps. For your **work laptop** (Windows).

**You are the UAT tester** (Prakriti). Sign-off is self-sign-off until more admins join.

---

## Your progress (2026-07-08)

| Phase / area | Status | Notes |
| ------------ | ------ | ----- |
| **A — Work laptop setup** | ✅ Assumed done | PDF import working on work laptop |
| **B — Letter import smoke** | ✅ **Pass** | Approval + decline PDF import confirmed |
| **C Day 1 — Core UAT** | 🟡 **Partial** | J-01, J-01a, J-01b, J-04, J-05, J-23 **Pass**; J-02, J-03, J-06, J-12, J-14, J-15, J-22 skipped (“lazy — assume functional”) |
| **C Day 2 — Scale/edge** | ⏸ Not started | Most rows still blank |
| **D — Portal** | ✅ Captured | Folder nav + 45 SSRS links; optional re-run only if ACC changes UI |
| **Automation — Folder watch** | 🟡 **Next** | Double-click `Start Folder Watch.cmd` on work laptop (see Phase G below) |
| **E — I: drive deploy** | ⏭ **Last** | After automation UAT + fresh `dist/` zip |
| **F — Sign-off** | ⏭ After E | Review checklist + shared `.accdata` |

**Word import (new):** Rebuild `dist/` from dev — buttons now say **Import ACC letter (PDF or Word)** and accept `.docx`. Test with `approval-template.docx` same as PDF.

**HRQ / folder-watch (J-25, J-26):** All patient data stays on the work laptop. Folder watch now runs **on the work laptop** via `Start Folder Watch.cmd` (PowerShell only — no Node.js). See Phase G below.

**Dates:** All on-screen dates now show **dd/mm/yyyy** (NZ format). Data still stores as ISO internally.

**👉 Do next:** Phase **G** (folder watch on work laptop) → finish lazy Day 1 rows if you want → Phase **E** (I: drive deploy, last) → Phase **F**.

---

## Before you start — what to bring


| Item                                                                      | Why                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Built** `dist/` **folder** (zip from dev machine after `npm run build`) | The app itself                                                                                   |
| **2–3 test PDFs**                                                         | Approval + decline letters (repo fixtures work: `approval-template.pdf`, `decline-template.pdf`) |
| **1 test Word letter (.docx)** (optional)                                 | Same template as PDF: `approval-template.docx` — import should match PDF fields                  |
| **1 scanned PDF** (optional)                                              | For OCR test J-14                                                                                |
| **1 broken/corrupt file** (rename a .txt to .pdf)                         | For J-02                                                                                         |
| **Shared** `.accdata` **file** (or start empty)                           | Your patient data on I: drive                                                                    |
| **VPN** (optional)                                                        | Only for Portal Discover — not needed for normal app use                                         |
| **Pen + this checklist**                                                  | Fill Pass/Fail as you go                                                                         |


**Where things live on Windows:**


| Thing                  | Path                                                                  |
| ---------------------- | --------------------------------------------------------------------- |
| App (after copy)       | `I:\ACC-Suite\` (or `%USERPROFILE%\Desktop\ACC-Suite\` for solo test) |
| Launcher logs          | `%USERPROFILE%\ACC-Suite\logs\`                                       |
| Portal discover output | `%USERPROFILE%\ACC-Suite\portal-map.json`                             |
| Folder watch inbox     | `%USERPROFILE%\ACC-Inbox\` (PDF and Word `.docx` letters) — open via `Start ACC-Inbox Folder.cmd` |
| Folder watch sidecars  | `%USERPROFILE%\ACC-Inbox\.staging\*.json`                             |
| Your data file         | Wherever you save it — e.g. `I:\ACC-Suite\acc-nursing-data.accdata`   |


---



## Phase A — Get the app on your work laptop

**Time: ~15 minutes**

1. On your **dev Mac**, run `npm run build` (if not already built).
2. Zip the whole `dist/` folder.
3. Copy the zip to your work laptop (USB, email, OneDrive — whatever works).
4. Unzip to a folder — e.g. `C:\Users\YourName\Desktop\ACC-Suite\`.
5. Open that folder in File Explorer.
6. Confirm these files exist:
  - `index.html` (big file, ~10 MB)
  - `Start ACC Suite.cmd`
  - `launch.ps1`
  - `eng.traineddata` (for scanned letters)
7. Double-click `Start ACC Suite.cmd`.
8. A black command window should stay open. Read the text — it should say something like serving on port 8765.
9. Edge or Chrome should open to `http://127.0.0.1:8765`.
10. You should see the ACC District Nursing Admin Suite sidebar (Dashboard, Patients, etc.).
11. If the browser did not open, copy the URL from the black window and paste it into Edge manually.
12. Click **TopBar → Open** (or **Connect file**) and pick your `.accdata` — or skip if starting fresh.
13. **Leave the black window open** the whole time you use the app. Closing it closes the app.

**Pass if:** Browser shows the app and you can click between sidebar items without errors.

---



## Phase B — Letter import smoke test

**Time: ~20 minutes**

Do this once before the full UAT checklist.

1. In the sidebar, click **Approvals**.
2. Click **Import ACC letter (PDF or Word)**.
3. In the file picker, choose an **approval PDF or .docx** (e.g. `approval-template.pdf` or `approval-template.docx`).
4. Wait — you should see a loading bar, then a preview of text from the PDF.
5. On the confirm screen, check these fields look filled in:
  - Patient name
  - NHI
  - Claim number
  - Service rows (NS04/NS05)
6. If something is wrong, edit the field — do not click Save yet until it looks right.
7. Click **Save** (or **Confirm and save**).
8. You should see a **success** screen with links like **Open claim**.
9. Click **Open claim**.
10. In Patients, open the claim and check:
  - Approvals are listed
    - The PDF appears under Documents
11. Click **TopBar → Save my data** and save a `.accdata` file to disk.
12. Repeat steps 1–7 with a **decline PDF** from the **Declines** module.

**Pass if:** Approval and decline both save, letter files attach, and data survives after **Save my data**.

> **2026-07-08:** ✅ PDF approval + decline confirmed on work laptop.

---



## Phase C — UAT checklist (two sessions)

Open `change-requests/UAT_CHECKLIST.md` and fill in **Tester | Date | Pass/Fail | Notes** for each row.

### Day 1 — Core daily work (~2 hours)

Focus: import, save, errors, layout.

#### J-01 — Approval full save

1. Sidebar → **Approvals**.
2. **Import ACC letter (PDF)** → pick approval fixture.
3. Review fields on confirm screen.
4. Click **Save**.
5. On success, click **Open claim**.
6. Count approvals on the claim — fixture should show multiple rows (expect ~8).
7. Open **Documents** — PDF should be there.
8. **Pass/Fail:** ____Pass_______



#### J-01a — Prefill new patient

1. Sidebar → **Patients**.
2. Click **New patient**.
3. Click **Prefill from letter** (inside the modal).
4. Pick an approval PDF.
5. Check name, NHI, DOB fields filled — **do not save yet**.
6. Click **Save patient** on the form.
7. Manually add a claim if needed.
8. **Pass/Fail:** _____Pass______



#### J-01b — Prefill new claim

1. Open an **existing patient**.
2. Click **New claim**.
3. Click **Prefill from letter**.
4. Pick a PDF — claim fields fill in.
5. Close modal **without saving** — nothing should be saved to the claim yet.
6. Re-open and save — now it should persist.
7. **Pass/Fail:** ____Pass_______



#### J-02 — Corrupt PDF error

1. Any import button → pick a **fake PDF** (text file renamed to `.pdf`).
2. An **error modal** should appear — not a blank screen.
3. Click **Try another file** — picker opens again.
4. **Pass/Fail:** __Lazy to do assume functional flag as possible future error_________



#### J-03 — Dirty save model

1. Edit any patient field (change a phone number).
2. Look at TopBar — should show unsaved / dirty state.
3. Click **Save my data** → pick `.accdata` location.
4. Reload app → **Open** that file — change should be there.
5. **Pass/Fail:** ____Lazy to do assume functional flag as possible future error_______



#### J-04 — Close-tab warning

1. Edit a patient again (dirty state).
2. Try to **close the browser tab** — browser should warn you.
3. Click **Stay on page**.
4. Navigate to **Dashboard** without editing — no warning.
5. **Pass/Fail:** ____Pass_______



#### J-05 — Backup reminder

1. Sidebar → **Settings** → find backup / export section.
2. If you exported recently, reminder may not show — note "skipped, exported today" OR
3. Use **Export Center** after a week without export to trigger reminder modal.
4. Modal should link to **Export Center**.
5. **Pass/Fail:** ___Pass________



#### J-06 — No auto-commit (George)

1. Load sample data if empty: Settings → load sample (dev only) OR use a patient named George in fixture data.
2. Import a letter that **matches George**.
3. Confirm screen must still appear — app must **not** skip straight to saved.
4. You must click **Save** yourself.
5. **Pass/Fail:** ____Lazy to do assume functional flag as possible future error_______



#### J-12 — Modal fits screen (1280×720)

1. Set browser window to roughly **1280×720** (not full screen).
2. Run letter import → get to **confirm** screen.
3. Scroll the modal — footer buttons (**Save**, **Cancel**) must not be cut off.
4. **Pass/Fail:** ____Lazy to do assume functional flag as possible future error_______



#### J-14 — Scanned OCR

1. Import a **scanned** PDF (image-only, no selectable text).
2. Wait for **"Scanned PDF detected"** callout and progress.
3. When done, confirm screen should have extracted text.
4. Save or attach as document only if OCR fails.
5. **Pass/Fail:** ____Lazy to do assume functional flag as possible future error_______



#### J-15 — Compliance routing

1. Sidebar → **Compliance**.
2. Find a row with **Create approval** fix → click it.
3. Should open **Approvals** with new-approval modal — **not** a file picker.
4. Go back to Compliance → find **Request PO** fix → click it.
5. Should jump to **Patients** on that claim.
6. Find **Import approval letter** button → should open letter import with claim context.
7. **Pass/Fail:** ___Lazy to do assume functional flag as possible future error________



#### J-22 — Duplicate letter

1. Import the **same PDF file** twice (same file, same hash).
2. Second time should warn **duplicate** — confirm before saving again.
3. **Pass/Fail:** ___Lazy to do assume functional flag as possible future error________



#### J-23 — Drag-drop import

1. Drag a PDF from File Explorer onto the app window.
2. Import modal should open automatically.
3. Complete import as normal.
4. **Pass/Fail:** ___Pass________

---



### Day 2 — Scale, tables, edge cases (~2–3 hours)



#### J-07 — Dashboard queue cap

1. Load large or sample data (many patients).
2. Sidebar → **Dashboard**.
3. Action queue should show **at most 50 rows**.
4. Click a link to **Compliance** — should deep-link to a claim.
5. **Pass/Fail:** ____Lazy to do assume functional flag as possible future error_______



#### J-08 — Compliance pagination

1. **Compliance** with many violations.
2. Use filters — results should paginate (not one endless list).
3. Click a **Fix** button — routes to correct module.
4. **Pass/Fail:** _____Lazy to do assume functional flag as possible future error______



#### J-09 — Billing scroll

1. Sidebar → **Billing** (needs many invoice lines — sample/large data).
2. Scroll up and down — should feel smooth, not frozen.
3. Click a column header to sort.
4. **Pass/Fail:** _____Lazy to do assume functional flag as possible future error______



#### J-10 — Approvals historical

1. Import a letter with **multiple approval rows**.
2. In Approvals table, default view shows **current** rows only.
3. Toggle **historical** — older rows appear.
4. Click **View letter** on a row.
5. **Pass/Fail:** _____Lazy to do assume functional flag as possible future error______



#### J-11 — Declines table

1. Sidebar → **Declines**.
2. Scroll the table with many rows.
3. Click **Open patient** on a row — jumps to correct patient.
4. **Pass/Fail:** ____Lazy to do assume functional flag as possible future error_______



#### J-13 — Mobile width (375px)

1. Narrow browser to **375px** wide (or use DevTools device mode).
2. Sidebar **hamburger** toggle works.
3. **Patients** page — grid stacks vertically.
4. Letter import modal uses full width.
5. **Pass/Fail:** ___Lazy to do assume functional flag as possible future error________



#### J-16 — Corrupt browser storage (IT)

1. *Optional / IT:* Corrupt IndexedDB via DevTools.
2. Reload app → **Recovery** screen — not silent empty dashboard.
3. Restore from `.accdata`.
4. **Pass/Fail:** ____Lazy to do assume functional flag as possible future error_______ (or N/A)



#### J-17 — Corrupt .accdata file (IT)

1. Try to **Open** a broken `.accdata` (garbage text file renamed).
2. Error shown — existing data **unchanged**.
3. **Pass/Fail:** _____Lazy to do assume functional flag as possible future error______



#### J-18 — Backup round-trip (IT)

1. **Export Center → Export full backup (.zip)**.
2. Close browser, reopen app (fresh session).
3. **Export Center → Restore full backup**.
4. Patient/claim counts should match before export.
5. **Pass/Fail:** ____Lazy to do assume functional flag as possible future error_______



#### J-19 — Error boundary (Dev)

*Skip unless you enable dev mode.* Red error screen → download report.

**Pass/Fail:** Skip / N/A skip

#### J-20 — Encryption

**Skip** — encryption is off per your decision (U-03).

**Pass/Fail:** N/A skip

#### J-21 — Two tabs

1. Open app in **two browser tabs** (same URL).
2. A **warning banner** about concurrent tabs should appear.
3. **Pass/Fail:** ___Lazy to do assume functional flag as possible future error________



#### J-24 — Stale remittance queue

1. Find an old remittance-related row in data.
2. Check it appears in Dashboard or action queue as stale.
3. **Pass/Fail:** _____Lazy to do assume functional flag as possible future error______



#### J-25 — HRQ sign-off

*Partial on work laptop* — folder-watch needs dev machine Node.js today.

1. On work laptop: Sidebar → **Review Queue** — confirm module loads and shows empty/help text.
2. For full test: on dev machine run folder-watch, drop PDF, import sidecar in Review Queue, approve.
3. **Pass/Fail:** ____We need to rethink this part all patient info needs to stay on work laptop so we need the work from home to be on the work laptop which is at the location of home but is the work laptop_______ (note: partial OK)



#### J-26 — Batch approve HRQ

*Same as J-25* — needs folder-watch sidecars on dev machine.

1. Stage 3 letters in HRQ.
2. Select all → **Approve selected** → confirm patient names listed.
3. All three commit.
4. **Pass/Fail:** _____We need to rethink this part all patient info needs to stay on work laptop so we need the work from home to be on the work laptop which is at the location of home but is the work laptop______ (note: partial OK)



#### J-27 — ACC Inbox stub

1. Sidebar → **ACC Inbox** (if visible).
2. Stub list loads — staging actions show stub messages.
3. **Pass/Fail:** ___Its loading and i can see the stub messages________ (stub expected until P8-017)

---



## Phase D — Portal (mostly done)

**Time: ~10 minutes** (only if ACC changes their portal UI)

**Already captured (2026-07-08):** folder navigation, 45 SSRS links, base URL `http://cl-biprddb02/Reports_MSREPORT/`.

**What's left (optional, not blocking pilot):**

1. Second Portal Discover run **after opening the actual report grid** (not just folder browse).
2. Note report parameter fields if any appear before **Run**.
3. Send updated `portal-map.json` from `%USERPROFILE%\ACC-Suite\` to dev.

**Only do this if:** ACC changes the portal and automation breaks later.

Steps if needed:

1. Connect **VPN** / hospital network.
2. Copy `dist/` to laptop.
3. Double-click `Start Portal Discover.cmd`.
4. Log into Citrix and ACC portal as usual.
5. Navigate to **ACC District Nursing Visits** report.
6. Click **OK** on the popup when page is fully loaded.
7. File Explorer opens — check `%USERPROFILE%\ACC-Suite\portal-map.json` exists.

---



---



---

## Two ways to get ACC letters into the app (read this first)

There are **two different flows**. Mixing them up is the usual reason file pickers seem to "block" PDF or Word.

### Flow 1 — Outlook → ACC-Inbox folder (automation path)

Use this when the letter arrives as an **email attachment** in Outlook.

1. Open the ACC email in **Outlook desktop** (not web, not Citrix).
2. **Right-click the attachment** (e.g. `John-Bentley-approval.docx`) → **Save As…**
3. Save into your **ACC-Inbox folder** — not into the app.
   - Default: `C:\Users\YourName\ACC-Inbox\`
   - Quick open: double-click **`Start ACC-Inbox Folder.cmd`** in your `dist\` folder (creates the folder if missing).
4. With **`Start Folder Watch.cmd`** running, the file is picked up automatically and a `.staging\*.json` sidecar is written.
5. In the app: **Review Queue** → **Import ACC-Inbox .staging folder** → pick the **`.staging` folder** (JSON sidecars only — **not** the PDF/DOCX here).
6. Click **Review & import** on the staged item → **now** pick the letter file (PDF or `.docx`) from `ACC-Inbox\processed\`.

**Do not** use the app's import buttons to "submit" straight from Outlook — save the attachment to disk first.

### Flow 2 — Direct import in the app (no folder watch)

Use this when you already have the letter file on disk (USB, Downloads, `ACC-Inbox\processed\`, etc.).

1. Go to **Approvals**, **Declines**, or **Patients**.
2. Click **Import ACC letter (PDF or Word)**.
3. In the file picker, choose a **`.pdf` or `.docx`** file.
4. Confirm fields → **Save**.

**Supported:** `.pdf` and `.docx` only. Legacy `.doc` (old Word) is **not** supported — in Word use **Save As → Word Document (.docx)** first.

### Example — John Bentley approval `.docx`

| Step | Action |
| ---- | ------ |
| 1 | Email from `John.Bentley@acc.co.nz` arrives in **ACCDistrictNursing** mailbox |
| 2 | Right-click attachment → **Save As** → `C:\Users\YourName\ACC-Inbox\approval.docx` |
| 3 | Folder watch window shows `[staged] approval.docx -> .staging\....json` |
| 4 | App → **Review Queue** → **Import ACC-Inbox .staging folder** → select `ACC-Inbox\.staging` |
| 5 | **Review & import** → pick `ACC-Inbox\processed\approval.docx` → confirm → **Save** |

Or skip steps 3–5: **Approvals** → **Import ACC letter (PDF or Word)** → pick the `.docx` directly.

### If IT blocks writing to your profile folder

Set a writable path in `%USERPROFILE%\ACC-Suite\office-config.json`:

```json
"accInbox": {
  "inboxPath": "H:\\ACC-Inbox"
}
```

Or set env **`ACC_INBOX_PATH`** (or **`ACC_INBOX`**) before running Folder Watch / Email Sync. All three launchers use the same resolution order.

**Old build warning:** If buttons still say "PDF only" or the picker hides `.docx`, replace `dist\` with a fresh zip after `npm run build` on the dev machine (see Phase I).

---

## Phase G — Folder watch automation (work laptop)

**Time: ~15 minutes**

All patient data stays on the work laptop — do **not** run folder watch on the dev Mac for real letters.

1. On dev Mac: `npm test` → `npm run build` → zip `dist/` → copy to work laptop (or wait until Phase E if testing locally first).
2. Unzip `dist/` to your test folder (e.g. Desktop `ACC-Suite\`).
3. Confirm these files exist:
   - `Start Folder Watch.cmd`
   - `Start ACC-Inbox Folder.cmd`
   - `folder-watch.ps1`
4. Double-click **`Start Folder Watch.cmd`**.
5. A black window opens and stays open — it says it is watching `%USERPROFILE%\ACC-Inbox`.
6. Open File Explorer → go to `C:\Users\YourName\ACC-Inbox\` (Windows creates it on first run).
7. Copy a test **approval PDF or .docx** into `ACC-Inbox\` (fixtures: `approval-template.pdf` or `approval-template.docx`).
8. In the black folder-watch window, you should see `[staged] approval-template.pdf -> .staging\...json`.
9. The letter file moves to `ACC-Inbox\processed\`.
10. Double-click **`Start ACC Suite.cmd`** (separate window — keep both open).
11. In the app sidebar, click **Review Queue**.
12. Click **Import ACC-Inbox .staging folder** → pick `C:\Users\YourName\ACC-Inbox\.staging`.
13. The staged letter appears in the queue.
14. Click **Review & import** → pick the letter from `ACC-Inbox\processed\` (or your original copy).
15. Confirm fields (dates show **dd/mm/yyyy**) → **Save**.
16. **Pass if:** sidecar imports, letter parses, data saves.

**Pause automation:** create an empty file `ACC-Inbox\.automation-paused` or set env `ACC_AUTOMATION_PAUSED=1`.

**Logs:** `%USERPROFILE%\ACC-Suite\logs\folder-watch-bootstrap.log` and `folder-watch-*.log`.

---

## Phase H — Outlook COM probe + email sync (optional, ~5 min)

**Purpose:** Check whether IT allows PowerShell to read your **already-open Outlook desktop**, then sync ACC letter attachments into `ACC-Inbox`.

**Prerequisite:** Outlook desktop open and logged in (not Outlook web, not Citrix).

### Step 1 — Probe (read-only test)

1. Confirm `Start Email Probe.cmd` and `outlook-probe.ps1` exist in your `dist/` folder (after rebuild).
2. Double-click **`Start Email Probe.cmd`**.
3. **PASS** if you see unread count + last 3 subjects + "PASS - Outlook COM read works".
4. **FAIL** if programmatic access is blocked — keep using Phase G folder watch + manual Outlook rule (see [`EMAIL_AUTOMATION_FEASIBILITY.md`](EMAIL_AUTOMATION_FEASIBILITY.md)).
5. Log: `%USERPROFILE%\ACC-Suite\logs\email-probe-bootstrap.log`

### Step 2 — Backlog sync (only if probe PASS)

**What this does (plain English):** Each time you double-click **Start Email Sync.cmd** (any time of day — see note below), it pulls the **oldest unactioned ACC emails** from Outlook (up to 50 per run), saves PDF or Word attachments into `ACC-Inbox`, and remembers where it stopped. It **never** auto-imports into the app — use **Start Folder Watch.cmd** → **Review Queue** to import manually. Emails tagged **actioned** in Outlook (or marked complete with a flag) are skipped.

> **Work hours (U-08 update):** Manual runs are **no longer clock-blocked**. Double-clicking **Start Email Sync.cmd** or **Start WFH Mode.cmd** always runs, even late at night — a manual launch is itself the signal you're working from home. The log will say `Manual run (HH:mm NZ) - work-hours gate skipped`. The 7am–6pm window is now only a configurable option for a *future* scheduled/automated daemon (`accWorkHours` in `office-config.json`, `enabled: false` by default).

1. Confirm `Start Email Sync.cmd` and `outlook-sync.ps1` exist in `dist/`.
2. Optional: copy `office-config.example.json` to `%USERPROFILE%\ACC-Suite\office-config.json` and tune ACC sender/subject filters or batch size (`emailSync.batchSize`, default 50). Default shared mailbox is **`ACCDistrictNursing`** (`emailSync.sharedMailbox`).
3. Double-click **`Start Email Sync.cmd`** — runs **immediately, any time of day** (manual run; the old 7am–6pm block no longer applies to manual launches). Log should show **`Using mailbox: ACCDistrictNursing`** and **`Manual run ... work-hours gate skipped`**.
4. Repeat during work hours until the log shows **saved 0** attachments (backlog cleared).
5. Tag processed emails **actioned** in Outlook if you want them skipped on future runs.
6. Status file: `%USERPROFILE%\ACC-Suite\email-sync-status.json` — load in **ACC Inbox** → **Load sync report**.
7. Checkpoint file: `%USERPROFILE%\ACC-Suite\email-sync-state.json` — resume after close or Ctrl+C.
8. Double-click **`Start Folder Watch.cmd`** so new attachments stage for **Review Queue**.
9. Log: `%USERPROFILE%\ACC-Suite\logs\email-sync-bootstrap.log`

**Switches:** `-Recent` for last-14-days mode only; `-BatchSize 25` for smaller batches; `-Scheduled` marks a run as the future automated daemon (obeys the `accWorkHours` window if `enabled: true`); `-IgnoreWorkHours` forces a `-Scheduled` run even outside its window. Manual double-click runs need none of these — they always run.

### Subject matching + attachment types (2026-07-08 update)

The sync no longer needs a subject to contain the exact literal `Claim:`/`ACCID:`. It now uses a **subject match mode** (`emailSync.subjectMatchMode` in `office-config.json`):

- **`tokens`** (default, safest): saves the email if the subject contains **EITHER `Claim` OR `ACCID`** — colon optional, case-insensitive (`Claim 123`, `Claim:123`, `ACCID` all match).
- **`all`**: require **BOTH** `Claim` **AND** `ACCID` in the subject (stricter — only if a user wants it).
- **`any`**: legacy behaviour — match **any** of `accInbox.subjectPatterns` (approv/declin/nur0.../etc.).

Attachment types saved are now **case-insensitive** and cover **`.pdf`, `.docx`, `.doc`** (configurable via `emailSync.attachmentExtensions`). `.doc` is saved for review, but in Word you still **Save As → .docx** before importing into the app.

Nothing changed about safety: every saved attachment still flows to the **Human Review Queue** for manual sign-off — no auto-commit.

**Diagnose first (read-only, PHI-safe):** if a sync saves 0 letters, double-click **`Start Email Diagnose.cmd`** (or run `outlook-diagnose.ps1`). The log at `%USERPROFILE%\ACC-Suite\logs\email-diagnose-bootstrap.log` now shows a **Claim/ACCID token histogram**, an **attachment extension histogram**, and a few **masked** sample subjects (digits→`#`, names→`Xxxxx`, tokens kept visible) so you can send us the real subject format without leaking PHI.

**Shared mailbox:** District nursing ACC letters live in **`ACCDistrictNursing`**, not your personal inbox. Sync/probe use that mailbox by default. Override in `%USERPROFILE%\ACC-Suite\office-config.json` (`emailSync.sharedMailbox`) or env `ACC_SHARED_MAILBOX` only if IT gives a different name.

**PHI:** Subjects may show patient names — do not screenshot for support; send log file only if asked.

---

## Phase I — Word letter import (verify after rebuild)

**Purpose:** Confirm `.docx` ACC letters import the same as PDF (UAT Bug 1 fix).

1. Rebuild on dev machine: `npm test` → `npm run build` → `npm run verify-build`.
2. Copy fresh `dist/` to work laptop (replace old build — old dist showed "PDF only" label).
3. In app: **Import ACC letter (PDF or Word)** — pick `approval-template.docx` or a real ACC Word letter.
4. **Pass if:** parser fills claim/PO/NHI fields like PDF; no "Could not find file in options" error.
5. Also test drag-drop `.docx` onto the app window.

**Cause of old bug:** production bundle uses mammoth's browser API (`arrayBuffer`), but code passed `buffer` only — fixed in current build.

---



## Phase E — Deploy to I: drive for coworkers

**Time: ~30 minutes**

1. On dev machine: `npm test` → `npm run build` → `npm run verify-build` (all pass).
2. Zip the `dist/` folder.
3. On hospital network, open the shared **I:** drive.
4. Create folder: `I:\ACC-Suite\` (or your team's path).
5. Copy/unzip entire `dist/` contents into `I:\ACC-Suite\`.
6. Confirm `Start ACC Suite.cmd` is there.
7. Create or copy shared data file: `I:\ACC-Suite\acc-nursing-data.accdata` (export from your tested copy).
8. Double-click `Start ACC Suite.cmd` from I: drive — confirm it works.
9. Send coworkers a short note:
  - Double-click `I:\ACC-Suite\Start ACC Suite.cmd`
  - Keep black window open
  - TopBar → **Open** → pick shared `.accdata`
  - **Save my data** before leaving
  - **Only one person edits at a time** (last save wins)
10. Put `office-config.example.json` on I: for reference if offices fork later.

---



## Phase F — Sign-off (what "done" looks like)

**Time: ~15 minutes to review**

You are **done with the pilot** when:

- [ ] Phase A works on work laptop from I: drive (or local copy).
- [ ] Phase B letter import passes for approval + decline.
- [ ] Day 1 UAT rows filled — **zero Fail** on J-01 through J-06, J-12, J-14, J-15, J-22, J-23.
- [ ] Day 2 UAT rows filled — no P0 regressions (corrupt load, auto-commit, save model, import blank modal).
- [ ] J-20 skipped (encryption off). J-19 skipped (dev). J-25/J-26 partial OK.
- [ ] Shared `.accdata` on I: drive with backup routine documented.
- [ ] `UAT_CHECKLIST.md` signed with your name and dates.
- [ ] **Release gate:** zero P0 regressions from roadmap §6.

**Production readiness today:** ~78% engineering — your sign-off closes the **hospital pilot gate** (P7), not full SUPER WFH automation.

---



## If something breaks


| Problem                       | What to do                                                               |
| ----------------------------- | ------------------------------------------------------------------------ |
| Black window closes instantly | Read `%USERPROFILE%\ACC-Suite\logs\acc-bootstrap.log`                    |
| App won't start               | See `dist\TROUBLESHOOT.txt` — re-download latest `dist/`                 |
| Browser blank / errors        | **Settings → Download diagnostics** — save file                          |
| Red crash screen              | Click **Download error report**                                          |
| Lost browser data             | **TopBar → Open** your `.accdata` — data is in the file, not the browser |
| Launcher logs                 | `%USERPROFILE%\ACC-Suite\logs\acc-suite-*.log`                           |
| Portal discover logs          | `%USERPROFILE%\ACC-Suite\logs\portal-discover-*.log`                     |
| Folder watch not staging      | Check `%USERPROFILE%\ACC-Suite\logs\folder-watch-bootstrap.log`          |
| Still stuck                   | Email bootstrap log + diagnostics to Prakriti                            |


**Do not** look for logs inside `I:\ACC-Suite\` — logs go to your user profile only.

---



## Time summary


| Phase                    | Time                              |
| ------------------------ | --------------------------------- |
| A — Work laptop setup    | ~15 min                           |
| B — Letter import test   | ~20 min                           |
| C Day 1 — Core UAT       | ~2 hr                             |
| C Day 2 — Scale/edge UAT | ~2–3 hr                           |
| D — Portal (if needed)   | ~10 min                           |
| G — Folder watch         | ~15 min                           |
| E — I: drive deploy      | ~30 min (last)                    |
| F — Sign-off review      | ~15 min                           |
| **Total**                | **~6–7 hours** spread over 2 days |


---

*Created 2026-07-08 from UAT_CHECKLIST, WRAP_UP_STATUS, USER_INPUTS_NEEDED, RUNBOOK, and MASTER_ROADMAP journey scripts.*

---

## What happens next (5 steps)

1. **You — rebuild & copy app:** On dev Mac run `npm test` → `npm run build` → zip `dist/` → copy to work laptop. New build has **dd/mm/yyyy dates**, **PDF and Word** import, and **Start Folder Watch.cmd**.

2. **You — folder watch (Phase G):** On work laptop, double-click `Start Folder Watch.cmd`, drop letters in `%USERPROFILE%\ACC-Inbox`, import `.staging` in **Review Queue**.

3. **You — optional UAT cleanup:** Re-run the “lazy” Day 1 rows (J-02 corrupt file, J-14 scanned OCR) if you want zero gaps before sign-off.

4. **You — pilot deploy last (Phase E):** Unzip to `I:\ACC-Suite\`, test `Start ACC Suite.cmd`, export your tested `.accdata` to the shared path, brief coworkers (one editor at a time).

5. **Engineering — after pilot sign-off:** Run **Phase H** (`Start Email Probe.cmd`) to test Outlook COM; if PASS, ship full email sync (P8-017). Portal read task (P8-2b) using your captured `portal-map.json`; overnight orchestrator last. See [`EMAIL_AUTOMATION_FEASIBILITY.md`](EMAIL_AUTOMATION_FEASIBILITY.md). **Blocked on you:** IT answer B-11 (programmatic mailbox read), real ACC sender/subject filters (B-04–B-07), and anonymised letter corpus (U-05) when ready.