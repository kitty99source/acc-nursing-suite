# WFH scripts — folder watch & portal discovery

Local-only tools for **work PC** use. No cloud credentials; no portal passwords in repo.

---

## Quick start — portal discovery (work laptop)

**Just double-click `Start Portal Discover.cmd`** in the `dist/` folder (same place as `Start ACC Suite.cmd`).

1. A browser opens — connect **Citrix VPN** and log into the **ACC portal**.
2. Click **OK** on the popup when you are on the ACC report / browse page.
3. Results land in `%USERPROFILE%\ACC-Suite\` (`portal-map.json` + `portal-summary.html`). Explorer opens automatically.

No Command Prompt typing, no `npm` commands, **no Node.js** — the launcher uses **PowerShell only** (built into Windows).

Mac (dev machine): double-click `Start Portal Discover.command` in `dist/` (still uses Node for CDP there).

---

## Prerequisites (developers / folder watch)

1. Clone this repo on your dev machine.
2. Install Node.js LTS (v18+) — **required for folder watch and dev builds only**.
3. From repo root:

```powershell
cd C:\path\to\ACCAdminsuite
npm install
```

Portal discovery on the **work laptop** uses **raw CDP via PowerShell** — no Node, no Playwright.

---

## P8-0 — Folder watch (`folder-watch.mjs`)

Watches `~/ACC-Inbox` (or custom path) for PDF drops and writes `.staging/*.json` sidecars.

**Work laptop:** not yet available without Node — `folder-watch.ps1` shows a "coming soon" message.

**Dev machine:**

```powershell
npm run wfh:folder-watch
# or
node scripts/wfh/folder-watch.mjs "C:\Users\You\ACC-Inbox"
```

Word (`.docx`) support is included — same as PowerShell folder-watch on Windows.

---

## P8-2b — Portal discovery

**Purpose:** Map the hospital BI portal DOM after **you** have logged in manually (Citrix VPN + SSO). The script attaches to your browser — it does **not** store or type passwords.

### Double-click launcher (recommended — work laptop)

After `npm run build`, copy the whole `dist/` folder to the work laptop (or shared drive). Double-click:

- **Windows:** `Start Portal Discover.cmd` — **PowerShell only, no installs**
- **Mac:** `Start Portal Discover.command` (Node-based)

The launcher opens Edge/Chrome with `--remote-debugging-port=9222`, shows a simple OK dialog, scans via CDP, and opens the results folder.

Output (fixed path, no prompts):

- Windows: `%USERPROFILE%\ACC-Suite\portal-map.json`
- Mac/Linux: `~/ACC-Suite/portal-map.json`

### Manual run (developers on Mac / dev PC)

**Snapshot current tab only:**

```powershell
node scripts/wfh/portal-discover.mjs --attach
```

**Crawl ACC / District Nursing links** (depth 2, max 12 pages):

```powershell
node scripts/wfh/portal-discover.mjs --attach --crawl
```

### Options (Node script — dev only)

| Flag | Default | Meaning |
|------|---------|---------|
| `--attach` | on when `PORTAL_DISCOVER_LAUNCHER=1` | Connect to existing debug browser (CDP) |
| `--cdp URL` | `http://127.0.0.1:9222` | Chrome DevTools Protocol endpoint |
| `--out path` | `~/ACC-Suite/portal-map.json` | Output JSON path |
| `--crawl` | on from launcher | Follow links matching ACC / District Nursing / DHB-wide |
| `--max-depth N` | 2 | Crawl depth limit |
| `--max-pages N` | 12 | Max pages to snapshot |
| `--no-summary` | off | Skip `portal-summary.html` |

Environment: `PORTAL_CDP_URL` overrides default CDP URL.

### After running

1. Open `portal-map.json` and **redact** any patient names, NHI, claim numbers, or staff details.
2. Commit the redacted map (or paste key selectors into checklist D-02).
3. Do **not** commit portal credentials.

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `Could not reach the browser debug port` | Browser not started with `--remote-debugging-port=9222` — use the `.cmd` launcher |
| `No portal page found` | Open portal tab in the debug browser first; connect VPN |
| Empty links on SSRS page | WebSocket may have failed — tab URLs/titles still saved; stay on Browse/ACC folder view and retry |
| Missing scripts in dist | Run `npm run build` on dev machine; copy entire `dist/` folder |

---

## Security

- **Never** put VPN, SSO, or portal passwords in scripts, JSON output, or git.
- Use Windows Credential Manager only when implementing automated login later (not in P8-2b).
- Rotate portal password if credentials were shared in chat (see checklist security note).
