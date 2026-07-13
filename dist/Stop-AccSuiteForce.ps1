param()

# Force-stop ALL helpers for ACC District Nursing Admin Suite only.
# Safe for coworkers: kills this suite's supervisor / app / folder-watch /
# email-sync, clears stale PID + sentinel files under %USERPROFILE%\ACC-Suite\
# so the folder can be deleted, and frees port 8765.
#
# Does NOT touch Loan Equipment (ACC-LoanEq-Suite / 8865) or Remittance
# (ACC-Remittance-Suite / 8905).

$ErrorActionPreference = 'SilentlyContinue'
$suiteName = 'ACC-Suite'
$suiteDir = Join-Path $env:USERPROFILE $suiteName
$appPort = 8765
$launcherDir = $PSScriptRoot

Write-Host ''
Write-Host 'ACC District Nursing Admin Suite - Force Stop'
Write-Host '============================================='
Write-Host "Suite folder: $suiteDir"
Write-Host "App port:     $appPort"
Write-Host ''

function Stop-PidFromFile {
    param([string]$Name)
    $path = Join-Path $suiteDir $Name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return }
    $raw = ''
    try { $raw = (Get-Content -LiteralPath $path -Raw -Encoding UTF8).Trim() } catch { return }
    $procId = 0
    if (-not [int]::TryParse($raw, [ref]$procId) -or $procId -le 0) { return }
    try {
        $proc = Get-Process -Id $procId -ErrorAction Stop
        Write-Host ("  Stopping {0} (PID {1}, {2})" -f $Name, $procId, $proc.ProcessName)
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host ("  {0} PID {1} already gone" -f $Name, $procId)
    }
}

function Stop-ListenersOnPort {
    param([int]$Port)
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            $opid = [int]$c.OwningProcess
            if ($opid -le 0) { continue }
            Write-Host ("  Stopping listener on port {0} (PID {1})" -f $Port, $opid)
            Stop-Process -Id $opid -Force -ErrorAction SilentlyContinue
        }
    } catch {
        # Get-NetTCPConnection may be unavailable on older Windows - fall through.
    }
}

function Stop-PowershellMatchingLauncher {
    # Best-effort: PowerShell hosts whose command line points at THIS suite's
    # launcher scripts (not Loan Eq / Remittance).
    $markers = @(
        [regex]::Escape($launcherDir),
        'ACC-Suite\\email-sync',
        'ACC-Suite\\logs\\email-sync',
        'ACC-Suite\\logs\\supervisor',
        'ACC-Suite\\logs\\folder-watch',
        'ACC-Suite\\logs\\acc-bootstrap'
    )
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue
        foreach ($p in $procs) {
            $cmd = [string]$p.CommandLine
            if ([string]::IsNullOrWhiteSpace($cmd)) { continue }
            $hit = $false
            foreach ($m in $markers) {
                if ($cmd -match $m) { $hit = $true; break }
            }
            # Also match supervisor/launch/folder-watch/outlook-sync when invoked
            # from a copy of this dist folder (path contains District Nursing cues).
            if (-not $hit) {
                if ($cmd -match 'supervisor\.ps1' -and $cmd -match 'ACC-Suite') { $hit = $true }
                if ($cmd -match 'outlook-sync\.ps1' -and $cmd -match 'ACC-Suite') { $hit = $true }
                if ($cmd -match 'folder-watch\.ps1' -and $cmd -match 'ACC-Suite') { $hit = $true }
                if ($cmd -match 'launch\.ps1' -and $cmd -match 'ACC-Suite') { $hit = $true }
            }
            if (-not $hit) { continue }
            if ([int]$p.ProcessId -eq $PID) { continue }
            Write-Host ("  Stopping matching PowerShell PID {0}" -f $p.ProcessId)
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

Write-Host 'Stopping known helper PIDs...'
foreach ($name in @('supervisor.pid', 'launch.pid', 'folder-watch.pid', 'email-sync.pid')) {
    Stop-PidFromFile -Name $name
}

Write-Host 'Stopping anything still listening on the app port...'
Stop-ListenersOnPort -Port $appPort

Write-Host 'Stopping leftover PowerShell helpers for this suite...'
Stop-PowershellMatchingLauncher

Write-Host 'Clearing PID and sentinel files...'
if (Test-Path -LiteralPath $suiteDir -PathType Container) {
    $staleNames = @(
        'supervisor.pid', 'launch.pid', 'folder-watch.pid', 'email-sync.pid',
        'session-ended', 'stop-folder-watch', 'request-email-sync'
    )
    foreach ($n in $staleNames) {
        $p = Join-Path $suiteDir $n
        if (Test-Path -LiteralPath $p -PathType Leaf) {
            Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
            Write-Host ("  Removed {0}" -f $n)
        }
    }
} else {
    Write-Host "  (no $suiteName folder yet - nothing to clear)"
}

Write-Host ''
Write-Host 'Done. You can delete the suite folder now if you need to.'
Write-Host 'To start again: use Start ACC Suite (quiet).vbs'
Write-Host ''
