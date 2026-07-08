param()

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }

. (Join-Path $bootstrapRoot 'inbox-config.ps1')

$inbox = Resolve-InboxPath -ScriptRoot $bootstrapRoot
Initialize-InboxDirs -Inbox $inbox

Write-Host ''
Write-Host '  ACC-Inbox folder' -ForegroundColor Cyan
Write-Host '  ----------------' -ForegroundColor Cyan
Write-Host ''
Write-Host "  Path: $inbox" -ForegroundColor Green
Write-Host '  Drop PDF or Word (.docx) letters here while Folder Watch is running.' -ForegroundColor Gray
Write-Host '  Override path: office-config accInbox.inboxPath or env ACC_INBOX_PATH' -ForegroundColor Gray
Write-Host ''

Start-Process -FilePath 'explorer.exe' -ArgumentList $inbox | Out-Null
