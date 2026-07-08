param(
    [string]$SharedMailbox = '',
    [int]$MaxMessages = 50,
    [int]$DaysBack = 14
)

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'email-sync'
Write-BootstrapLog 'outlook-sync.ps1 started'

# ACC Outlook COM sync - work laptop only
#
# Reads filtered inbox from open Outlook session.
# Saves PDF/DOCX attachments to %USERPROFILE%\ACC-Inbox for folder watch + HRQ.
# Writes email-sync-status.json for ACC Inbox UI.
# Does NOT delete, move, or send mail.

$DefaultSenders = @(
    'Bec.Williams@acc.co.nz',
    'John.Bentley@acc.co.nz',
    'Becky.Tunnell@acc.co.nz',
    'nursing@acc.co.nz',
    'acc.co.nz'
)

$DefaultSubjectPatterns = @(
    'approv',
    'declin',
    'nur0[245]',
    'purchase order',
    'PO\s*number',
    'ACC\s+letter'
)

$SupportedExt = @('.pdf', '.docx')

function Write-SyncLine {
    param([string]$Message)
    Write-Host $Message
    Write-BootstrapLog $Message
}

function Get-TruncatedSubject {
    param([string]$Subject, [int]$MaxLen = 60)
    if ([string]::IsNullOrWhiteSpace($Subject)) { return '(empty subject)' }
    $oneLine = ($Subject -replace '\s+', ' ').Trim()
    if ($oneLine.Length -le $MaxLen) { return $oneLine }
    return $oneLine.Substring(0, $MaxLen) + '...'
}

function Resolve-AccSuiteDir {
    return Join-Path $env:USERPROFILE 'ACC-Suite'
}

function Resolve-InboxDir {
    if (-not [string]::IsNullOrWhiteSpace($env:ACC_INBOX)) {
        return [System.IO.Path]::GetFullPath($env:ACC_INBOX)
    }
    return Join-Path $env:USERPROFILE 'ACC-Inbox'
}

function Initialize-InboxDirs {
    param([string]$Inbox)
    [void][System.IO.Directory]::CreateDirectory($Inbox)
    [void][System.IO.Directory]::CreateDirectory((Join-Path $Inbox 'processed'))
    [void][System.IO.Directory]::CreateDirectory((Join-Path $Inbox '.staging'))
    [void][System.IO.Directory]::CreateDirectory((Join-Path $Inbox '.email-sync'))
}

function Get-OfficeConfigPath {
    $suite = Resolve-AccSuiteDir
    $paths = @(
        (Join-Path $suite 'office-config.json'),
        (Join-Path $PSScriptRoot 'office-config.example.json')
    )
    foreach ($p in $paths) {
        if (Test-Path -LiteralPath $p) { return $p }
    }
    return $null
}

function Load-FilterConfig {
    $senders = @($DefaultSenders)
    $patterns = @($DefaultSubjectPatterns)
    $configPath = Get-OfficeConfigPath
    if ($configPath) {
        try {
            $raw = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
            $cfg = $raw | ConvertFrom-Json
            if ($cfg.accInbox -and $cfg.accInbox.senderAllowlist) {
                $senders = @($cfg.accInbox.senderAllowlist)
            }
            if ($cfg.accInbox -and $cfg.accInbox.subjectPatterns) {
                $patterns = @($cfg.accInbox.subjectPatterns)
            }
            if ($cfg.settings -and $cfg.settings.accInboxSenderAllowlist) {
                $senders = @($cfg.settings.accInboxSenderAllowlist)
            }
            if ($cfg.settings -and $cfg.settings.accInboxSubjectPatterns) {
                $patterns = @($cfg.settings.accInboxSubjectPatterns)
            }
        } catch {
            Write-SyncLine "WARN - could not parse office config: $($_.Exception.Message)"
        }
    }
    return @{
        Senders  = $senders
        Patterns = $patterns
    }
}

function Test-AccSender {
    param(
        [string]$FromAddress,
        [string[]]$Allowlist
    )
    if ([string]::IsNullOrWhiteSpace($FromAddress)) { return $false }
    $lower = $FromAddress.ToLowerInvariant()
    foreach ($entry in $Allowlist) {
        if ([string]::IsNullOrWhiteSpace($entry)) { continue }
        if ($lower.Contains($entry.ToLowerInvariant())) { return $true }
    }
    return $false
}

function Test-AccSubject {
    param(
        [string]$Subject,
        [string[]]$Patterns
    )
    if ([string]::IsNullOrWhiteSpace($Subject)) { return $false }
    foreach ($pat in $Patterns) {
        if ([string]::IsNullOrWhiteSpace($pat)) { continue }
        if ($Subject -match $pat) { return $true }
    }
    return $false
}

function Get-InboxFolder {
    param(
        [object]$Namespace,
        [string]$SharedName
    )
    if (-not [string]::IsNullOrWhiteSpace($SharedName)) {
        $recipient = $Namespace.CreateRecipient($SharedName)
        if (-not $recipient.Resolve()) {
            throw "Shared mailbox not found: $SharedName"
        }
        return $Namespace.GetSharedDefaultFolder($recipient, 6)
    }
    return $Namespace.GetDefaultFolder(6)
}

function Get-SafeFileName {
    param([string]$Name)
    $base = [System.IO.Path]::GetFileName($Name)
    if ([string]::IsNullOrWhiteSpace($base)) { $base = 'attachment' }
    $invalid = [System.IO.Path]::GetInvalidFileNameChars() -join ''
    $safe = [regex]::Replace($base, "[$([regex]::Escape($invalid))]", '_')
    return $safe
}

function Get-UniquePath {
    param(
        [string]$Dir,
        [string]$FileName
    )
    $candidate = Join-Path $Dir $FileName
    if (-not (Test-Path -LiteralPath $candidate)) { return $candidate }
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $ext = [System.IO.Path]::GetExtension($FileName)
    $n = 1
    while ($true) {
        $alt = Join-Path $Dir ("{0}-{1}{2}" -f $stem, $n, $ext)
        if (-not (Test-Path -LiteralPath $alt)) { return $alt }
        $n++
        if ($n -gt 999) { throw "Too many duplicate files for $FileName" }
    }
}

function Test-AlreadySynced {
    param(
        [string]$MarkerDir,
        [string]$EntryId
    )
    $marker = Join-Path $MarkerDir ($EntryId + '.done')
    return Test-Path -LiteralPath $marker
}

function Mark-Synced {
    param(
        [string]$MarkerDir,
        [string]$EntryId
    )
    $marker = Join-Path $MarkerDir ($EntryId + '.done')
    Set-Content -LiteralPath $marker -Value (Get-Date).ToUniversalTime().ToString('o') -Encoding ASCII
}

function Write-SyncStatus {
    param(
        [hashtable]$Status
    )
    $suite = Resolve-AccSuiteDir
    [void][System.IO.Directory]::CreateDirectory($suite)
    $path = Join-Path $suite 'email-sync-status.json'
    $json = $Status | ConvertTo-Json -Depth 6
    Set-Content -LiteralPath $path -Value $json -Encoding UTF8
    return $path
}

$status = @{
    version       = 1
    lastRunAt     = (Get-Date).ToUniversalTime().ToString('o')
    outcome       = 'running'
    savedCount    = 0
    skippedCount  = 0
    errorCount    = 0
    savedFiles    = @()
    errors        = @()
    inboxPath     = ''
    sharedMailbox = ''
}

Write-SyncLine ''
Write-SyncLine 'ACC Outlook COM email sync'
Write-SyncLine '=========================='
Write-SyncLine ''

if (-not [string]::IsNullOrWhiteSpace($env:ACC_SHARED_MAILBOX)) {
    $SharedMailbox = $env:ACC_SHARED_MAILBOX
}

if ($env:ACC_AUTOMATION_PAUSED -eq '1') {
    Write-SyncLine 'Automation paused (ACC_AUTOMATION_PAUSED=1). Exiting.'
    $status.outcome = 'paused'
    $null = Write-SyncStatus -Status $status
    exit 0
}

$inbox = Resolve-InboxDir
$status.inboxPath = $inbox
$status.sharedMailbox = $SharedMailbox
Initialize-InboxDirs -Inbox $inbox

$pauseFile = Join-Path $inbox '.automation-paused'
if (Test-Path -LiteralPath $pauseFile) {
    Write-SyncLine 'Automation paused (.automation-paused in ACC-Inbox). Exiting.'
    $status.outcome = 'paused'
    $null = Write-SyncStatus -Status $status
    exit 0
}

$filters = Load-FilterConfig
$markerDir = Join-Path $inbox '.email-sync'
[void][System.IO.Directory]::CreateDirectory($markerDir)

$cutoff = (Get-Date).AddDays(-1 * [Math]::Max(1, $DaysBack))
$outlook = $null

try {
    Write-SyncLine 'Connecting to Outlook.Application COM object...'
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace('MAPI')
    [void]$namespace.Logon($null, $null, $false, $true)

    $folder = Get-InboxFolder -Namespace $namespace -SharedName $SharedMailbox
    $label = if ([string]::IsNullOrWhiteSpace($SharedMailbox)) { 'Default inbox' } else { "Shared inbox: $SharedMailbox" }
    Write-SyncLine "OK - COM connected ($label)"
    Write-SyncLine "Saving attachments to: $inbox"
    Write-SyncLine ''

    $items = $folder.Items
    $items.Sort('[ReceivedTime]', $true)

    $scanned = 0
    foreach ($item in $items) {
        if ($scanned -ge $MaxMessages) { break }
        try {
            if ($item.Class -ne 43) { continue }
            $received = $null
            try { $received = [datetime]$item.ReceivedTime } catch {}
            if ($received -and $received -lt $cutoff) { continue }

            $from = ''
            try { $from = [string]$item.SenderEmailAddress } catch {}
            $subject = ''
            try { $subject = [string]$item.Subject } catch {}

            if (-not (Test-AccSender -FromAddress $from -Allowlist $filters.Senders)) { continue }
            if (-not (Test-AccSubject -Subject $subject -Patterns $filters.Patterns)) { continue }

            $entryId = ''
            try { $entryId = [string]$item.EntryID } catch {}
            if ([string]::IsNullOrWhiteSpace($entryId)) {
                $entryId = [string]::Concat($from, '|', $subject, '|', $received)
            }

            if (Test-AlreadySynced -MarkerDir $markerDir -EntryId $entryId) {
                $status.skippedCount++
                continue
            }

            $attachments = $item.Attachments
            $savedAny = $false
            for ($i = 1; $i -le $attachments.Count; $i++) {
                $att = $null
                try {
                    $att = $attachments.Item($i)
                    $fileName = Get-SafeFileName -Name ([string]$att.FileName)
                    $ext = [System.IO.Path]::GetExtension($fileName).ToLowerInvariant()
                    if ($SupportedExt -notcontains $ext) { continue }

                    $dest = Get-UniquePath -Dir $inbox -FileName $fileName
                    $att.SaveAsFile($dest)
                    $savedAny = $true
                    $status.savedCount++
                    $status.savedFiles += @{
                        fileName = [System.IO.Path]::GetFileName($dest)
                        subject  = $subject
                        sender   = $from
                        savedAt  = (Get-Date).ToUniversalTime().ToString('o')
                    }
                    Write-SyncLine ("  saved: {0} <- {1}" -f ([System.IO.Path]::GetFileName($dest)), (Get-TruncatedSubject $subject))
                } finally {
                    if ($att) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($att) }
                }
            }

            if ($savedAny) {
                Mark-Synced -MarkerDir $markerDir -EntryId $entryId
            } else {
                $status.skippedCount++
            }
        } catch {
            $status.errorCount++
            $status.errors += $_.Exception.Message
            Write-SyncLine ("  ERROR: $($_.Exception.Message)")
        } finally {
            if ($item) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($item) }
            $scanned++
        }
    }

    $status.outcome = 'ok'
    Write-SyncLine ''
    Write-SyncLine ("Done - saved {0} attachment(s), skipped {1}, errors {2}" -f $status.savedCount, $status.skippedCount, $status.errorCount)
    Write-SyncLine 'Next: Start Folder Watch.cmd picks up new files -> Review Queue.'
}
catch {
    $status.outcome = 'fail'
    $status.errorCount++
    $status.errors += $_.Exception.Message
    Write-SyncLine ''
    Write-SyncLine ("FAIL - $($_.Exception.Message)")
    Write-SyncLine ''
    Write-SyncLine 'Fallback: manual Outlook rule -> copy ACC letters to ACC-Inbox'
    Write-SyncLine '          then use Start Folder Watch.cmd (no COM needed).'
}
finally {
    if ($outlook) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook)
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
    $statusPath = Write-SyncStatus -Status $status
    Write-SyncLine ''
    Write-SyncLine "Status: $statusPath"
    Write-SyncLine "Log: $env:USERPROFILE\ACC-Suite\logs\email-sync-bootstrap.log"
    Write-SyncLine ''
}

if ($status.outcome -eq 'fail') { exit 1 }
