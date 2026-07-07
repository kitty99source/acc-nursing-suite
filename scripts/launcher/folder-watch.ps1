# ACC Folder Watch — coming soon (work laptop)
#
# This tool watches ~/ACC-Inbox for PDF drops. It is not yet available
# without Node.js on the work laptop.

$script:LauncherHadError = $false
$script:LauncherLogPath = $null

try {
    $logHelper = Join-Path $PSScriptRoot 'launcher-log.ps1'
    if (-not (Test-Path -LiteralPath $logHelper)) {
        $logHelper = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'launcher-log.ps1'
    }
    . $logHelper
    Initialize-LauncherLog -Prefix 'folder-watch' | Out-Null
    Write-LauncherLog 'Step: folder watch is not yet available on work laptops'

    Show-LauncherMessageBox -Title 'ACC Folder Watch' -Icon Information -Message @"
Folder Watch is coming soon for work laptops.

Today it still requires Node.js (dev machine only).
Use the main app with Start ACC Suite.cmd — no extra software needed.

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
