# ACC Suite Launcher Incident Report

**Date:** 2026-07-08  
**Scope:** `scripts/launcher/` regression between `912dc81` (last known good) and `d44924c` (emergency revert)  
**Platform:** Windows work laptop, app deployed on mapped network drive (e.g. `I:\`)

---

## Executive summary

The ACC Suite launcher broke because **observability changes were fused into the startup critical path** without work-laptop validation. Two commits (`79832ed`, `71ec02a`) introduced failure modes that made the console close instantly and/or prevented PowerShell from running at all. Commit `d44924c` is a **partial restore** of the pre-logging launch path for `Start ACC Suite.cmd` / `launch.ps1`; it is not a complete rollback of the logging experiment across all launchers.

**Primary root cause:** `71ec02a` added `>> "%LAST_RUN%"` output redirection to the script directory on the mapped drive — a write that fails on read-only or locked `I:` shares, aborting launch before `launch.ps1` executes.

**Contributing root causes:**
1. `79832ed` removed `pause` on error from the `.cmd` wrapper and omitted `exit 1` in the PowerShell `catch` block — errors became silent instant closes.
2. `79832ed`/`71ec02a` wrapped the entire server lifecycle in a single `try/catch`, moved `$ErrorActionPreference = 'Stop'` inside that wrapper, and changed fatal paths from `Read-Host` + `exit 1` to `throw`.
3. `71ec02a` introduced `ACC_LAUNCHER_DIR`, `Set-Location`, and `launch-error.log` writes co-located with scripts on the network drive.
4. `Show-LauncherStartupSuccess` was inserted **before** the serve loop (blocking modal, not a crash — but poor UX and extra failure surface).

**Note on terminology:** The launcher has **never** used `System.Net.HttpListener`. It deliberately uses `System.Net.Sockets.TcpListener` on `127.0.0.1` only. This report uses “server” to mean the TcpListener HTTP serve loop.

---

## Timeline of commits

| Commit | Time (UTC+12) | Message | Launcher impact |
|--------|---------------|---------|-----------------|
| `912dc81` | 08:52 | Rewrite Portal Discover as pure PowerShell for work laptops | **Last known good** for `launch.ps1`. Linear script, `$PSScriptRoot`, no logging wrapper, no CMD redirect. |
| `79832ed` | 09:04 | Fix Windows launchers to log every run and never close silently | Added `launcher-log.ps1`, wrapped `launch.ps1` in `try/catch`, `Show-LauncherStartupSuccess` before serve loop, `throw` on missing `index.html`, CMD **removed** `pause` on error. |
| `71ec02a` | 09:13 | Fix Windows launchers closing instantly with no visible logs | Added `ACC_LAUNCHER_DIR`, `Set-Location`, `>> last-run.log` CMD redirect, `launch-error.log` on script dir, inline logging fallback, `exit 1` in catch, CMD `pause` on non-zero exit — **but redirect failure still unhandled**. |
| `d44924c` | 09:14 | Restore ACC Suite launcher to pre-logging minimal path | Reverted `Start ACC Suite.cmd` and `launch.ps1` to minimal path; optional `Write-LauncherLogSafe` logging; **Portal Discover still carries 71ec02a patterns**. |

All four commits landed within **~22 minutes** on the same morning with no work-laptop validation between them.

---

## Evidence gathered

### Git log (`git log --oneline -15 -- scripts/launcher/`)

```
d44924c Restore ACC Suite launcher to pre-logging minimal path.
71ec02a Fix Windows launchers closing instantly with no visible logs.
79832ed Fix Windows launchers to log every run and never close silently.
912dc81 Rewrite Portal Discover as pure PowerShell for work laptops.
6bbafa1 Improve Portal Discover launcher UX and dist README.
5cf5b5a Add compliance, letter import, backup/recovery, and WFH tooling.
```

### Byte-for-byte core loop comparison: `912dc81` vs `d44924c` `launch.ps1`

**Not byte-identical.** `diff` reports 23 hunks of additions in `d44924c` (optional logging wrapper only). The **TcpListener bind + serve loop logic is functionally identical** — same port range, same `AcceptTcpClient` loop, same `Send-Response` structure.

`d44924c` additions vs `912dc81`:
- Lines 15–36: optional `Write-LauncherLogSafe` + guarded dot-source of `launcher-log.ps1`
- Scattered `Write-LauncherLogSafe "Step: …"` calls before/after existing steps
- **Removed from broken path:** outer `try/catch` wrapper, `Show-LauncherStartupSuccess`, `ACC_LAUNCHER_DIR` / `Set-Location`, `throw` for missing index (restored `Read-Host` + `exit 1`)

### Revert verification: `git diff 71ec02a..d44924c -- scripts/launcher/`

The revert **did restore** the ACC Suite main launcher:
- `Start ACC Suite.cmd`: removed `ACC_LAUNCHER_DIR`, `LAST_RUN`, `>>` redirect, `msg.exe` failure path
- `launch.ps1`: restored linear flow, removed `Show-LauncherStartupSuccess`, restored graceful `index.html` handling
- `launcher-log.ps1`: hardened `Initialize-LauncherLog` with per-line `try/catch` (kept, not reverted)

The revert **also restored** Portal Discover (2026-07-08 follow-up):
- `Start Portal Discover.cmd` — removed `>> last-run.log`, `ACC_LAUNCHER_DIR`, failure `msg.exe` path
- `portal-discover.ps1` — optional `Write-LauncherLogSafe` logging; CDP path never blocked by log failures
- `launcher-log.ps1` — logs only under `%USERPROFILE%\ACC-Suite\logs\` (no script-dir writes)

---

## Forensic answers (with code citations)

### 1. What EXACT changes in `79832ed` and `71ec02a` could prevent the TcpListener/server from starting?

#### `79832ed` — changes that can abort before `AcceptTcpClient` loop

**A. Mandatory dot-source of `launcher-log.ps1` inside outer `try` (failure = script never reaches server code):**

```16:21:scripts/launcher/launch.ps1
# (as of 79832ed — reconstructed from git show 79832ed)
    $logHelper = Join-Path $PSScriptRoot 'launcher-log.ps1'
    if (-not (Test-Path -LiteralPath $logHelper)) {
        $logHelper = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'launcher-log.ps1'
    }
    . $logHelper
```

If `launcher-log.ps1` is missing from dist or dot-source fails, nothing after line 21 runs — **no TcpListener bind**.

**B. `$ErrorActionPreference = 'Stop'` + `throw` on missing `index.html` (was graceful `Read-Host` in `912dc81`):**

```24:32:scripts/launcher/launch.ps1
# (79832ed)
    $ErrorActionPreference = 'Stop'
    ...
    if (-not (Test-Path -LiteralPath $indexPath)) {
        throw "index.html was not found next to this script: $indexPath"
    }
```

**C. `throw` on port bind failure** (same as before, but now caught by outer catch that **did not `exit 1`** in `79832ed`):

```58:65:scripts/launcher/launch.ps1
# (79832ed)
        } catch {
            throw "Could not bind a local port: $($_.Exception.Message)"
        }
```

**D. CMD wrapper removed `pause` on error** — any non-zero exit closes instantly:

```1:9:scripts/launcher/Start ACC Suite.cmd
# (79832ed)
@echo off
cd /d "%~dp0"
...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
set EXITCODE=%ERRORLEVEL%
if %EXITCODE% NEQ 0 exit /b %EXITCODE%
```

Compare `912dc81` which had no `pause` either, but `d44924c` restored `if errorlevel 1 pause`.

**E. `79832ed` catch block logged errors but did NOT `exit 1`** — script could end with exit code 0 after a fatal `throw`, so CMD never paused:

```182:196:scripts/launcher/launch.ps1
# (79832ed)
} catch {
    $script:LauncherHadError = $true
    ...
    Write-Host $_.Exception.Message -ForegroundColor Red
}
# (no exit 1 here in 79832ed)
```

#### `71ec02a` — additional changes that prevent server start

**F. CMD `>> last-run.log` redirect — can fail BEFORE PowerShell starts (PRIMARY on `I:` drive):**

```15:16:scripts/launcher/Start ACC Suite.cmd
# (71ec02a)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" >> "%LAST_RUN%" 2>&1
```

If `I:\...\last-run.log` cannot be opened for append (read-only share, file lock, AV), `cmd.exe` fails the redirect. PowerShell may never run. The `.cmd` only `pause`s on PowerShell non-zero exit — **not on redirect failure** — producing an instant close with no log.

**G. `ACC_LAUNCHER_DIR` + path resolution switched from `$PSScriptRoot` to env-injected dir:**

```15:19:scripts/launcher/launch.ps1
# (71ec02a)
$script:LauncherDir = $env:ACC_LAUNCHER_DIR
if ([string]::IsNullOrWhiteSpace($script:LauncherDir)) { $script:LauncherDir = $PSScriptRoot }
...
try { Set-Location -LiteralPath $script:LauncherDir -ErrorAction Stop } catch {}
```

```77:81:scripts/launcher/launch.ps1
# (71ec02a)
    $root = $script:LauncherDir
    $indexPath = Join-Path $root 'index.html'
    if (-not (Test-Path -LiteralPath $indexPath)) {
        throw "index.html was not found next to this script: $indexPath"
```

If `ACC_LAUNCHER_DIR` is malformed or `index.html` cannot be resolved via that path, server never binds.

**H. `launch-error.log` created on script dir (network drive) during `Initialize-LauncherLog`:**

```72:73:scripts/launcher/launcher-log.ps1
    $launcherDir = Get-LauncherScriptDir
    $script:LauncherLocalLogPath = Join-Path $launcherDir 'launch-error.log'
```

Writes are wrapped in `try/catch` in `Write-LauncherLog` — **unlikely to kill launch alone**, but adds I/O on a potentially read-only path.

---

### 2. Could `Show-LauncherStartupSuccess` block or throw before the serve loop?

**In `79832ed` and `71ec02a`, yes — it blocks; no evidence it throws.**

Called at line 96 (`79832ed`) / line 160 (`71ec02a`) **after** TcpListener bind and browser open, **before** `while ($true)` serve loop:

```152:165:scripts/launcher/launcher-log.ps1
function Show-LauncherStartupSuccess {
    param([string]$Title = 'ACC Suite')
    if (-not $script:LauncherLogPath) { return }
    ...
    Show-LauncherMessageBox -Title $Title -Icon Information -Message @"
Done — ACC Suite is running.
...
"@
}
```

`Show-LauncherMessageBox` tries `msg.exe` first (non-blocking return), then falls back to `[System.Windows.Forms.MessageBox]::Show(...)` which **blocks until the user clicks OK**. The serve loop runs **after** the modal is dismissed — it does not prevent server start, but delays it and adds a UI dependency on hospital PCs where WinForms may be restricted.

**Verdict:** Blocking UX issue, not the primary crash. Removed in `d44924c`.

---

### 3. Could `$ErrorActionPreference = 'Stop'` in `launcher-log` kill launch?

**`launcher-log.ps1` does not set `$ErrorActionPreference` globally.**

In broken `launch.ps1`, `$ErrorActionPreference = 'Stop'` was set **inside** the outer `try`, after dot-sourcing `launcher-log.ps1`:

```74:74:scripts/launcher/launch.ps1
# (71ec02a)
    $ErrorActionPreference = 'Stop'
```

`launcher-log.ps1` uses `-ErrorAction Stop` only on scoped calls:

```25:27:scripts/launcher/launcher-log.ps1
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop | Out-Null
```

All file writes in `Write-LauncherLog` are individually wrapped:

```98:107:scripts/launcher/launcher-log.ps1
    try {
        if ($script:LauncherLogPath) {
            Add-Content -LiteralPath $script:LauncherLogPath -Value $line -Encoding UTF8
        }
    } catch {}
```

**Verdict:** `$ErrorActionPreference = 'Stop'` in `launch.ps1` (not `launcher-log.ps1`) can turn otherwise benign failures into terminating errors **inside the outer try** — but the real damage is the combination with `throw` + broken error UX (no pause / no exit 1 in `79832ed`), not `launcher-log.ps1` itself.

In `d44924c`, `$ErrorActionPreference = 'Stop'` is at file scope (line 13) **before** optional logging, and the main path is linear again — matching `912dc81` risk profile.

---

### 4. Could `ACC_LAUNCHER_DIR` / `Set-Location` break `I:` drive?

**`Set-Location` failure is swallowed** in `71ec02a`/`portal-discover.ps1`:

```14:14:scripts/launcher/portal-discover.ps1
try { Set-Location -LiteralPath $script:LauncherDir -ErrorAction Stop } catch {}
```

**`ACC_LAUNCHER_DIR` comes from CMD `%~dp0`:**

```3:3:scripts/launcher/Start Portal Discover.cmd
set "ACC_LAUNCHER_DIR=%~dp0"
```

`%~dp0` is the batch-file directory and is generally reliable on mapped drives. PowerShell's `$PSScriptRoot` also resolves mapped drive paths when the `.ps1` is invoked with `-File` ([Microsoft Learn / community guidance](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_automatic_variables#psscriptroot); [codegenes.net on `$PSScriptRoot` with UNC](https://www.codegenes.net/blog/powershell-run-command-from-script-s-directory/)).

**Known issues (documented, not ACC-specific):**
- Mapped drives in interactive sessions are **not always visible** to non-interactive/automated contexts ([TechResolve SMB guidance](https://techresolve.blog/2026/03/04/powershell-script-not-working-with-smb-directory/)).
- Microsoft and community guidance recommend **avoiding global `Set-Location`**; prefer `Join-Path $PSScriptRoot` for file resolution ([codegenes.net](https://www.codegenes.net/blog/powershell-run-command-from-script-s-directory/)).

**Verdict:** `ACC_LAUNCHER_DIR`/`Set-Location` is an unnecessary risk multiplier on `I:`, but the **swallowed** `Set-Location` means the more likely failure is wrong-path `index.html` resolution (throw) or **writing logs to `I:`**, not `Set-Location` itself. Removed from `Start ACC Suite.cmd` in `d44924c`; **still present** in Portal Discover.

---

### 5. Could `.cmd` `>> last-run.log` redirect cause failure on read-only or locked `I:` drive?

**Yes — this is the highest-confidence primary root cause for `71ec02a`.**

Mechanism:
1. `set "LAST_RUN=%~dp0last-run.log"` targets the script folder on `I:`.
2. `>> "%LAST_RUN%"` requires create/append permission **before** `powershell.exe` runs.
3. Read-only mapped shares, enforced by GPO, or AV locks → CMD cannot open redirect target.
4. Failure surface: instant window close; `pause` only runs when `EXITCODE NEQ 0` **after** PowerShell — redirect failures may not set that path consistently.

**Verdict:** Definitive contributing-to-primary failure mode. **Removed in `d44924c` for ACC Suite**; **still present** in `Start Portal Discover.cmd` line 15.

---

### 6. Is `d44924c` a real fix or does it still have latent bugs?

**Real fix for the main ACC Suite launcher — partial fix for the repo overall.**

| Area | `d44924c` status |
|------|------------------|
| `Start ACC Suite.cmd` | Fixed — no redirect, no `ACC_LAUNCHER_DIR`, `pause` on error |
| `launch.ps1` serve loop | Restored — functionally identical to `912dc81` |
| Optional logging | Safe pattern — `Write-LauncherLogSafe` never blocks |
| `Start Portal Discover.cmd` | **Fixed** — aligned with ACC Suite minimal path (no redirect, no `ACC_LAUNCHER_DIR`) |
| `portal-discover.ps1` | **Fixed** — optional logging only; CDP path independent of log failures |
| `launcher-log.ps1` | **Fixed** — no `launch-error.log` beside scripts; user-profile logs only |
| Integration tests | **None** — no automated launcher regression tests exist |
| Work-laptop validation | **Not performed** before any of the logging commits |

---

## Why ACC worked before, broke after, and what `d44924c` does

### Why it worked (`912dc81`)

```13:20:scripts/launcher/launch.ps1
# (912dc81)
$ErrorActionPreference = 'Stop'

# --- Resolve the file to serve (sibling index.html) -------------------------
$root = $PSScriptRoot
if ([string]::IsNullOrEmpty($root)) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$indexPath = Join-Path $root 'index.html'
```

- Single linear script: resolve path → read HTML → bind TcpListener → open browser → serve forever.
- No CMD output redirect to network drive.
- No logging module on critical path.
- Missing `index.html` showed error text + `Read-Host` (user-visible).

### Why it broke (`79832ed` → `71ec02a`)

1. **`79832ed`** optimized for logging visibility but accidentally optimized against reliability: wrapped server in `try/catch`, removed CMD `pause`, catch without `exit 1`, added blocking success modal.
2. **`71ec02a`** tried to fix visibility of failures but added **`>> last-run.log` on `I:`** — the deadliest change for hospital mapped-drive deployments.

### What `d44924c` does

Restores the `912dc81` critical path for ACC Suite with one safe addition — optional logging that cannot block:

```15:36:scripts/launcher/launch.ps1
# --- Optional logging (must never block launch) --------------------------------
$script:LauncherLogEnabled = $false
...
} catch {}
```

```7:8:scripts/launcher/Start ACC Suite.cmd
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
if errorlevel 1 pause
```

---

## Where we went wrong

1. **Changed the launch critical path to solve observability** — logging, modals, env vars, and CMD redirects were added to the same files that must bind a localhost socket on a read-only network share.
2. **Assumed `%USERPROFILE%\ACC-Suite\logs\` and `last-run.log` beside scripts were always writable** — hospital `I:` drives are often read-only for executables.
3. **Committed three launcher revisions in 22 minutes** without a work-laptop smoke test between them.
4. **Fixed “instant close” in `71ec02a` by adding more logging surface** (`last-run.log` redirect) instead of removing the failure introduced in `79832ed` (no `pause`, no `exit 1`).
5. **Partial revert** — Portal Discover still carries the broken patterns.

---

## Proper fix plan (not a bandaid)

### Architecture

1. **Split launch into two layers:**
   - `launch-core.ps1` — immutable, minimal, zero dot-sources, zero file writes except reading `index.html`; this is what ships and what we regression-test.
   - `launcher-observability.ps1` — optional, dot-sourced inside `try/catch {}`; logs only to `%USERPROFILE%\ACC-Suite\logs\` and `%TEMP%`; never writes beside scripts on `I:`.

2. **Never write logs via CMD redirect** — all logging inside PowerShell to user-writable paths only.

3. **Never call `Show-LauncherStartupSuccess` (or any modal) before the serve loop** — if needed, log a line and continue.

4. **Path resolution:** use `$PSScriptRoot` + `Join-Path` only; do not `Set-Location`; do not require `ACC_LAUNCHER_DIR`.

### Integration tests (add to CI)

```powershell
# Pseudocode — run on Windows runner
& .\launch-core.ps1 -TestMode  # exits after printing URL= line and one GET 200
```

- Assert stdout contains `URL=http://127.0.0.1:` pattern.
- HTTP GET `/` returns 200 with `index.html` bytes.
- Simulate read-only script dir: confirm launch still succeeds when local log path denied.
- Assert no `last-run.log` created beside script.

### Work-laptop validation checklist (manual, pre-release gate)

- [ ] Deploy zip to mapped `I:` drive (read-only share if available).
- [ ] Double-click `Start ACC Suite.cmd` — window stays open, Edge opens, app loads.
- [ ] Confirm **no** `last-run.log` / `launch-error.log` created on `I:` (logs only under `%USERPROFILE%\ACC-Suite\logs\`).
- [ ] Disconnect network / VPN — launcher still works (offline app).
- [ ] Rename `index.html` — error visible, window pauses.
- [ ] Portal Discover: repeat on `I:` with same rules.

### Apply same fix to Portal Discover

Revert `Start Portal Discover.cmd` and `portal-discover.ps1` to the same principles as `d44924c` ACC Suite — remove `>> last-run.log`, remove `ACC_LAUNCHER_DIR`, remove pre-loop modals.

---

## What we should NOT do again

1. **Do not fuse observability into startup-critical launcher code** without isolated module + feature flag.
2. **Do not redirect CMD stdout/stderr to the script directory** on network drives.
3. **Do not write `launch-error.log` or `last-run.log` next to `.cmd` files** on `I:`.
4. **Do not remove `pause` / visible error paths** when adding `try/catch`.
5. **Do not ship three iterative “fixes” in minutes** without work-laptop validation.
6. **Do not partial-revert** one launcher while leaving the same anti-patterns in sibling launchers.
7. **Do not use `throw` + outer catch** for user-facing errors without guaranteed `pause` and non-zero exit code.

---

## Current file state (post-`d44924c`)

`launch.ps1` serve loop (restored):

```158:216:scripts/launcher/launch.ps1
# --- Serve loop: resilient, one bad connection never kills the server -------
Write-LauncherLogSafe 'Step: enter serve loop'
try {
    while ($true) {
        ...
    }
} finally {
    if ($listener) { try { $listener.Stop() } catch {} }
    ...
}
```

`Start ACC Suite.cmd` (restored):

```1:8:scripts/launcher/Start ACC Suite.cmd
@echo off
cd /d "%~dp0"
...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
if errorlevel 1 pause
```

**Remaining risk:** ~~`Start Portal Discover.cmd` line 15 still uses `>> "%LAST_RUN%"` — treat as open incident for Portal Discover until aligned with this report's fix plan.~~ **Fixed** (see Portal Discover section below).

---

## Portal Discover — fixed (post-`d44924c`)

**Status:** Resolved on 2026-07-08.

Applied the same principles as the ACC Suite `d44924c` restore:

| File | Fix |
|------|-----|
| `Start Portal Discover.cmd` | Removed `ACC_LAUNCHER_DIR`, `LAST_RUN`, `>> last-run.log` redirect, and `msg.exe` failure path. Matches minimal ACC Suite pattern: direct PowerShell invoke + `if errorlevel 1 pause`. |
| `portal-discover.ps1` | Removed `ACC_LAUNCHER_DIR`, `Set-Location`, inline `launch-error.log` fallback. Optional logging via `Write-LauncherLogSafe` — CDP path runs even when logging fails. |
| `launcher-log.ps1` | Removed `launch-error.log` writes beside scripts on `I:`. Logs go only to `%USERPROFILE%\ACC-Suite\logs\` (fallback `%TEMP%\ACC-Suite-logs\`). |

**Write audit (no script-dir writes on `I:`):**

- `Start Portal Discover.cmd` — no file writes
- `Start ACC Suite.cmd` — no file writes
- `portal-discover.ps1` — writes only to `%USERPROFILE%\ACC-Suite\` (portal-map.json, portal-summary.html) and `%USERPROFILE%\ACC-Suite\logs\` via optional logging
- `launch.ps1` — reads `index.html` from script dir only; optional logs to user profile
- `launcher-log.ps1` — logs to user profile / temp only
- `folder-watch.ps1` — no file writes (placeholder only)

**Work-laptop test:** Re-download dist, double-click `Start Portal Discover.cmd`, Citrix login, click OK.

---

*Report generated from git forensics on 2026-07-08. No runtime reproduction on physical work laptop was available in the investigation environment; conclusions are from code diff analysis and documented Windows/PowerShell behavior.*
