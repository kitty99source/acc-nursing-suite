# ACC Folder Watch - coming soon (work laptop)
#
# This tool watches ~/ACC-Inbox for PDF drops. It is not yet available
# without Node.js on the work laptop.

$script:BootstrapLogPath = Join-Path $env:USERPROFILE 'ACC-Suite\logs\bootstrap.log'
function Write-BootstrapLog {
    param([string]$Message)
    try {
        $logDir = Split-Path -Parent $script:BootstrapLogPath
        if (-not (Test-Path -LiteralPath $logDir)) { [void][System.IO.Directory]::CreateDirectory($logDir) }
        Add-Content -LiteralPath $script:BootstrapLogPath -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" -Encoding UTF8
    } catch {}
}
Write-BootstrapLog 'folder-watch.ps1 started'

try { [void][System.IO.Directory]::CreateDirectory((Join-Path $env:USERPROFILE 'ACC-Suite\logs')) } catch {}

$script:LauncherDir = $env:ACC_LAUNCHER_DIR
if ([string]::IsNullOrWhiteSpace($script:LauncherDir)) { $script:LauncherDir = $PSScriptRoot }
if ([string]::IsNullOrWhiteSpace($script:LauncherDir)) { $script:LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$script:LauncherDir = $script:LauncherDir.TrimEnd('\', '/')
try { Set-Location -LiteralPath $script:LauncherDir -ErrorAction Stop } catch {}

$script:LauncherHadError = $false
$script:LauncherLogPath = $null

try {
    $logHelper = Join-Path $script:LauncherDir 'launcher-log.ps1'
    . $logHelper
    Initialize-LauncherLog -Prefix 'folder-watch' | Out-Null
    Write-LauncherLog 'Step: folder watch is not yet available on work laptops'

    Show-LauncherMessageBox -Title 'ACC Folder Watch' -Icon Information -Message @"
Folder Watch is coming soon for work laptops.

Today it still requires Node.js (dev machine only).
Use the main app with Start ACC Suite.cmd - no extra software needed.

Portal discovery works now: double-click Start Portal Discover.cmd
"@
} catch {
    $script:LauncherHadError = $true
    if (Get-Command Write-LauncherLogException -ErrorAction SilentlyContinue) {
        Write-LauncherLogException $_
    }
} finally {
    if (Get-Command Complete-LauncherLog -ErrorAction SilentlyContinue) {
        Complete-LauncherLog -Title 'ACC Folder Watch'
    }
}

exit 0
