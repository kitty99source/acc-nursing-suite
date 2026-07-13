param()

# Shared tab-close / companion-process lifecycle helpers for launch.ps1,
# folder-watch.ps1, and supervisor.ps1. Dot-sourced by those scripts.
#
# When the browser tab closes, the SPA POSTs /_acc/goodbye (and heartbeats stop).
# launch.ps1 then exits its listen loop, writes session-ended, and asks
# folder-watch to stop via a sentinel under %USERPROFILE%\ACC-Suite\
# (plus a best-effort PID kill). supervisor.ps1 watches those signals so it
# can restart crashed helpers mid-session, then exit cleanly on goodbye.

function Get-AccSuiteDir {
    $dir = Join-Path $env:USERPROFILE 'ACC-Suite'
    [void][System.IO.Directory]::CreateDirectory($dir)
    return $dir
}

function Write-AccPidFile {
    param([string]$Name, [int]$ProcessId = $PID)
    $path = Join-Path (Get-AccSuiteDir) $Name
    [System.IO.File]::WriteAllText($path, [string]$ProcessId)
    return $path
}

function Clear-AccPidFile {
    param([string]$Name)
    $path = Join-Path (Get-AccSuiteDir) $Name
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
}

function Test-AccPidFileAlive {
    # True when the named .pid file points at a still-running PowerShell process.
    param([string]$Name)
    $path = Join-Path (Get-AccSuiteDir) $Name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
    $raw = ''
    try { $raw = (Get-Content -LiteralPath $path -Raw -Encoding UTF8).Trim() } catch { return $false }
    $procId = 0
    if (-not [int]::TryParse($raw, [ref]$procId) -or $procId -le 0) { return $false }
    try {
        $proc = Get-Process -Id $procId -ErrorAction Stop
        $name = [string]$proc.ProcessName
        return ($name -eq 'powershell' -or $name -eq 'pwsh' -or $name -eq 'powershell_ise')
    } catch {
        return $false
    }
}

function Write-AccSessionEnded {
    # Intentional last-tab / idle shutdown (not a crash). Supervisor must exit,
    # not restart helpers.
    $path = Join-Path (Get-AccSuiteDir) 'session-ended'
    try {
        [System.IO.File]::WriteAllText($path, [DateTime]::UtcNow.ToString('o'))
    } catch {}
}

function Clear-AccSessionEnded {
    $path = Join-Path (Get-AccSuiteDir) 'session-ended'
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
}

function Test-AccSessionEnded {
    return Test-Path -LiteralPath (Join-Path (Get-AccSuiteDir) 'session-ended') -PathType Leaf
}

function Clear-AccFolderWatchStopSentinel {
    $path = Join-Path (Get-AccSuiteDir) 'stop-folder-watch'
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
}

function Test-AccFolderWatchStopRequested {
    return Test-Path -LiteralPath (Join-Path (Get-AccSuiteDir) 'stop-folder-watch') -PathType Leaf
}

function Request-AccFolderWatchStop {
    # Write a stop sentinel that folder-watch checks each scan tick, then
    # best-effort kill the last-known folder-watch PID (Hidden quiet mode has
    # no window to close by hand).
    $suite = Get-AccSuiteDir
    $sentinel = Join-Path $suite 'stop-folder-watch'
    try {
        [System.IO.File]::WriteAllText($sentinel, [DateTime]::UtcNow.ToString('o'))
    } catch {}

    $pidFile = Join-Path $suite 'folder-watch.pid'
    if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { return }
    $raw = ''
    try { $raw = (Get-Content -LiteralPath $pidFile -Raw -Encoding UTF8).Trim() } catch { return }
    $watchPid = 0
    if (-not [int]::TryParse($raw, [ref]$watchPid) -or $watchPid -le 0) { return }
    if ($watchPid -eq $PID) { return }
    try {
        $proc = Get-Process -Id $watchPid -ErrorAction Stop
        $name = [string]$proc.ProcessName
        if ($name -eq 'powershell' -or $name -eq 'pwsh' -or $name -eq 'powershell_ise') {
            Stop-Process -Id $watchPid -Force -ErrorAction Stop
        }
    } catch {}
    Clear-AccPidFile -Name 'folder-watch.pid'
}

# ---------------------------------------------------------------------------
# On-demand Outlook email sync (ACC Inbox Refresh).
# launch.ps1 POST /_acc/email-sync writes the sentinel; supervisor (or launch
# fallback) starts outlook-sync.ps1. Never run Outlook COM inside the HTTP
# serve loop.
# ---------------------------------------------------------------------------

function Request-AccEmailSync {
    $suite = Get-AccSuiteDir
    $sentinel = Join-Path $suite 'request-email-sync'
    try {
        [System.IO.File]::WriteAllText($sentinel, [DateTime]::UtcNow.ToString('o'))
        return $true
    } catch {
        return $false
    }
}

function Test-AccEmailSyncRequested {
    return Test-Path -LiteralPath (Join-Path (Get-AccSuiteDir) 'request-email-sync') -PathType Leaf
}

function Clear-AccEmailSyncRequest {
    $path = Join-Path (Get-AccSuiteDir) 'request-email-sync'
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
}

function Test-AccSupervisorAlive {
    return Test-AccPidFileAlive -Name 'supervisor.pid'
}

function Get-AccClientIdFromRequest {
    # Accept clientId from query string and/or JSON body so sendBeacon
    # (often empty body + query) and fetch(keepalive) both work.
    param([string]$RequestLine, [byte[]]$BodyBytes)
    $fromQuery = $null
    if ($RequestLine) {
        $parts = $RequestLine.Split(' ')
        if ($parts.Length -ge 2) {
            $raw = $parts[1]
            $q = $raw.IndexOf('?')
            if ($q -ge 0) {
                foreach ($pair in $raw.Substring($q + 1).Split('&')) {
                    $eq = $pair.IndexOf('=')
                    if ($eq -lt 0) { continue }
                    if ($pair.Substring(0, $eq) -ne 'clientId') { continue }
                    $v = $pair.Substring($eq + 1)
                    try { $fromQuery = [System.Uri]::UnescapeDataString($v) } catch { $fromQuery = $v }
                    break
                }
            }
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($fromQuery)) { return $fromQuery.Trim() }
    if ($null -eq $BodyBytes -or $BodyBytes.Length -eq 0) { return $null }
    try {
        $text = [System.Text.Encoding]::UTF8.GetString($BodyBytes).Trim()
        if ([string]::IsNullOrWhiteSpace($text)) { return $null }
        if ($text.StartsWith('{')) {
            $obj = $text | ConvertFrom-Json
            if ($obj -and $obj.clientId) { return ([string]$obj.clientId).Trim() }
        }
        # Plain text body fallback.
        return $text
    } catch {
        return $null
    }
}
