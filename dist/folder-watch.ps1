# ACC Folder Watch — coming soon (work laptop)
#
# This tool watches ~/ACC-Inbox for PDF drops. It is not yet available
# without Node.js on the work laptop.

$title = 'ACC Folder Watch'

try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    [System.Windows.Forms.MessageBox]::Show(
        @"
Folder Watch is coming soon for work laptops.

Today it still requires Node.js (dev machine only).
Use the main app with Start ACC Suite.cmd — no extra software needed.

Portal discovery works now: double-click Start Portal Discover.cmd
"@,
        $title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
} catch {
    Write-Host ''
    Write-Host '  ACC Folder Watch — coming soon' -ForegroundColor Cyan
    Write-Host '  Folder watch still needs Node.js (dev machine only).' -ForegroundColor Yellow
    Write-Host '  Portal discovery works now: Start Portal Discover.cmd' -ForegroundColor Green
    Write-Host ''
    Read-Host 'Press Enter to close'
}

exit 0
