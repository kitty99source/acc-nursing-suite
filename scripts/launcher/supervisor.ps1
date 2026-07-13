param(
    [switch]$Quiet,
    [switch]$SkipEmailSync
)

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'supervisor'
. (Join-Path $bootstrapRoot 'lifecycle.ps1')

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

Write-BootstrapLog "supervisor.ps1 started Quiet=$($Quiet.IsPresent) SkipEmailSync=$($SkipEmailSync.IsPresent)"

# Hidden session supervisor for ACC District Nursing Admin Suite.
# Quiet .vbs and recommended/WFH entry points start THIS script, which:
#   1. Starts/ensures launch.ps1 (app + /_acc bridge)
#   2. Starts/ensures folder-watch.ps1
#   3. Optionally runs one Outlook sync at session start (never mid-session)
#   4. Monitors PIDs; silently restarts launch/folder-watch if they die while
#      the session is active (before session-ended)
#   5. On last-tab goodbye / idle timeout (session-ended), stops children and exits
#
# Email Sync is one-shot COM - do NOT re-run Outlook on helper restarts.

$launcherDir = $bootstrapRoot
$launchPs1 = Join-Path $launcherDir 'launch.ps1'
$watchPs1  = Join-Path $launcherDir 'folder-watch.ps1'
$syncPs1   = Join-Path $launcherDir 'outlook-sync.ps1'
$appPort   = 8765
$pollSeconds = 3

function Write-SupervisorHost {
    param([string]$Message = '')
    if (-not $Quiet) { Write-Host $Message }
}

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

function Start-AccLaunchProcess {
    param([switch]$NoBrowser)
    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launchPs1)
    if ($NoBrowser) { $args += '-NoBrowser' }
    $style = if ($Quiet) { 'Hidden' } else { 'Minimized' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WindowStyle $style | Out-Null
    Write-BootstrapLog "Started launch.ps1 (WindowStyle=$style NoBrowser=$($NoBrowser.IsPresent))"
    Start-Sleep -Seconds 2
}

function Start-AccFolderWatchProcess {
    Clear-AccFolderWatchStopSentinel
    if ($Quiet) {
        Start-Process -FilePath 'powershell.exe' -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $watchPs1
        ) -WindowStyle Hidden | Out-Null
        Write-BootstrapLog 'Started folder-watch.ps1 (WindowStyle=Hidden)'
    } else {
        Start-Process -FilePath 'cmd.exe' -ArgumentList @(
            '/k', "cd /d `"$launcherDir`" && powershell -NoProfile -ExecutionPolicy Bypass -File `"$watchPs1`""
        ) -WindowStyle Normal | Out-Null
        Write-BootstrapLog 'Started folder-watch.ps1 (WindowStyle=Normal, cmd /k)'
    }
    Start-Sleep -Seconds 2
}

function Ensure-AccAppServer {
    param([switch]$Recovery)
    if (Test-AccSuitePortOpen -Port $appPort) {
        if (-not $Recovery) {
            Write-SupervisorHost "  ACC Suite already running on http://127.0.0.1:$appPort - opening browser."
            Write-BootstrapLog "Port $appPort already open - opening browser only"
            try { Start-Process "http://127.0.0.1:$appPort/" | Out-Null } catch {}
        } else {
            Write-BootstrapLog "Recovery: port $appPort already open - no relaunch needed"
        }
        return
    }
    if ($Recovery) {
        Write-BootstrapLog 'launch.ps1 / port down mid-session - restarting silently'
        Start-AccLaunchProcess -NoBrowser
    } else {
        Start-AccLaunchProcess
    }
}

function Ensure-AccFolderWatch {
    param([switch]$Recovery)
    if (Test-AccPidFileAlive -Name 'folder-watch.pid') {
        if ($Recovery) {
            Write-BootstrapLog 'Recovery: folder-watch.pid still alive - skip'
        }
        return
    }
    if ($Recovery) {
        Write-BootstrapLog 'folder-watch died mid-session - restarting silently'
    }
    Start-AccFolderWatchProcess
}

Write-SupervisorHost ''
Write-SupervisorHost 'ACC Suite - Session Supervisor'
Write-SupervisorHost '=============================='
Write-SupervisorHost ''
Write-SupervisorHost 'Keeping helpers alive for this session:'
Write-SupervisorHost '  1. App server + /_acc bridge'
Write-SupervisorHost '  2. Folder Watch'
if (-not $SkipEmailSync) {
    Write-SupervisorHost '  3. One Outlook email-sync at start (not restarted later)'
}
Write-SupervisorHost ''
Write-SupervisorHost 'Closing the last app browser tab ends the session.'
Write-SupervisorHost ''

foreach ($required in @($launchPs1, $watchPs1, $syncPs1)) {
    if (-not (Test-Path -LiteralPath $required)) {
        Write-Host "FAIL - missing launcher script: $required"
        Write-BootstrapLog "FAIL - missing: $required"
        exit 1
    }
}

Clear-AccSessionEnded
Write-AccPidFile -Name 'supervisor.pid' | Out-Null
Write-BootstrapLog "Wrote supervisor.pid ($PID)"

try {
    Write-SupervisorHost 'Starting app server...'
    Ensure-AccAppServer

    Write-SupervisorHost 'Starting Folder Watch...'
    Ensure-AccFolderWatch

    if (-not $SkipEmailSync) {
        $sharedMailbox = Resolve-SharedMailbox
        $statusPath = Join-Path $env:USERPROFILE 'ACC-Suite\email-sync-status.json'
        Write-SupervisorHost ''
        Write-SupervisorHost "Running one Email Sync (Outlook COM, mailbox: $sharedMailbox)..."
        Write-BootstrapLog "Starting outlook-sync.ps1 once at session start (mailbox: $sharedMailbox)"
        & $syncPs1 -SharedMailbox $sharedMailbox
        $syncExit = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
        Write-BootstrapLog "outlook-sync.ps1 finished exit=$syncExit statusExists=$(Test-Path -LiteralPath $statusPath)"
        if ($syncExit -ne 0) {
            Write-SupervisorHost "  Email Sync exited $syncExit (helpers stay up; re-run Start Email Sync.cmd later if needed)."
        } else {
            Write-SupervisorHost '  Email Sync finished.'
        }
        Write-SupervisorHost ''
    }

    Write-SupervisorHost 'Supervisor watching helpers (silent restart if they die)...'
    Write-BootstrapLog 'Entering monitor loop'

    while ($true) {
        if (Test-AccSessionEnded) {
            Write-BootstrapLog 'session-ended seen - stopping supervisor'
            Write-SupervisorHost 'Session ended (last tab closed) - supervisor exiting.'
            break
        }

        $launchAlive = Test-AccPidFileAlive -Name 'launch.pid'
        $portOpen = Test-AccSuitePortOpen -Port $appPort
        if (-not $launchAlive -and -not $portOpen) {
            if (Test-AccSessionEnded) { break }
            Ensure-AccAppServer -Recovery
            Ensure-AccFolderWatch -Recovery
        } elseif (-not (Test-AccPidFileAlive -Name 'folder-watch.pid')) {
            if (Test-AccSessionEnded) { break }
            Ensure-AccFolderWatch -Recovery
        }

        Start-Sleep -Seconds $pollSeconds
    }
} finally {
    Write-BootstrapLog 'Supervisor cleanup'
    if (-not (Test-AccSessionEnded)) {
        try { Request-AccFolderWatchStop } catch {}
        if (Test-AccPidFileAlive -Name 'launch.pid') {
            $path = Join-Path (Get-AccSuiteDir) 'launch.pid'
            $raw = ''
            try { $raw = (Get-Content -LiteralPath $path -Raw -Encoding UTF8).Trim() } catch {}
            $launchPid = 0
            if ([int]::TryParse($raw, [ref]$launchPid) -and $launchPid -gt 0 -and $launchPid -ne $PID) {
                try { Stop-Process -Id $launchPid -Force -ErrorAction SilentlyContinue } catch {}
            }
        }
        Write-AccSessionEnded
    }
    Clear-AccPidFile -Name 'supervisor.pid'
    Write-BootstrapLog 'supervisor.ps1 exiting'
}

exit 0
