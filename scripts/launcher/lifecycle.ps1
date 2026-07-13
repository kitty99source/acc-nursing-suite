param()

# Shared tab-close / companion-process lifecycle helpers for launch.ps1 and
# folder-watch.ps1. Dot-sourced by both.
#
# When the browser tab closes, the SPA POSTs /_acc/goodbye (and heartbeats stop).
# launch.ps1 then exits its listen loop and asks folder-watch to stop via a
# sentinel file under %USERPROFILE%\ACC-Suite\ (plus a best-effort PID kill).

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
        return $text
    } catch {
        return $null
    }
}
