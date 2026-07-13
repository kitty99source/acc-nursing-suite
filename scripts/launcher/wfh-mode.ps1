param(
    [switch]$Quiet
)

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

Write-BootstrapLog "wfh-mode.ps1 started Quiet=$($Quiet.IsPresent)"

# ACC District Nursing Admin Suite - Work From Home Mode orchestrator.
# One double-click starts everything: the local app server (+ /_acc bridge), the
# folder watch, then one Outlook email-sync run.
# -Quiet: no visible consoles - suppress Write-Host chatter; start launch.ps1 and
# folder-watch with -WindowStyle Hidden (direct powershell, not cmd /k); run
# outlook-sync in this same process (hidden when the parent is the quiet .vbs).
# Pin the quiet .vbs Desktop shortcut for true zero-flash entry (not the .cmd).

$launcherDir = $bootstrapRoot

function Write-WfhHost {
    param([string]$Message = '')
    if (-not $Quiet) { Write-Host $Message }
}

Write-WfhHost ''
Write-WfhHost 'ACC Work From Home Mode'
Write-WfhHost '======================='
Write-WfhHost ''
Write-WfhHost 'Starting three components:'
Write-WfhHost '  1. ACC Suite app (minimized window - keep running)'
Write-WfhHost '  2. Folder Watch (separate window - keep open)'
Write-WfhHost '  3. Email Sync (this window - runs once per launch)'
Write-WfhHost ''

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

Write-WfhHost 'Opening ACC Suite (local app server)...'
$accSuitePort = 8765
function Start-AccAppServer {
    $appStyle = if ($Quiet) { 'Hidden' } else { 'Minimized' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $launchPs1
    ) -WindowStyle $appStyle | Out-Null
    Write-BootstrapLog "Started launch.ps1 (WindowStyle=$appStyle)"
    Start-Sleep -Seconds 2
}

if (Test-AccSuitePortOpen -Port $accSuitePort) {
    Write-WfhHost "  ACC Suite already running on http://127.0.0.1:$accSuitePort - skipping second launch."
    Write-BootstrapLog "Skipped launch.ps1 - port $accSuitePort already open"
} else {
    Start-AccAppServer
}

Write-WfhHost 'Opening Folder Watch (ACC-Inbox letter drops)...'
if ($Quiet) {
    # Hidden PowerShell directly - no cmd.exe (minimized cmd still shows on the taskbar).
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $watchPs1
    ) -WindowStyle Hidden | Out-Null
    Write-BootstrapLog 'Started folder-watch.ps1 (WindowStyle=Hidden, direct powershell)'
} else {
    Start-Process -FilePath 'cmd.exe' -ArgumentList @(
        '/k',
        "cd /d `"$launcherDir`" && powershell -NoProfile -ExecutionPolicy Bypass -File `"$watchPs1`""
    ) -WindowStyle Normal | Out-Null
    Write-BootstrapLog 'Started folder-watch.ps1 (new cmd window)'
}
Start-Sleep -Seconds 2

$sharedMailbox = Resolve-SharedMailbox
$statusPath = Join-Path $env:USERPROFILE 'ACC-Suite\email-sync-status.json'

Write-WfhHost ''
Write-WfhHost 'Running Email Sync (Outlook COM, one backlog batch)...'
Write-WfhHost "Using mailbox: $sharedMailbox"
Write-WfhHost 'Keep this window open until sync finishes.'
Write-WfhHost ''
Write-BootstrapLog "Starting outlook-sync.ps1 in this window (mailbox: $sharedMailbox)"

& $syncPs1 -SharedMailbox $sharedMailbox
$syncExit = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }

Write-WfhHost ''
Write-WfhHost 'WFH Mode summary'
Write-WfhHost '----------------'
Write-WfhHost "  ACC Suite     = running (http://127.0.0.1:$accSuitePort or next free port if new launch)"
Write-WfhHost '  Folder Watch  = running (separate process - leave open, or close the app tab in quiet mode)'
Write-WfhHost '  Email Sync    = finished this run'
if (Test-Path -LiteralPath $statusPath) {
    Write-WfhHost "  Sync report   = $statusPath"
    Write-WfhHost '  ACC Inbox     = optional audit of saved letters (not required to stage)'
} else {
    Write-WfhHost "  WARN - sync report not found at $statusPath"
}
Write-WfhHost ''
Write-WfhHost '  Next: open Review Queue in the suite - folder-watch sidecars auto-import there.'
Write-WfhHost '  More backlog? Double-click Start Email Sync.cmd again during work hours.'
Write-WfhHost '  Logs: %USERPROFILE%\ACC-Suite\logs\'
Write-WfhHost ''
Write-BootstrapLog "outlook-sync.ps1 finished exit=$syncExit statusExists=$(Test-Path -LiteralPath $statusPath)"

if ($syncExit -ne 0) { exit $syncExit }
exit 0
