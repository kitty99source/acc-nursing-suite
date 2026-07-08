param(
    [string]$SharedMailbox = '',
    [int]$BatchSize = 0,
    [switch]$Recent,
    [int]$DaysBack = 14,
    [switch]$IgnoreWorkHours
)

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'email-sync'
. (Join-Path $bootstrapRoot 'mailbox-config.ps1')
Write-BootstrapLog 'outlook-sync.ps1 started'

# ACC Outlook COM sync - work laptop only
#
# Reads filtered inbox from open Outlook session.
# Saves PDF/DOCX attachments to %USERPROFILE%\ACC-Inbox for folder watch + HRQ.
# Default mode: incremental backlog (oldest unactioned ACC letters first, batched per run).
# Writes email-sync-status.json for ACC Inbox UI and email-sync-state.json for checkpoint resume.
# Does NOT delete, move, send mail, or auto-import into the app.

$DefaultSenders = @(
    'Bec.Williams@acc.co.nz',
    'John.Bentley@acc.co.nz',
    'Becky.Tunnell@acc.co.nz',
    'nursing@acc.co.nz',
    'acc.co.nz'
)

$DefaultSubjectPatterns = @(
    'Claim:',
    'ACCID:',
    'approv',
    'declin',
    'nur0[245]',
    'purchase order',
    'PO\s*number',
    'ACC\s+letter'
)

$DefaultSkipCategories = @('actioned')
$DefaultWorkStartHour = 7
$DefaultWorkEndHour = 18
$DefaultBatchSize = 50
$SupportedExt = @('.pdf', '.docx')
$StateVersion = 1
$StatusVersion = 1
$MaxProcessedIds = 20000

$script:ShutdownRequested = $false
$script:SyncState = $null
$script:StatePath = $null

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

function Get-ConfigInt {
    param(
        [string]$EnvName,
        [object]$JsonValue,
        [int]$Default
    )
    $envVal = (Get-Item -Path "Env:$EnvName" -ErrorAction SilentlyContinue).Value
    if ($envVal -match '^\d+$') { return [int]$envVal }
    if ($null -ne $JsonValue -and "$JsonValue" -match '^\d+$') { return [int]$JsonValue }
    return $Default
}

function Load-SyncConfig {
    $senders = @($DefaultSenders)
    $patterns = @($DefaultSubjectPatterns)
    $skipCategories = @($DefaultSkipCategories)
    $workStart = $DefaultWorkStartHour
    $workEnd = $DefaultWorkEndHour
    $batch = $DefaultBatchSize

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
            if ($cfg.emailSync) {
                if ($cfg.emailSync.skipCategories) { $skipCategories = @($cfg.emailSync.skipCategories) }
                $workStart = Get-ConfigInt -EnvName 'ACC_EMAIL_SYNC_WORK_START' -JsonValue $cfg.emailSync.workStartHour -Default $workStart
                $workEnd = Get-ConfigInt -EnvName 'ACC_EMAIL_SYNC_WORK_END' -JsonValue $cfg.emailSync.workEndHour -Default $workEnd
                $batch = Get-ConfigInt -EnvName 'ACC_EMAIL_SYNC_BATCH_SIZE' -JsonValue $cfg.emailSync.batchSize -Default $batch
            }
        } catch {
            Write-SyncLine "WARN - could not parse office config: $($_.Exception.Message)"
        }
    }

    if ($BatchSize -gt 0) { $batch = $BatchSize }
    else {
        $batch = Get-ConfigInt -EnvName 'ACC_EMAIL_SYNC_BATCH_SIZE' -JsonValue $batch -Default $batch
    }
    $workStart = Get-ConfigInt -EnvName 'ACC_EMAIL_SYNC_WORK_START' -JsonValue $workStart -Default $workStart
    $workEnd = Get-ConfigInt -EnvName 'ACC_EMAIL_SYNC_WORK_END' -JsonValue $workEnd -Default $workEnd

    if (-not [string]::IsNullOrWhiteSpace($env:ACC_EMAIL_SYNC_SKIP_CATEGORIES)) {
        $skipCategories = @($env:ACC_EMAIL_SYNC_SKIP_CATEGORIES.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }

    return @{
        Senders         = $senders
        Patterns        = $patterns
        SkipCategories  = $skipCategories
        WorkStartHour   = $workStart
        WorkEndHour     = $workEnd
        BatchSize       = [Math]::Max(1, [Math]::Min(500, $batch))
    }
}

function Get-NzLocalTime {
    try {
        $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('New Zealand Standard Time')
        return [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
    } catch {
        return Get-Date
    }
}

function Test-WithinWorkHours {
    param(
        [int]$StartHour,
        [int]$EndHour
    )
    $now = Get-NzLocalTime
    return ($now.Hour -ge $StartHour -and $now.Hour -lt $EndHour)
}

function Get-StatePath {
    return Join-Path (Resolve-AccSuiteDir) 'email-sync-state.json'
}

function New-EmptySyncState {
    return @{
        version               = $StateVersion
        lastProcessedDateTime = $null
        processedEntryIds     = @()
        runStats              = @{
            totalSaved   = 0
            totalSkipped = 0
            totalErrors  = 0
            lastRunAt    = $null
            runs         = 0
        }
    }
}

function Load-SyncState {
    $path = Get-StatePath
    if (-not (Test-Path -LiteralPath $path)) {
        return New-EmptySyncState
    }
    try {
        $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
        $obj = $raw | ConvertFrom-Json
        $ids = @()
        if ($obj.processedEntryIds) { $ids = @($obj.processedEntryIds) }
        $stats = (New-EmptySyncState).runStats
        if ($obj.runStats) {
            if ($null -ne $obj.runStats.totalSaved) { $stats.totalSaved = [int]$obj.runStats.totalSaved }
            if ($null -ne $obj.runStats.totalSkipped) { $stats.totalSkipped = [int]$obj.runStats.totalSkipped }
            if ($null -ne $obj.runStats.totalErrors) { $stats.totalErrors = [int]$obj.runStats.totalErrors }
            if ($obj.runStats.lastRunAt) { $stats.lastRunAt = [string]$obj.runStats.lastRunAt }
            if ($null -ne $obj.runStats.runs) { $stats.runs = [int]$obj.runStats.runs }
        }
        return @{
            version               = $StateVersion
            lastProcessedDateTime = if ($obj.lastProcessedDateTime) { [string]$obj.lastProcessedDateTime } else { $null }
            processedEntryIds     = $ids
            runStats              = $stats
        }
    } catch {
        Write-SyncLine "WARN - could not read state file, starting fresh: $($_.Exception.Message)"
        return New-EmptySyncState
    }
}

function Save-SyncState {
    param([hashtable]$State)
    if (-not $State) { return }
    $suite = Resolve-AccSuiteDir
    [void][System.IO.Directory]::CreateDirectory($suite)
    $path = Get-StatePath
    if ($State.processedEntryIds.Count -gt $MaxProcessedIds) {
        $trim = $State.processedEntryIds.Count - $MaxProcessedIds
        $State.processedEntryIds = @($State.processedEntryIds | Select-Object -Skip $trim)
        Write-SyncLine "WARN - trimmed $trim old processedEntryIds from state (cap $MaxProcessedIds)"
    }
    $json = $State | ConvertTo-Json -Depth 6
    Set-Content -LiteralPath $path -Value $json -Encoding UTF8
    $script:SyncState = $State
    $script:StatePath = $path
}

function Register-GracefulShutdown {
    $null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -SupportEvent -Action {
        if ($script:SyncState) {
            Save-SyncState -State $script:SyncState
        }
    }
    [Console]::TreatControlCAsInput = $false
}

function Get-SenderAddress {
    param([object]$Item)
    $from = ''
    try { $from = [string]$Item.SenderEmailAddress } catch {}
    if (-not [string]::IsNullOrWhiteSpace($from) -and $from -notmatch '^/O=') {
        return $from
    }
    try {
        $smtp = [string]$Item.Sender.EmailAddress
        if (-not [string]::IsNullOrWhiteSpace($smtp)) { return $smtp }
    } catch {}
    try {
        $smtp = [string]$Item.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x39FE001E')
        if (-not [string]::IsNullOrWhiteSpace($smtp)) { return $smtp }
    } catch {}
    return $from
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

function Test-ShouldSkipMessage {
    param(
        [object]$Item,
        [string[]]$SkipCategories
    )
    $cats = ''
    try { $cats = [string]$Item.Categories } catch {}
    if (-not [string]::IsNullOrWhiteSpace($cats)) {
        foreach ($skip in $SkipCategories) {
            if ([string]::IsNullOrWhiteSpace($skip)) { continue }
            if ($cats -match [regex]::Escape($skip)) { return $true }
        }
    }
    # olFlagComplete = 1  -  treat completed follow-up flags as actioned
    try {
        if ([int]$Item.FlagStatus -eq 1) { return $true }
    } catch {}
    return $false
}

function Test-AlreadyProcessed {
    param(
        [hashtable]$State,
        [string]$MarkerDir,
        [string]$EntryId
    )
    if ($State.processedEntryIds -contains $EntryId) { return $true }
    $marker = Join-Path $MarkerDir ($EntryId + '.done')
    return Test-Path -LiteralPath $marker
}

function Mark-Processed {
    param(
        [hashtable]$State,
        [string]$MarkerDir,
        [string]$EntryId,
        [datetime]$Received
    )
    if ($State.processedEntryIds -notcontains $EntryId) {
        $State.processedEntryIds += $EntryId
    }
    if ($Received) {
        $iso = $Received.ToUniversalTime().ToString('o')
        if (-not $State.lastProcessedDateTime -or $iso -gt $State.lastProcessedDateTime) {
            $State.lastProcessedDateTime = $iso
        }
    }
    $marker = Join-Path $MarkerDir ($EntryId + '.done')
    Set-Content -LiteralPath $marker -Value (Get-Date).ToUniversalTime().ToString('o') -Encoding ASCII
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

function Write-SyncStatus {
    param(
        [hashtable]$Status
    )
    $suite = Resolve-AccSuiteDir
    [void][System.IO.Directory]::CreateDirectory($suite)
    $path = Join-Path $suite 'email-sync-status.json'
    $Status.version = $StatusVersion
    $Status.lastRunAt = (Get-Date).ToUniversalTime().ToString('o')
    $json = $Status | ConvertTo-Json -Depth 6 -Compress:$false
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($path, $json, $utf8NoBom)
    return $path
}

Register-GracefulShutdown
try {
    [Console]::CancelKeyPress.Add({
        param($sender, $e)
        $e.Cancel = $true
        $script:ShutdownRequested = $true
        Write-SyncLine ''
        Write-SyncLine 'Ctrl+C - saving state and stopping after current message...'
    }) | Out-Null
} catch {
    Write-SyncLine 'WARN - could not register Ctrl+C handler'
}

$useBacklog = -not $Recent
if ($env:ACC_EMAIL_SYNC_RECENT -eq '1') { $useBacklog = $false }
if ($env:ACC_EMAIL_SYNC_BACKLOG -eq '0') { $useBacklog = $false }

$config = Load-SyncConfig
$syncState = Load-SyncState
$script:SyncState = $syncState
$script:StatePath = Get-StatePath

$status = @{
    version            = $StatusVersion
    lastRunAt          = (Get-Date).ToUniversalTime().ToString('o')
    outcome            = 'running'
    mode               = if ($useBacklog) { 'backlog' } else { 'recent' }
    batchSize          = $config.BatchSize
    savedCount         = 0
    skippedCount       = 0
    errorCount         = 0
    savedFiles         = @()
    errors             = @()
    inboxPath          = ''
    sharedMailbox      = ''
    stateFile          = $script:StatePath
    processedTotal     = $syncState.processedEntryIds.Count
    workHoursSkipped   = $false
    backlogRemaining   = $null
    scanStats          = @{
        mailItemsScanned      = 0
        matchedSender         = 0
        matchedBoth           = 0
        skippedCategory       = 0
        alreadyProcessed      = 0
        noSupportedAttachment = 0
    }
}

Write-SyncLine ''
Write-SyncLine 'ACC Outlook COM email sync'
Write-SyncLine '=========================='
Write-SyncLine ''

$SharedMailbox = Resolve-SharedMailbox -Override $SharedMailbox
Write-SyncLine "Using mailbox: $SharedMailbox"

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

if ($useBacklog -and -not $IgnoreWorkHours -and -not (Test-WithinWorkHours -StartHour $config.WorkStartHour -EndHour $config.WorkEndHour)) {
    $nz = Get-NzLocalTime
    Write-SyncLine ("Outside work hours ({0:HH:mm} NZ)  -  sync runs {1}:00-{2}:00 only. Re-run during work hours or pass -IgnoreWorkHours." -f $nz, $config.WorkStartHour, $config.WorkEndHour)
    $status.outcome = 'paused'
    $status.workHoursSkipped = $true
    $null = Write-SyncStatus -Status $status
    exit 0
}

$markerDir = Join-Path $inbox '.email-sync'
[void][System.IO.Directory]::CreateDirectory($markerDir)

$cutoff = (Get-Date).AddDays(-1 * [Math]::Max(1, $DaysBack))
$outlook = $null

try {
    Write-SyncLine 'Connecting to Outlook.Application COM object...'
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace('MAPI')
    [void]$namespace.Logon($null, $null, $false, $true)

    $folder = Get-SharedInboxFolder -Namespace $namespace -SharedName $SharedMailbox
    Write-SyncLine "OK - COM connected (shared inbox: $SharedMailbox)"
    Write-SyncLine ("Sender allowlist: {0} pattern(s), {1} sender(s)" -f $config.Patterns.Count, $config.Senders.Count)
    Write-SyncLine "Saving attachments to: $inbox"
    if ($useBacklog) {
        Write-SyncLine ("Mode: backlog incremental  -  oldest first, up to {0} message(s) this run" -f $config.BatchSize)
        Write-SyncLine ("Skip categories/flags: {0}" -f ($config.SkipCategories -join ', '))
    } else {
        Write-SyncLine ("Mode: recent  -  last {0} day(s), newest first, up to {1} message(s)" -f $DaysBack, $config.BatchSize)
    }
    Write-SyncLine ''

    $items = $folder.Items
    if ($useBacklog) {
        $items.Sort('[ReceivedTime]', $false)
    } else {
        $items.Sort('[ReceivedTime]', $true)
    }

    $processedThisRun = 0
    $scanned = 0
    $hitBatchLimit = $false

    foreach ($item in $items) {
        if ($script:ShutdownRequested) { break }
        if ($processedThisRun -ge $config.BatchSize) {
            $hitBatchLimit = $true
            break
        }

        try {
            if ($item.Class -ne 43) { continue }

            $received = $null
            try { $received = [datetime]$item.ReceivedTime } catch {}
            if (-not $useBacklog -and $received -and $received -lt $cutoff) { continue }

            $status.scanStats.mailItemsScanned++

            $from = Get-SenderAddress -Item $item
            $subject = ''
            try { $subject = [string]$item.Subject } catch {}

            if (-not (Test-AccSender -FromAddress $from -Allowlist $config.Senders)) { continue }
            $status.scanStats.matchedSender++
            if (-not (Test-AccSubject -Subject $subject -Patterns $config.Patterns)) { continue }
            $status.scanStats.matchedBoth++
            if (Test-ShouldSkipMessage -Item $item -SkipCategories $config.SkipCategories) {
                $status.skippedCount++
                $status.scanStats.skippedCategory++
                continue
            }

            $entryId = ''
            try { $entryId = [string]$item.EntryID } catch {}
            if ([string]::IsNullOrWhiteSpace($entryId)) {
                $entryId = [string]::Concat($from, '|', $subject, '|', $received)
            }

            if (Test-AlreadyProcessed -State $syncState -MarkerDir $markerDir -EntryId $entryId) {
                $status.skippedCount++
                $status.scanStats.alreadyProcessed++
                continue
            }

            $attachments = $item.Attachments
            $savedAny = $false
            for ($i = 1; $i -le $attachments.Count; $i++) {
                if ($script:ShutdownRequested) { break }
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
                Mark-Processed -State $syncState -MarkerDir $markerDir -EntryId $entryId -Received $received
                $syncState.runStats.totalSaved++
                $processedThisRun++
            } else {
                $status.skippedCount++
                $status.scanStats.noSupportedAttachment++
                $syncState.runStats.totalSkipped++
            }
        } catch {
            $status.errorCount++
            $syncState.runStats.totalErrors++
            $status.errors += $_.Exception.Message
            Write-SyncLine ("  ERROR: $($_.Exception.Message)")
        } finally {
            if ($item) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($item) }
            $scanned++
            if ($scanned % 25 -eq 0) {
                Save-SyncState -State $syncState
            }
        }
    }

    if ($useBacklog -and $hitBatchLimit) {
        $status.backlogRemaining = -1
    }

    $syncState.runStats.lastRunAt = (Get-Date).ToUniversalTime().ToString('o')
    $syncState.runStats.runs++
    Save-SyncState -State $syncState

    $status.processedTotal = $syncState.processedEntryIds.Count
    $status.outcome = if ($script:ShutdownRequested) { 'paused' } else { 'ok' }
    Write-SyncLine ''
    if ($script:ShutdownRequested) {
        Write-SyncLine 'Stopped early  -  state saved for resume on next run.'
    }
    Write-SyncLine ("Done - saved {0} attachment(s) this run, skipped {1}, errors {2}, {3} total processed in state" -f $status.savedCount, $status.skippedCount, $status.errorCount, $status.processedTotal)
    $ss = $status.scanStats
    Write-SyncLine ("Scan: {0} mail item(s); {1} matched sender; {2} matched sender+subject; {3} skipped (category/flag); {4} already processed; {5} matched but no PDF/DOCX" -f $ss.mailItemsScanned, $ss.matchedSender, $ss.matchedBoth, $ss.skippedCategory, $ss.alreadyProcessed, $ss.noSupportedAttachment)
    if ($status.savedCount -eq 0 -and $ss.mailItemsScanned -eq 0) {
        Write-SyncLine 'Hint: inbox has no mail items in scan range - confirm ACCDistrictNursing is open in Outlook and you have delegate access.'
    } elseif ($status.savedCount -eq 0 -and $ss.matchedBoth -eq 0 -and $ss.matchedSender -eq 0) {
        Write-SyncLine 'Hint: no sender matches - letters may be in a shared mailbox or SenderEmailAddress differs from allowlist.'
    } elseif ($status.savedCount -eq 0 -and $ss.matchedBoth -eq 0) {
        Write-SyncLine 'Hint: sender matched but subject did not - widen subjectPatterns in office-config.json.'
    }
    if ($useBacklog -and $hitBatchLimit) {
        Write-SyncLine 'Backlog: batch limit reached  -  run again during work hours until saved count is 0.'
    }
    Write-SyncLine 'Next: Start Folder Watch.cmd picks up new files -> Review Queue (no auto-import).'
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
    if ($syncState) {
        Save-SyncState -State $syncState
    }
    $statusPath = Write-SyncStatus -Status $status
    Write-SyncLine ''
    Write-SyncLine "Status: $statusPath"
    Write-SyncLine "State:  $($script:StatePath)"
    Write-SyncLine "Log:    $env:USERPROFILE\ACC-Suite\logs\email-sync-bootstrap.log"
    Write-SyncLine ''
}

if ($status.outcome -eq 'fail') { exit 1 }
