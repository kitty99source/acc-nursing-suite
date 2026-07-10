param(
    [string]$SharedMailbox = '',
    [int]$BatchSize = 0,
    [switch]$Recent,
    [int]$DaysBack = 14,
    [switch]$IgnoreWorkHours,
    [switch]$Scheduled,
    [Alias('Backfill')]
    [switch]$IncludeActioned
)

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'email-sync'
. (Join-Path $bootstrapRoot 'mailbox-config.ps1')
. (Join-Path $bootstrapRoot 'inbox-config.ps1')
Write-BootstrapLog 'outlook-sync.ps1 started'

# ACC Outlook COM sync - work laptop only
#
# Reads filtered inbox from open Outlook session.
# Saves PDF/DOCX attachments to %USERPROFILE%\ACC-Inbox for folder watch + HRQ.
# Default mode: incremental backlog (oldest ACC letters first, batched per run).
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

$DefaultSkipCategories = @()
$DefaultWorkStartHour = 7
$DefaultWorkEndHour = 18
# Enforcement of the work-hours window is OFF by default. Manual runs (Start Email Sync.cmd /
# Start WFH Mode.cmd) are never clock-blocked; the window is only consulted by a future
# scheduled/automated daemon that passes -Scheduled AND opts in via accWorkHours.enabled=true.
$DefaultWorkHoursEnabled = $false
$DefaultBatchSize = 50
# Subject match mode: 'tokens' (default, EITHER Claim OR ACCID, colon-optional), 'any' (legacy OR
# over subjectPatterns), 'all' (require BOTH Claim AND ACCID). See Test-AccSubjectMode.
# NOTE: since captureMode 'attachment' (the new default) the subject match is only a CONFIDENCE
# HINT that is logged; it no longer gates capture. It still gates capture in the legacy
# 'sender+subject+attachment' captureMode.
$DefaultSubjectMatchMode = 'tokens'
$DefaultRequiredTokens = @('Claim', 'ACCID')
# Capture decision mode. Controls what a sender-matched message must ALSO have to be captured:
#   'attachment'                (NEW DEFAULT) - sender + >=1 supported attachment. Subject optional.
#   'sender+subject+attachment' (legacy strict) - sender + subject token match + supported attachment.
#   'subject-or-attachment'     - sender + (subject token match OR >=1 supported attachment).
# Everything captured still flows to the Human Review Queue for MANUAL sign-off (nothing auto-commits),
# so over-capturing is safe while under-capturing (a missed letter) is the real harm.
$DefaultCaptureMode = 'attachment'
# Attachment extensions saved to ACC-Inbox. Case-insensitive (.PDF / .Pdf / .pdf all accepted).
# .doc is saved for HRQ review even though the app importer needs .docx (user Save-As to .docx).
$DefaultSupportedExt = @('.pdf', '.docx', '.doc')
$StateVersion = 1
$StatusVersion = 1
$MaxProcessedIds = 20000
# Consecutive Exchange/COM read failures (e.g. Citrix VPN drop mid-scan) that trigger an early,
# graceful abort so a dropped connection stops the run instead of spamming ~1000 error lines.
$DefaultMaxConsecutiveComErrors = 10

$script:ShutdownRequested = $false
$script:SyncState = $null
$script:StatePath = $null
$script:LastSyncStatus = $null
$script:ScanSkipReason = $null
$script:NonMatchSamples = @()

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

function Add-NonMatchSample {
    param(
        [string]$Reason,
        [string]$Sender,
        [string]$Subject
    )
    if ($script:NonMatchSamples.Count -ge 3) { return }
    $detail = "{0} | from={1} | subj={2}" -f $Reason, $Sender, (Get-TruncatedSubject -Subject $Subject -MaxLen 50)
    $script:NonMatchSamples += $detail
}

function Load-SyncConfig {
    $senders = @($DefaultSenders)
    $patterns = @($DefaultSubjectPatterns)
    $skipCategories = @($DefaultSkipCategories)
    $workStart = $DefaultWorkStartHour
    $workEnd = $DefaultWorkEndHour
    $workEnabled = $DefaultWorkHoursEnabled
    $batch = $DefaultBatchSize
    $subjectMode = $DefaultSubjectMatchMode
    $requiredTokens = @($DefaultRequiredTokens)
    $supportedExt = @($DefaultSupportedExt)
    $captureMode = $DefaultCaptureMode

    $configPath = Get-OfficeConfigPath
    if ($configPath) {
        try {
            $raw = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
            $cfg = $raw | ConvertFrom-Json
            $mergedSenders = @()
            # Seed with defaults so a narrower office-config can never drop Claim:/ACCID: (7cee0da rule).
            $mergedPatterns = @($DefaultSubjectPatterns)
            if ($cfg.accInbox -and $cfg.accInbox.senderAllowlist) {
                $mergedSenders += @($cfg.accInbox.senderAllowlist)
            }
            if ($cfg.settings -and $cfg.settings.accInboxSenderAllowlist) {
                $mergedSenders += @($cfg.settings.accInboxSenderAllowlist)
            }
            if ($cfg.accInbox -and $cfg.accInbox.subjectPatterns) {
                $mergedPatterns += @($cfg.accInbox.subjectPatterns)
            }
            if ($cfg.settings -and $cfg.settings.accInboxSubjectPatterns) {
                $mergedPatterns += @($cfg.settings.accInboxSubjectPatterns)
            }
            if ($mergedSenders.Count -gt 0) {
                $senders = Merge-UniqueStringList -Values $mergedSenders
            }
            if ($mergedPatterns.Count -gt 0) {
                $patterns = Merge-UniqueStringList -Values $mergedPatterns
            }
            if ($cfg.emailSync) {
                if ($cfg.emailSync.skipCategories) { $skipCategories = @($cfg.emailSync.skipCategories) }
                $workStart = Get-ConfigInt -EnvName 'ACC_EMAIL_SYNC_WORK_START' -JsonValue $cfg.emailSync.workStartHour -Default $workStart
                $workEnd = Get-ConfigInt -EnvName 'ACC_EMAIL_SYNC_WORK_END' -JsonValue $cfg.emailSync.workEndHour -Default $workEnd
                $batch = Get-ConfigInt -EnvName 'ACC_EMAIL_SYNC_BATCH_SIZE' -JsonValue $cfg.emailSync.batchSize -Default $batch
                if (-not [string]::IsNullOrWhiteSpace([string]$cfg.emailSync.subjectMatchMode)) {
                    $subjectMode = [string]$cfg.emailSync.subjectMatchMode
                }
                if (-not [string]::IsNullOrWhiteSpace([string]$cfg.emailSync.captureMode)) {
                    $captureMode = [string]$cfg.emailSync.captureMode
                }
                if ($cfg.emailSync.requiredTokens) {
                    $tokList = @($cfg.emailSync.requiredTokens | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
                    if ($tokList.Count -gt 0) { $requiredTokens = $tokList }
                }
                if ($cfg.emailSync.attachmentExtensions) {
                    $extList = @($cfg.emailSync.attachmentExtensions | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
                    if ($extList.Count -gt 0) { $supportedExt = $extList }
                }
            }
            # accWorkHours (structured window) takes precedence over legacy emailSync.workStartHour/EndHour.
            # It only affects a future scheduled/automated run (-Scheduled); manual runs ignore it.
            if ($cfg.accWorkHours) {
                if ($null -ne $cfg.accWorkHours.start) {
                    $workStart = Get-ConfigInt -EnvName 'ACC_EMAIL_SYNC_WORK_START' -JsonValue $cfg.accWorkHours.start -Default $workStart
                }
                if ($null -ne $cfg.accWorkHours.end) {
                    $workEnd = Get-ConfigInt -EnvName 'ACC_EMAIL_SYNC_WORK_END' -JsonValue $cfg.accWorkHours.end -Default $workEnd
                }
                if ($null -ne $cfg.accWorkHours.enabled) {
                    $workEnabled = [bool]$cfg.accWorkHours.enabled
                }
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

    $envEnabled = $env:ACC_EMAIL_SYNC_WORK_HOURS_ENABLED
    if ($envEnabled -match '^(?i:1|true|yes|on)$') { $workEnabled = $true }
    elseif ($envEnabled -match '^(?i:0|false|no|off)$') { $workEnabled = $false }

    if (-not [string]::IsNullOrWhiteSpace($env:ACC_EMAIL_SYNC_SKIP_CATEGORIES)) {
        $skipCategories = @($env:ACC_EMAIL_SYNC_SKIP_CATEGORIES.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }

    if (-not [string]::IsNullOrWhiteSpace($env:ACC_EMAIL_SYNC_SUBJECT_MODE)) {
        $subjectMode = $env:ACC_EMAIL_SYNC_SUBJECT_MODE.Trim()
    }
    $subjectMode = $subjectMode.Trim().ToLowerInvariant()
    if ($subjectMode -ne 'any' -and $subjectMode -ne 'all' -and $subjectMode -ne 'tokens') {
        $subjectMode = $DefaultSubjectMatchMode
    }

    if (-not [string]::IsNullOrWhiteSpace($env:ACC_EMAIL_SYNC_CAPTURE_MODE)) {
        $captureMode = $env:ACC_EMAIL_SYNC_CAPTURE_MODE.Trim()
    }
    $captureMode = $captureMode.Trim().ToLowerInvariant()
    if ($captureMode -ne 'attachment' -and $captureMode -ne 'sender+subject+attachment' -and $captureMode -ne 'subject-or-attachment') {
        $captureMode = $DefaultCaptureMode
    }

    return @{
        Senders          = $senders
        Patterns         = $patterns
        SkipCategories   = $skipCategories
        WorkStartHour    = $workStart
        WorkEndHour      = $workEnd
        WorkHoursEnabled = $workEnabled
        BatchSize        = [Math]::Max(1, [Math]::Min(500, $batch))
        SubjectMatchMode = $subjectMode
        RequiredTokens   = @($requiredTokens)
        SupportedExt     = @($supportedExt)
        CaptureMode      = $captureMode
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
        if ($script:LastSyncStatus) {
            if ($script:ShutdownRequested) {
                $script:LastSyncStatus.outcome = 'paused'
            }
            try { $null = Write-SyncStatus -Status $script:LastSyncStatus } catch {}
        }
        if ($script:SyncState) {
            Save-SyncState -State $script:SyncState
        }
    }
    [Console]::TreatControlCAsInput = $false
}

function Format-SkipCategoriesSummary {
    param([string[]]$SkipCategories)
    if (-not $SkipCategories -or $SkipCategories.Count -eq 0) {
        return '(none - actioned mail is captured for HRQ review)'
    }
    return ($SkipCategories -join ', ')
}

function Test-ShouldSkipMessage {
    param(
        [object]$Item,
        [string[]]$SkipCategories
    )
    # Outlook "actioned" means saved locally, not HRQ-complete - do not skip by default.
    # Admins may opt in to skip specific categories via office-config skipCategories.
    $cats = ''
    try { $cats = [string]$Item.Categories } catch {}
    if (-not [string]::IsNullOrWhiteSpace($cats)) {
        foreach ($skip in $SkipCategories) {
            if ([string]::IsNullOrWhiteSpace($skip)) { continue }
            if ($cats -match [regex]::Escape($skip)) { return $true }
        }
    }
    return $false
}

function Test-IsExchangeConnectionError {
    param([System.Management.Automation.ErrorRecord]$ErrorRecord)
    if (-not $ErrorRecord) { return $false }
    $ex = $ErrorRecord.Exception
    $cur = $ex
    $depth = 0
    while ($cur -and $depth -lt 5) {
        if ($cur -is [System.Runtime.InteropServices.COMException]) { return $true }
        $msg = [string]$cur.Message
        if ($msg -match 'Network problems' -or $msg -match 'Microsoft Exchange' -or $msg -match 'server is not available' -or $msg -match 'connection is not available') {
            return $true
        }
        $cur = $cur.InnerException
        $depth++
    }
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

function Get-FileSha256Hex {
    param([string]$FilePath)
    $hash = Get-FileHash -LiteralPath $FilePath -Algorithm SHA256
    return $hash.Hash.ToLowerInvariant()
}

function Get-PatientNameFromSubject {
    # Title-stripped display name before " - Claim" (for meta / sidecar enrichment).
    param([string]$Subject)
    if ([string]::IsNullOrWhiteSpace($Subject)) { return $null }
    $sepIndex = $Subject.IndexOf(' - Claim', [System.StringComparison]::OrdinalIgnoreCase)
    if ($sepIndex -lt 0) { return $null }
    $nameSource = $Subject.Substring(0, $sepIndex)
    $nameSource = ($nameSource -replace '\s+', ' ').Trim()
    $nameSource = [regex]::Replace($nameSource, '^(?i:mr|mrs|ms|miss|dr)\.?\s+', '')
    if ([string]::IsNullOrWhiteSpace($nameSource)) { return $null }
    return $nameSource
}

function Get-ClaimTokenFromSubject {
    param([string]$Subject)
    if ([string]::IsNullOrWhiteSpace($Subject)) { return $null }
    $claimMatch = [regex]::Match($Subject, '(?i:claim)\s*[:#]?\s*([A-Za-z0-9]+)')
    if (-not $claimMatch.Success) { return $null }
    $token = [regex]::Replace($claimMatch.Groups[1].Value, '[^A-Za-z0-9]', '')
    if ([string]::IsNullOrWhiteSpace($token)) { return $null }
    return $token
}

function Get-AccIdTokenFromSubject {
    param([string]$Subject)
    if ([string]::IsNullOrWhiteSpace($Subject)) { return $null }
    $m = [regex]::Match($Subject, '(?i:accid)\s*[:#]?\s*([A-Za-z0-9\-]+)')
    if (-not $m.Success) { return $null }
    return $m.Groups[1].Value.Trim()
}

function Write-EmailSyncMeta {
    # Atomic per-file metadata keyed by SHA-256 so folder-watch / launch.ps1 can
    # look up patient/claim without fragile filename matching.
    param(
        [string]$Inbox,
        [string]$Hash,
        [string]$EntryId,
        [string]$Subject,
        [string]$Sender,
        [string]$FileName,
        [string]$DescriptiveFileName,
        [string]$RelativePath,
        [datetime]$EmailDate
    )
    $metaDir = Join-Path $Inbox '.email-sync'
    [void][System.IO.Directory]::CreateDirectory($metaDir)
    $metaPath = Join-Path $metaDir ("{0}.meta.json" -f $Hash)
    $tmpPath = $metaPath + '.tmp'
    $emailDateIso = $null
    if ($EmailDate -and $EmailDate -ne [datetime]::MinValue) {
        try { $emailDateIso = $EmailDate.ToUniversalTime().ToString('o') } catch {}
    }
    $meta = [ordered]@{
        version            = 1
        hash               = $Hash
        entryId            = $EntryId
        subject            = $Subject
        sender             = $Sender
        savedAt            = (Get-Date).ToUniversalTime().ToString('o')
        emailDate          = $emailDateIso
        fileName           = $FileName
        descriptiveFileName = $DescriptiveFileName
        patientName        = (Get-PatientNameFromSubject -Subject $Subject)
        claimNumber        = (Get-ClaimTokenFromSubject -Subject $Subject)
        accId              = (Get-AccIdTokenFromSubject -Subject $Subject)
        relativePath       = $RelativePath
    }
    $json = $meta | ConvertTo-Json -Depth 4 -Compress:$false
    [System.IO.File]::WriteAllText($tmpPath, $json, [Text.Encoding]::UTF8)
    Move-Item -LiteralPath $tmpPath -Destination $metaPath -Force

    # Maintain hash-index.json (hash -> relative path under ACC-Inbox) for /_acc/inbox-file.
    $indexPath = Join-Path $metaDir 'hash-index.json'
    $index = @{}
    if (Test-Path -LiteralPath $indexPath -PathType Leaf) {
        try {
            $existing = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($existing) {
                $existing.PSObject.Properties | ForEach-Object { $index[$_.Name] = [string]$_.Value }
            }
        } catch {}
    }
    $index[$Hash] = $RelativePath
    $indexTmp = $indexPath + '.tmp'
    $indexJson = ($index | ConvertTo-Json -Depth 3 -Compress:$false)
    if ([string]::IsNullOrWhiteSpace($indexJson) -or $indexJson -eq 'null') { $indexJson = '{}' }
    [System.IO.File]::WriteAllText($indexTmp, $indexJson, [Text.Encoding]::UTF8)
    Move-Item -LiteralPath $indexTmp -Destination $indexPath -Force
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

function Limit-FileNameLength {
    # Cap a filename to a safe length while preserving its extension. Prevents the
    # descriptive prefix (patient + claim) from pushing paths past Windows limits.
    param(
        [string]$FileName,
        [int]$MaxLength = 150
    )
    if ([string]::IsNullOrEmpty($FileName)) { return $FileName }
    if ($FileName.Length -le $MaxLength) { return $FileName }
    $ext = [System.IO.Path]::GetExtension($FileName)
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $keep = $MaxLength - $ext.Length
    if ($keep -lt 1) {
        return $FileName.Substring(0, $MaxLength)
    }
    return ($stem.Substring(0, $keep) + $ext)
}

function Test-IsDescriptiveFileName {
    # Mirrors isDescriptiveName in src/lib/attachmentNaming.ts - KEEP IN SYNC.
    param([string]$FileName)
    $leaf = [System.IO.Path]::GetFileName($FileName)
    if ([string]::IsNullOrWhiteSpace($leaf)) { return $false }
    if ($leaf -match '^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?_Claim[A-Za-z0-9]+_') { return $true }
    if ($leaf -match '^Claim[A-Za-z0-9]+_') { return $true }
    if ($leaf -match '^[A-Za-z0-9]+-[A-Za-z0-9]+_') { return $true }
    return $false
}

function Strip-DescriptivePrefix {
    # Mirrors stripDescriptivePrefix in src/lib/attachmentNaming.ts - KEEP IN SYNC.
    # Prevents double-prefix when rename / re-save runs on an already-descriptive name.
    param([string]$FileName)
    $leaf = [System.IO.Path]::GetFileName($FileName)
    if ([string]::IsNullOrWhiteSpace($leaf)) { return $leaf }
    if (-not (Test-IsDescriptiveFileName -FileName $leaf)) { return $leaf }
    $m = [regex]::Match($leaf, '^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?_Claim[A-Za-z0-9]+_(.+)$')
    if ($m.Success) { return $m.Groups[1].Value }
    $m = [regex]::Match($leaf, '^Claim[A-Za-z0-9]+_(.+)$')
    if ($m.Success) { return $m.Groups[1].Value }
    $m = [regex]::Match($leaf, '^[A-Za-z0-9]+-[A-Za-z0-9]+_(.+)$')
    if ($m.Success) { return $m.Groups[1].Value }
    return $leaf
}

function New-DescriptiveFileName {
    # Build a patient/claim-identifiable filename from the email SUBJECT so the
    # reviewer can tell letters apart WITHOUT opening them. Bytes are untouched
    # (SaveAsFile writes the same content), so the content SHA-256 that folder
    # watch dedups on is unchanged - only the on-disk name differs.
    #
    # Subject format (real ACC): "Mr Graham Wayne Reichenbach - Claim:P2222756868 ACCID:VEND-K96655"
    #   patient = text before " - Claim" (title stripped, formatted Surname-First)
    #   claim   = alphanumerics after "Claim:"
    # Result:  "Reichenbach-Graham_ClaimP2222756868_<original>.docx"
    #
    # FALLBACK: if neither a patient name nor a claim can be parsed, the ORIGINAL
    # filename is returned unchanged (never an empty/garbage prefix). If only one
    # of the two is present, only that part is used.
    # IDEMPOTENT: strips an existing descriptive prefix first so re-runs never
    # double-prefix (mirrors descriptiveAttachmentName in attachmentNaming.ts).
    param(
        [string]$Subject,
        [string]$OriginalFileName
    )

    $leaf = [System.IO.Path]::GetFileName($OriginalFileName)
    if ([string]::IsNullOrWhiteSpace($leaf)) { return $OriginalFileName }
    $original = Strip-DescriptivePrefix -FileName $leaf
    if ([string]::IsNullOrWhiteSpace($Subject)) { return $original }

    # --- Patient name: text BEFORE " - Claim" (the reliable ACC format signal).
    # No separator => don't guess a name from a free-text subject; fall through.
    $patientPart = ''
    $sepIndex = $Subject.IndexOf(' - Claim', [System.StringComparison]::OrdinalIgnoreCase)
    if ($sepIndex -ge 0) {
        $nameSource = $Subject.Substring(0, $sepIndex)
        $nameSource = ($nameSource -replace '\s+', ' ').Trim()
        # Strip a leading title (Mr/Mrs/Ms/Miss/Dr, optional trailing dot).
        $nameSource = [regex]::Replace($nameSource, '^(?i:mr|mrs|ms|miss|dr)\.?\s+', '')
        # Reduce each word to filesystem-safe ASCII alphanumerics.
        $words = @()
        foreach ($w in ($nameSource -split '\s+')) {
            $clean = [regex]::Replace($w, '[^A-Za-z0-9]', '')
            if ($clean.Length -gt 0) { $words += $clean }
        }
        if ($words.Count -ge 2) {
            $patientPart = ('{0}-{1}' -f $words[$words.Count - 1], $words[0])
        } elseif ($words.Count -eq 1) {
            $patientPart = $words[0]
        }
    }

    # --- Claim number: alphanumerics after "Claim:" (keeps the "P" prefix).
    $claimPart = ''
    $claimMatch = [regex]::Match($Subject, '(?i:claim)\s*[:#]?\s*([A-Za-z0-9]+)')
    if ($claimMatch.Success) {
        $claimPart = [regex]::Replace($claimMatch.Groups[1].Value, '[^A-Za-z0-9]', '')
    }

    # --- Assemble whatever we parsed into a prefix.
    $prefix = ''
    if ($patientPart -and $claimPart) {
        $prefix = ('{0}_Claim{1}' -f $patientPart, $claimPart)
    } elseif ($patientPart) {
        $prefix = $patientPart
    } elseif ($claimPart) {
        $prefix = ('Claim{0}' -f $claimPart)
    }

    if ([string]::IsNullOrWhiteSpace($prefix)) { return $original }

    $descriptive = ('{0}_{1}' -f $prefix, $original)
    return (Limit-FileNameLength -FileName $descriptive -MaxLength 150)
}

function Write-ScanBreakdownSummary {
    param(
        [hashtable]$Status,
        [string]$SkipReason = ''
    )
    if (-not [string]::IsNullOrWhiteSpace($SkipReason)) {
        Write-SyncLine "Scan: not performed ($SkipReason)"
        return
    }
    $ss = $Status.scanStats
    if (-not $ss) {
        Write-SyncLine 'Scan: (no stats recorded)'
        return
    }
    Write-SyncLine ("Scan: {0} mail item(s); {1} matched sender; {2} sender+subject (subject is a hint only); {3} skipped (configured category); {4} already processed; {5} sender-matched but no PDF/DOCX/DOC" -f $ss.mailItemsScanned, $ss.matchedSender, $ss.matchedBoth, $ss.skippedCategory, $ss.alreadyProcessed, $ss.noSupportedAttachment)
    if ($Status.savedCount -eq 0 -and $ss.mailItemsScanned -eq 0) {
        Write-SyncLine 'Hint: inbox has no mail items in scan range - confirm ACCDistrictNursing is open in Outlook and you have delegate access.'
    } elseif ($Status.savedCount -eq 0 -and $ss.matchedSender -eq 0) {
        Write-SyncLine 'Hint: no sender matches - letters may be in a shared mailbox or SenderEmailAddress differs from allowlist.'
    } elseif ($Status.savedCount -eq 0 -and $ss.noSupportedAttachment -gt 0) {
        Write-SyncLine 'Hint: sender matched but no .pdf/.docx/.doc attachment found - body-only emails are not captured (capture rule = sender + supported attachment; subject optional).'
    }
    if ($script:NonMatchSamples -and $script:NonMatchSamples.Count -gt 0) {
        Write-SyncLine 'First non-match samples:'
        foreach ($sample in $script:NonMatchSamples) {
            Write-SyncLine "  - $sample"
        }
    }
}

function Write-SyncStatus {
    param(
        [hashtable]$Status
    )
    $suite = Resolve-AccSuiteDir
    [void][System.IO.Directory]::CreateDirectory($suite)
    $path = Join-Path $suite 'email-sync-status.json'
    $tmpPath = Join-Path $suite 'email-sync-status.json.tmp'

    $Status.version = $StatusVersion
    $Status.lastRunAt = (Get-Date).ToUniversalTime().ToString('o')
    if ($Status.savedFiles -and $Status.savedFiles.Count -gt 200) {
        $Status.savedFiles = @($Status.savedFiles | Select-Object -Last 200)
        $Status.savedFilesTruncated = $true
    }

    $json = $null
    try {
        $json = $Status | ConvertTo-Json -Depth 6 -Compress:$false
    } catch {
        Write-BootstrapLog "WARN - ConvertTo-Json failed: $($_.Exception.Message); writing minimal status"
        $minimal = @{
            version       = $StatusVersion
            lastRunAt     = $Status.lastRunAt
            outcome       = if ($Status.outcome) { $Status.outcome } else { 'fail' }
            savedCount    = 0
            skippedCount  = 0
            errorCount    = 1
            savedFiles    = @()
            errors        = @("Status JSON serialization failed: $($_.Exception.Message)")
            inboxPath     = if ($Status.inboxPath) { [string]$Status.inboxPath } else { '' }
            sharedMailbox = if ($Status.sharedMailbox) { [string]$Status.sharedMailbox } else { '' }
        }
        $json = $minimal | ConvertTo-Json -Depth 4 -Compress:$false
    }

    $written = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $utf8NoBom = New-Object System.Text.UTF8Encoding $false
            [System.IO.File]::WriteAllText($tmpPath, $json, $utf8NoBom)
            if (Test-Path -LiteralPath $path) {
                Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            }
            Move-Item -LiteralPath $tmpPath -Destination $path -Force
            $written = $true
            Write-BootstrapLog "Wrote email-sync-status.json ($path)"
            break
        } catch {
            Write-BootstrapLog "WARN - status WriteAllText attempt $attempt failed: $($_.Exception.Message)"
            try {
                Set-Content -LiteralPath $path -Value $json -Encoding UTF8 -Force
                $written = $true
                Write-BootstrapLog "Wrote email-sync-status.json via Set-Content fallback ($path)"
                break
            } catch {
                Write-BootstrapLog "WARN - status Set-Content attempt $attempt failed: $($_.Exception.Message)"
            }
            if ($attempt -lt 3) { Start-Sleep -Milliseconds (50 * $attempt) }
        }
    }

    if (-not $written) {
        Write-BootstrapLog "FAIL - could not write email-sync-status.json to $path"
    } elseif (Test-Path -LiteralPath $tmpPath) {
        Remove-Item -LiteralPath $tmpPath -Force -ErrorAction SilentlyContinue
    }

    $script:LastSyncStatus = $Status
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
$script:LastSyncStatus = $status
$null = Write-SyncStatus -Status $status

Write-SyncLine ''
Write-SyncLine 'ACC Outlook COM email sync'
Write-SyncLine '=========================='
Write-SyncLine ''

$SharedMailbox = Resolve-SharedMailbox -Override $SharedMailbox
Write-SyncLine "Using mailbox: $SharedMailbox"

if ($env:ACC_AUTOMATION_PAUSED -eq '1') {
    Write-SyncLine 'Automation paused (ACC_AUTOMATION_PAUSED=1). Exiting.'
    $status.outcome = 'paused'
    $script:ScanSkipReason = 'automation paused (ACC_AUTOMATION_PAUSED=1)'
    $null = Write-SyncStatus -Status $status
    exit 0
}

$inbox = Resolve-InboxPath -ScriptRoot $bootstrapRoot
$status.inboxPath = $inbox
$status.sharedMailbox = $SharedMailbox
Initialize-InboxDirs -Inbox $inbox
[void][System.IO.Directory]::CreateDirectory((Join-Path $inbox '.email-sync'))

$pauseFile = Join-Path $inbox '.automation-paused'
if (Test-Path -LiteralPath $pauseFile) {
    Write-SyncLine 'Automation paused (.automation-paused in ACC-Inbox). Exiting.'
    $status.outcome = 'paused'
    $script:ScanSkipReason = 'automation paused (.automation-paused in ACC-Inbox)'
    $null = Write-SyncStatus -Status $status
    exit 0
}

# Work-hours gate (U-08 revision):
#   Manual runs (double-clicking Start Email Sync.cmd / Start WFH Mode.cmd) are the signal that
#   Prakriti is working from home, so they ALWAYS proceed regardless of the clock.
#   The time window only ever applies to a future scheduled/automated daemon that passes -Scheduled
#   AND has opted in via accWorkHours.enabled=true. -IgnoreWorkHours remains a hard override.
$nzNow = Get-NzLocalTime
$withinWorkHours = Test-WithinWorkHours -StartHour $config.WorkStartHour -EndHour $config.WorkEndHour
if ($Scheduled) {
    if ($useBacklog -and $config.WorkHoursEnabled -and -not $IgnoreWorkHours -and -not $withinWorkHours) {
        Write-SyncLine ("Scheduled run outside {1:00}:00-{2:00}:00 NZ work-hours window (now {0:HH:mm} NZ), skipping. Pass -IgnoreWorkHours to force." -f $nzNow, $config.WorkStartHour, $config.WorkEndHour)
        $status.outcome = 'paused'
        $status.workHoursSkipped = $true
        $script:ScanSkipReason = ("scheduled run outside work-hours window ({0}:00-{1}:00 NZ)" -f $config.WorkStartHour, $config.WorkEndHour)
        $null = Write-SyncStatus -Status $status
        exit 0
    }
    if ($config.WorkHoursEnabled) {
        Write-SyncLine ("Scheduled run ({0:HH:mm} NZ) - work-hours window {1:00}:00-{2:00}:00 satisfied (or overridden), proceeding." -f $nzNow, $config.WorkStartHour, $config.WorkEndHour)
    } else {
        Write-SyncLine ("Scheduled run ({0:HH:mm} NZ) - work-hours window disabled in office-config (accWorkHours.enabled=false), proceeding." -f $nzNow)
    }
} else {
    Write-SyncLine ("Manual run ({0:HH:mm} NZ) - work-hours gate skipped (manual launch is the signal you are working)." -f $nzNow)
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
    $resolution = Get-LastMailboxResolution
    Write-SyncLine "OK - COM connected (shared inbox: $SharedMailbox)"
    if ($resolution) {
        Write-SyncLine "Mailbox resolved via: $resolution"
    }
    Write-SyncLine ("Sender allowlist: {0} sender(s), {1} subject pattern(s)" -f $config.Senders.Count, $config.Patterns.Count)
    if ($config.CaptureMode -eq 'sender+subject+attachment') {
        Write-SyncLine 'Capture mode: sender+subject+attachment (legacy strict - requires sender AND subject match AND supported attachment)'
    } elseif ($config.CaptureMode -eq 'subject-or-attachment') {
        Write-SyncLine 'Capture mode: subject-or-attachment (sender AND (subject match OR supported attachment))'
    } else {
        Write-SyncLine 'Capture mode: attachment (default - captures sender + supported attachment; subject is only a logged confidence hint)'
    }
    if ($config.SubjectMatchMode -eq 'any') {
        Write-SyncLine ("Subject match (hint) mode: any (matches any of {0} pattern(s))" -f $config.Patterns.Count)
    } elseif ($config.SubjectMatchMode -eq 'all') {
        Write-SyncLine ("Subject match (hint) mode: all (requires ALL tokens: {0})" -f ($config.RequiredTokens -join ' + '))
    } else {
        Write-SyncLine ("Subject match (hint) mode: tokens (matches ANY token, colon-optional: {0})" -f ($config.RequiredTokens -join ' or '))
    }
    Write-SyncLine ("Attachment types saved (case-insensitive): {0}" -f ($config.SupportedExt -join ', '))
    Write-SyncLine "Saving attachments to: $inbox"
    if ($IncludeActioned) {
        Write-SyncLine 'Backfill mode (legacy -IncludeActioned alias; default sync now includes actioned mail)'
    }
    if ($useBacklog) {
        Write-SyncLine ("Mode: backlog incremental  -  oldest first, up to {0} message(s) this run" -f $config.BatchSize)
        Write-SyncLine ("Skip categories/flags: {0}" -f (Format-SkipCategoriesSummary -SkipCategories $config.SkipCategories))
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

    $mailItems = $items
    try {
        $restricted = $items.Restrict("[MessageClass] = 'IPM.Note'")
        if ($restricted -and $restricted.Count -gt 0) {
            if ($useBacklog) {
                $restricted.Sort('[ReceivedTime]', $false)
            } else {
                $restricted.Sort('[ReceivedTime]', $true)
            }
            $mailItems = $restricted
            Write-SyncLine ("Scanning {0} mail item(s) via Restrict (folder total {1})" -f $mailItems.Count, $items.Count)
        } else {
            Write-SyncLine ("Scanning {0} folder item(s) (Restrict returned empty - using full Items)" -f $items.Count)
        }
    } catch {
        Write-SyncLine ("WARN - Restrict filter failed, using full Items: $($_.Exception.Message)")
    }

    $processedThisRun = 0
    $scanned = 0
    $hitBatchLimit = $false
    $itemTotal = [int]$mailItems.Count
    $consecutiveComErrors = 0
    $connectionLost = $false

    for ($itemIndex = 1; $itemIndex -le $itemTotal; $itemIndex++) {
        if ($script:ShutdownRequested) { break }
        if ($processedThisRun -ge $config.BatchSize) {
            $hitBatchLimit = $true
            break
        }

        $item = $null
        try {
            $item = $mailItems.Item($itemIndex)
            # Successful COM read - the Exchange connection is alive, so clear the failure streak.
            $consecutiveComErrors = 0
            if ($item.Class -ne 43) { continue }

            $received = $null
            try { $received = [datetime]$item.ReceivedTime } catch {}
            if (-not $useBacklog -and $received -and $received -lt $cutoff) { continue }

            $status.scanStats.mailItemsScanned++

            $from = Get-SenderAddress -Item $item
            $subject = ''
            try { $subject = [string]$item.Subject } catch {}

            if (-not (Test-AccSender -FromAddress $from -Allowlist $config.Senders)) {
                Add-NonMatchSample -Reason 'sender mismatch' -Sender $from -Subject $subject
                continue
            }
            $status.scanStats.matchedSender++

            # Subject-token match is now only a CONFIDENCE HINT (computed + logged), NOT a required
            # capture gate. Under the default 'attachment' captureMode a message is captured on
            # sender + supported attachment REGARDLESS of subject, which fixes real letters that
            # were missed because their subject was name-only (e.g. "Steyn"/"Watson") instead of
            # containing Claim:/ACCID:. Everything captured still flows to the HRQ for manual sign-off.
            $subjectMatch = $false
            try {
                $subjectMatch = Test-AccSubjectMode -Subject $subject -Patterns $config.Patterns -Mode $config.SubjectMatchMode -RequiredTokens $config.RequiredTokens
            } catch {}
            if ($subjectMatch) { $status.scanStats.matchedBoth++ }

            # Legacy strict mode is the ONLY mode where a missing subject match stops capture.
            if ($config.CaptureMode -eq 'sender+subject+attachment' -and -not $subjectMatch) {
                Add-NonMatchSample -Reason 'subject mismatch (legacy sender+subject+attachment captureMode)' -Sender $from -Subject $subject
                continue
            }

            if (Test-ShouldSkipMessage -Item $item -SkipCategories $config.SkipCategories) {
                $status.skippedCount++
                $status.scanStats.skippedCategory++
                Add-NonMatchSample -Reason 'skipped category' -Sender $from -Subject $subject
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
                Add-NonMatchSample -Reason 'already processed' -Sender $from -Subject $subject
                continue
            }

            $attachments = $item.Attachments
            $attachmentCount = 0
            try { $attachmentCount = [int]$attachments.Count } catch {}
            Write-SyncLine ("  [capture] sender={0} attachments={1} subjectMatch={2} mode={3}" -f $from, $attachmentCount, $subjectMatch.ToString().ToLowerInvariant(), $config.CaptureMode)
            $savedAny = $false
            for ($i = 1; $i -le $attachments.Count; $i++) {
                if ($script:ShutdownRequested) { break }
                $att = $null
                try {
                    $att = $attachments.Item($i)
                    $fileName = Get-SafeFileName -Name ([string]$att.FileName)
                    if (-not (Test-SupportedExtension -FileName $fileName -SupportedExt $config.SupportedExt)) { continue }

                    # Name the saved file by patient + claim (identity first) so the reviewer can tell
                    # who a letter belongs to from the filename alone; the original ACC name is kept as
                    # a suffix and the extension is preserved. Bytes are unchanged (SaveAsFile writes
                    # the same content), so the folder-watch content SHA-256 dedup is unaffected. Still
                    # pass through Get-UniquePath so two genuinely different letters for the same
                    # patient/claim both survive (-1/-2) and nothing is overwritten.
                    $patientFileName = New-DescriptiveFileName -Subject $subject -OriginalFileName $fileName
                    $dest = Get-UniquePath -Dir $inbox -FileName $patientFileName
                    $att.SaveAsFile($dest)
                    $savedAny = $true
                    $status.savedCount++
                    $savedLeaf = [System.IO.Path]::GetFileName($dest)
                    $status.savedFiles += @{
                        fileName = $savedLeaf
                        subject  = $subject
                        sender   = $from
                        savedAt  = (Get-Date).ToUniversalTime().ToString('o')
                    }
                    # SHA-256 meta for folder-watch enrichment + launch.ps1 /_acc/inbox-file.
                    try {
                        $fileHash = Get-FileSha256Hex -FilePath $dest
                        Write-EmailSyncMeta -Inbox $inbox -Hash $fileHash -EntryId $entryId -Subject $subject -Sender $from -FileName $fileName -DescriptiveFileName $savedLeaf -RelativePath $savedLeaf -EmailDate $received
                    } catch {
                        Write-SyncLine ("  WARN - could not write .email-sync meta: {0}" -f $_.Exception.Message)
                    }
                    Write-SyncLine ("  [capture] saved as {0} <- {1}" -f $savedLeaf, (Get-TruncatedSubject $subject))
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
                Add-NonMatchSample -Reason 'no PDF/DOCX attachment' -Sender $from -Subject $subject
            }
        } catch {
            $status.errorCount++
            $syncState.runStats.totalErrors++
            $status.errors += $_.Exception.Message
            Write-SyncLine ("  ERROR: $($_.Exception.Message)")
            # A single failed item is logged and skipped (streak stays isolated). A RUN of
            # consecutive Exchange/COM read failures means the VPN/Exchange link dropped mid-scan,
            # so abort early instead of spamming ~1000 identical connection errors.
            if (Test-IsExchangeConnectionError -ErrorRecord $_) {
                $consecutiveComErrors++
                if ($consecutiveComErrors -ge $DefaultMaxConsecutiveComErrors) {
                    $connectionLost = $true
                    break
                }
            } else {
                $consecutiveComErrors = 0
            }
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
    if ($connectionLost) {
        $status.outcome = 'connection-lost'
    } elseif ($script:ShutdownRequested) {
        $status.outcome = 'paused'
    } else {
        $status.outcome = 'ok'
    }
    Write-SyncLine ''
    if ($connectionLost) {
        Write-SyncLine ("Outlook lost its connection to Exchange ({0} consecutive errors). Stopping. Reconnect the Citrix VPN and wait until Outlook shows 'Connected', then re-run. Tip: enable Cached Exchange Mode (File > Account Settings > double-click account > Use Cached Exchange Mode) so sync reads the local copy and survives VPN drops." -f $consecutiveComErrors)
    }
    if ($script:ShutdownRequested) {
        Write-SyncLine 'Stopped early  -  state saved for resume on next run.'
    }
    Write-SyncLine ("Done - saved {0} attachment(s) this run, skipped {1}, errors {2}, {3} total processed in state" -f $status.savedCount, $status.skippedCount, $status.errorCount, $status.processedTotal)
    if ($useBacklog -and $hitBatchLimit) {
        Write-SyncLine 'Backlog: batch limit reached  -  run again during work hours until saved count is 0.'
    }
    Write-SyncLine 'Next: Start Folder Watch.cmd stages new files -> Review Queue auto-imports (nothing auto-files to patients).'
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
    try {
        $statusPath = Write-SyncStatus -Status $status
        Write-SyncLine ''
        Write-ScanBreakdownSummary -Status $status -SkipReason $script:ScanSkipReason
        if (Test-Path -LiteralPath $statusPath) {
            Write-SyncLine "Status: $statusPath"
        } else {
            Write-SyncLine "WARN - email-sync-status.json missing after write attempt: $statusPath"
            Write-BootstrapLog "WARN - email-sync-status.json missing after finally write: $statusPath"
        }
    } catch {
        Write-SyncLine "WARN - could not write email-sync-status.json: $($_.Exception.Message)"
        Write-BootstrapLog "FAIL - finally Write-SyncStatus: $($_.Exception.Message)"
    }
    Write-SyncLine "State:  $($script:StatePath)"
    Write-SyncLine "Log:    $env:USERPROFILE\ACC-Suite\logs\email-sync-bootstrap.log"
    Write-SyncLine ''
}

if ($status.outcome -eq 'fail') { exit 1 }
