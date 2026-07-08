param()

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'wfh'

$mailboxConfig = Join-Path $bootstrapRoot 'mailbox-config.ps1'
if (Test-Path -LiteralPath $mailboxConfig) {
    . $mailboxConfig
} else {
    Write-Host "WARN - mailbox-config.ps1 not found; using ACCDistrictNursing default."
    Write-BootstrapLog "WARN - missing mailbox-config.ps1 at $mailboxConfig"
    function Resolve-SharedMailbox {
        param([string]$Override = '')
        if (-not [string]::IsNullOrWhiteSpace($Override)) { return $Override.Trim() }
        if (-not [string]::IsNullOrWhiteSpace($env:ACC_SHARED_MAILBOX)) { return $env:ACC_SHARED_MAILBOX.Trim() }
        return 'ACCDistrictNursing'
    }
}

Write-BootstrapLog 'wfh-mode.ps1 started'

$launcherDir = $bootstrapRoot

Write-Host ''
Write-Host 'ACC Work From Home Mode'
Write-Host '======================='
Write-Host ''
Write-Host 'Starting three components:'
Write-Host '  1. ACC Suite app (minimized window - keep running)'
Write-Host '  2. Folder Watch (separate window - keep open)'
Write-Host '  3. Email Sync (this window - runs once per launch)'
Write-Host ''

$launchPs1 = Join-Path $launcherDir 'launch.ps1'
$watchPs1 = Join-Path $launcherDir 'folder-watch.ps1'
$syncPs1 = Join-Path $launcherDir 'outlook-sync.ps1'

function Test-AccSuitePortOpen {
    param([int]$Port = 8765)
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $async.AsyncWaitHandle.WaitOne(500)
        if ($ok -and $client.Connected) { return $true }
    } catch {
    } finally {
        if ($client) { try { $client.Close() } catch {} }
    }
    return $false
}

foreach ($required in @($launchPs1, $watchPs1, $syncPs1)) {
    if (-not (Test-Path -LiteralPath $required)) {
        Write-Host "FAIL - missing launcher script: $required"
        Write-BootstrapLog "FAIL - missing: $required"
        exit 1
    }
}

Write-Host 'Opening ACC Suite (local app server)...'
$accSuitePort = 8765
if (Test-AccSuitePortOpen -Port $accSuitePort) {
    Write-Host "  ACC Suite already running on http://127.0.0.1:$accSuitePort - skipping second launch."
    Write-BootstrapLog "Skipped launch.ps1 - port $accSuitePort already open"
} else {
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $launchPs1
    ) -WindowStyle Minimized | Out-Null
    Write-BootstrapLog 'Started launch.ps1 (minimized)'
    Start-Sleep -Seconds 2
}

Write-Host 'Opening Folder Watch (ACC-Inbox letter drops)...'
Start-Process -FilePath 'cmd.exe' -ArgumentList @(
    '/k',
    "cd /d `"$launcherDir`" && powershell -NoProfile -ExecutionPolicy Bypass -File `"$watchPs1`""
) -WindowStyle Normal | Out-Null
Write-BootstrapLog 'Started folder-watch.ps1 (new cmd window)'
Start-Sleep -Seconds 2

$sharedMailbox = Resolve-SharedMailbox
$statusPath = Join-Path $env:USERPROFILE 'ACC-Suite\email-sync-status.json'

Write-Host ''
Write-Host 'Running Email Sync (Outlook COM, one backlog batch)...'
Write-Host "Using mailbox: $sharedMailbox"
Write-Host 'Keep this window open until sync finishes.'
Write-Host ''
Write-BootstrapLog "Starting outlook-sync.ps1 in this window (mailbox: $sharedMailbox)"

& $syncPs1 -SharedMailbox $sharedMailbox
$syncExit = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }

Write-Host ''
Write-Host 'WFH Mode summary'
Write-Host '----------------'
Write-Host "  ACC Suite     = running (http://127.0.0.1:$accSuitePort or next free port if new launch)"
Write-Host '  Folder Watch  = running (separate cmd window - leave open)'
Write-Host '  Email Sync    = finished this run'
if (Test-Path -LiteralPath $statusPath) {
    Write-Host "  Sync report   = $statusPath"
    Write-Host '  ACC Inbox     = optional audit of saved letters (not required to stage)'
} else {
    Write-Host "  WARN - sync report not found at $statusPath"
}
Write-Host ''
Write-Host '  Next: open Review Queue in the suite — folder-watch sidecars auto-import there.'
Write-Host '  More backlog? Double-click Start Email Sync.cmd again during work hours.'
Write-Host '  Logs: %USERPROFILE%\ACC-Suite\logs\'
Write-Host ''
Write-BootstrapLog "outlook-sync.ps1 finished exit=$syncExit statusExists=$(Test-Path -LiteralPath $statusPath)"

if ($syncExit -ne 0) { exit $syncExit }
exit 0
