param(
    [string]$SharedMailbox = '',
    # OFF by default. Enumerating $namespace.Stores (even just reading DisplayName)
    # can force Outlook to bind the slow Exchange "Public Folders" store (~20 min).
    # The default double-click run never iterates Stores; pass -ListStores only for
    # advanced diagnostics, and even then Public Folders is listed but never opened.
    [switch]$ListStores,
    # Bounded, newest-first histogram sample size. The diagnose does NOT need to scan
    # every message: a representative newest-N sample produces the same token /
    # attachment histograms while capping runtime AND hang exposure. A single toxic
    # message (e.g. a cloud/online attachment whose FileName read blocks Outlook for
    # minutes) can only ever stall the run if the scan reaches it - a small default
    # keeps that window tiny. Pass a larger value to opt into a wider scan.
    [int]$MaxScan = 400
)
if ($MaxScan -lt 1) { $MaxScan = 1 }

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'email-diagnose'
. (Join-Path $bootstrapRoot 'mailbox-config.ps1')
Write-BootstrapLog 'outlook-diagnose.ps1 started'

# ACC Outlook COM diagnose - read-only
# Shows inbox resolution, item counts, sender/subject/attachment/category samples,
# and whether known ACC letter filters would match. Does NOT save files.

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

$KnownSampleSender = 'John.Bentley@acc.co.nz'
$KnownSampleSubject = 'Mr R... - Claim: ... ACCID:VEND-K96655'
$DefaultSubjectMatchMode = 'tokens'
$DefaultRequiredTokens = @('Claim', 'ACCID')
# Attachment extensions treated as "supported" (same as outlook-sync.ps1). Case-insensitive.
$DefaultSupportedExt = @('.pdf', '.docx', '.doc')
# Capture decision mode (mirrors outlook-sync.ps1). Default 'attachment' = sender + supported
# attachment (subject optional). See Explain-FilterResult / Test-CaptureVerdict.
$DefaultCaptureMode = 'attachment'
# Heartbeat cadence: log an "emails processed" progress line every N messages so a
# truncated screenshot still shows "still working" vs "stopped/hung".
$HeartbeatEvery = 100

# Words kept visible when masking subjects (structural / filter tokens, never PHI).
$script:MaskKeepWords = @(
    'claim', 'accid', 'acc', 'ref', 'vend', 'po', 'nur', 'id', 'no', 'number',
    'letter', 'purchase', 'order', 'approval', 'approved', 'declined', 'decline',
    're', 'fw', 'fwd'
)

function Write-DiagLine {
    param([string]$Message)
    Write-Host $Message
    Write-BootstrapLog $Message
}

# PHI-safe subject mask: digits -> #, capitalised name-like words -> Xxxxx,
# structural tokens (Claim:, ACCID:, etc.) kept visible so we can see the real format.
function Get-MaskedSubject {
    param([string]$Subject)
    if ([string]::IsNullOrWhiteSpace($Subject)) { return '(empty subject)' }
    $oneLine = ($Subject -replace '\s+', ' ').Trim()
    $words = $oneLine -split ' '
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($w in $words) {
        if ([string]::IsNullOrEmpty($w)) { continue }
        $bare = ($w -replace '[^A-Za-z]', '')
        $isKeep = $false
        if (-not [string]::IsNullOrEmpty($bare) -and ($script:MaskKeepWords -contains $bare.ToLowerInvariant())) {
            $isKeep = $true
        }
        if ($isKeep) {
            # keep the word (and its token colon) but mask any digits
            [void]$out.Add(($w -replace '\d', '#'))
        } elseif ($w -cmatch '^[A-Z][a-z]+$') {
            # Capitalised name-like word (Gilbert, Gandor) -> Xxxxx
            [void]$out.Add('Xxxxx')
        } else {
            # everything else: mask digits, preserve punctuation/structure
            [void]$out.Add(($w -replace '\d', '#'))
        }
    }
    return ($out -join ' ')
}

function Get-TruncatedSubject {
    param([string]$Subject, [int]$MaxLen = 80)
    if ([string]::IsNullOrWhiteSpace($Subject)) { return '(empty subject)' }
    $oneLine = ($Subject -replace '\s+', ' ').Trim()
    if ($oneLine.Length -le $MaxLen) { return $oneLine }
    return $oneLine.Substring(0, $MaxLen) + '...'
}

function Load-DiagnoseFilterConfig {
    $senders = @($DefaultSenders)
    $patterns = @($DefaultSubjectPatterns)
    $skipCategories = @()
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
            if ($mergedSenders.Count -gt 0) {
                $senders = Merge-UniqueStringList -Values $mergedSenders
            }
            if ($cfg.accInbox -and $cfg.accInbox.subjectPatterns) {
                $mergedPatterns += @($cfg.accInbox.subjectPatterns)
            }
            if ($cfg.settings -and $cfg.settings.accInboxSubjectPatterns) {
                $mergedPatterns += @($cfg.settings.accInboxSubjectPatterns)
            }
            if ($mergedPatterns.Count -gt 0) {
                $patterns = Merge-UniqueStringList -Values $mergedPatterns
            }
            if ($cfg.emailSync -and $cfg.emailSync.skipCategories) {
                $skipCategories = @($cfg.emailSync.skipCategories)
            }
            if ($cfg.emailSync -and -not [string]::IsNullOrWhiteSpace([string]$cfg.emailSync.subjectMatchMode)) {
                $subjectMode = [string]$cfg.emailSync.subjectMatchMode
            }
            if ($cfg.emailSync -and $cfg.emailSync.requiredTokens) {
                $tokList = @($cfg.emailSync.requiredTokens | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
                if ($tokList.Count -gt 0) { $requiredTokens = $tokList }
            }
            if ($cfg.emailSync -and $cfg.emailSync.attachmentExtensions) {
                $extList = @($cfg.emailSync.attachmentExtensions | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
                if ($extList.Count -gt 0) { $supportedExt = $extList }
            }
            if ($cfg.emailSync -and -not [string]::IsNullOrWhiteSpace([string]$cfg.emailSync.captureMode)) {
                $captureMode = [string]$cfg.emailSync.captureMode
            }
        } catch {
            Write-DiagLine "WARN - could not parse office config: $($_.Exception.Message)"
        }
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
        SubjectMatchMode = $subjectMode
        RequiredTokens   = @($requiredTokens)
        SupportedExt     = @($supportedExt)
        CaptureMode      = $captureMode
        ConfigPath       = $configPath
    }
}

# Does an extension-list string (e.g. ".pdf, .docx" or "(none)") contain a supported type?
# Uses the same Test-SupportedExtension helper the sync save path uses (case-insensitive).
function Test-ExtListHasSupported {
    param(
        [string]$ExtText,
        [string[]]$SupportedExt
    )
    if ([string]::IsNullOrWhiteSpace($ExtText) -or $ExtText -eq '(none)') { return $false }
    foreach ($e in ($ExtText -split ',\s*')) {
        $k = $e.Trim()
        if ([string]::IsNullOrWhiteSpace($k)) { continue }
        if (-not $k.StartsWith('.')) { $k = '.' + $k }
        if (Test-SupportedExtension -FileName ('file' + $k) -SupportedExt $SupportedExt) { return $true }
    }
    return $false
}

# Histogram-only attachment read: FILENAME METADATA ONLY. We read attachment.FileName
# to get the extension and never call SaveAsFile / read attachment bytes, so no
# content is downloaded (a cloud/online attachment can still block on the FileName
# read, hence the per-attachment try/catch + the caller's bounded sample). One bad
# message logs "attachment read skipped (item i)" and the scan continues.
function Get-AttachmentExtensions {
    param(
        [object]$Item,
        [int]$ItemIndex = 0
    )
    $exts = New-Object System.Collections.Generic.List[string]
    try {
        $attachments = $Item.Attachments
        $attCount = 0
        try { $attCount = [int]$attachments.Count } catch { $attCount = 0 }
        for ($i = 1; $i -le $attCount; $i++) {
            $att = $null
            try {
                $att = $attachments.Item($i)
                # FileName is cheap metadata; never SaveAsFile / read bytes here.
                $fileName = [string]$att.FileName
                $ext = [System.IO.Path]::GetExtension($fileName).ToLowerInvariant()
                if (-not [string]::IsNullOrWhiteSpace($ext) -and -not $exts.Contains($ext)) {
                    [void]$exts.Add($ext)
                }
            } catch {
                Write-BootstrapLog ("WARN - attachment read skipped (item {0}, attachment {1}): {2}" -f $ItemIndex, $i, $_.Exception.Message)
            } finally {
                if ($att) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($att) }
            }
        }
    } catch {
        Write-BootstrapLog ("WARN - attachment read skipped (item {0}): {1}" -f $ItemIndex, $_.Exception.Message)
    }
    if ($exts.Count -eq 0) { return '(none)' }
    return ($exts.ToArray() -join ', ')
}

function Get-MailItemsCollection {
    param([object]$Folder)
    $items = $Folder.Items
    $items.Sort('[ReceivedTime]', $true)
    try {
        $restricted = $items.Restrict("[MessageClass] = 'IPM.Note'")
        if ($restricted -and $restricted.Count -gt 0) {
            return $restricted
        }
    } catch {
    }
    return $items
}

# Verdict that MATCHES what outlook-sync.ps1 will actually do (capture + save), so diagnose and
# sync never disagree. New capture rule (default captureMode 'attachment'): sender + >=1 supported
# attachment (.pdf/.docx/.doc); subject is only a confidence hint, NOT a required gate. Legacy
# 'sender+subject+attachment' captureMode still requires the subject match. A file only ever SAVES
# when a supported attachment exists, so "no supported attachment" always means "nothing to save".
function Explain-FilterResult {
    param(
        [string]$Sender,
        [string]$Subject,
        [string[]]$Allowlist,
        [string[]]$Patterns,
        [string[]]$SkipCategories,
        [string]$Categories,
        [bool]$HasSupportedAttachment = $false,
        [bool]$SubjectMatch = $false,
        [string]$CaptureMode = 'attachment'
    )
    if (-not (Test-AccSender -FromAddress $Sender -Allowlist $Allowlist)) {
        return "sender mismatch ($Sender)"
    }
    if ($CaptureMode -eq 'sender+subject+attachment' -and -not $SubjectMatch) {
        return 'subject mismatch (legacy sender+subject+attachment captureMode)'
    }
    if (-not [string]::IsNullOrWhiteSpace($Categories)) {
        foreach ($skip in $SkipCategories) {
            if ([string]::IsNullOrWhiteSpace($skip)) { continue }
            if ($Categories -match [regex]::Escape($skip)) {
                return "skipped category ($Categories)"
            }
        }
    }
    if (-not $HasSupportedAttachment) {
        return 'no supported attachment (.pdf/.docx/.doc) - nothing to save'
    }
    return 'would match sync filters (sender + supported attachment)'
}

Write-DiagLine ''
Write-DiagLine 'ACC Outlook email diagnose (read-only)'
Write-DiagLine '===================================='
Write-DiagLine ''

$SharedMailbox = Resolve-SharedMailbox -Override $SharedMailbox
$config = Load-DiagnoseFilterConfig
Write-DiagLine "Using mailbox: $SharedMailbox"
if ($config.ConfigPath) {
    Write-DiagLine "Office config: $($config.ConfigPath)"
} else {
    Write-DiagLine 'Office config: (not found - using built-in defaults)'
}
Write-DiagLine ("Merged filters: {0} sender(s), {1} subject pattern(s)" -f $config.Senders.Count, $config.Patterns.Count)
Write-DiagLine ("Subject patterns: {0}" -f ($config.Patterns -join ' | '))
Write-DiagLine ("Subject match mode (hint): {0} (required tokens: {1})" -f $config.SubjectMatchMode, ($config.RequiredTokens -join ', '))
Write-DiagLine ("Capture mode: {0} (default 'attachment' = sender + supported attachment; subject optional)" -f $config.CaptureMode)
Write-DiagLine ("Supported attachment types: {0}" -f ($config.SupportedExt -join ', '))
Write-DiagLine ''

$outlook = $null
$script:DiagExitCode = 0
$reportProduced = $false
try {
    Write-DiagLine 'Connecting to Outlook.Application COM object...'
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace('MAPI')
    [void]$namespace.Logon($null, $null, $false, $true)

    # --- Optional visible-stores listing (OFF by default, -ListStores opt-in) ---
    # We NEVER iterate $namespace.Stores in the normal path: on this mailbox even
    # reading Store.DisplayName can force Outlook to bind the Exchange "Public
    # Folders" store, which blocks ~20 MINUTES (also "Online Archive", "NonNZResident
    # Admin" are toxic here). Sync never touches Stores - it resolves ACCDistrictNursing
    # directly via CreateRecipient + GetSharedDefaultFolder - so diagnose does the same.
    # This listing runs ONLY when the user passes -ListStores, and even then each store
    # access is wrapped in try/catch and any "Public Folders" store is skipped untouched.
    if ($ListStores) {
        Write-DiagLine 'Visible stores (name only - not opened; -ListStores opt-in):'
        try {
            foreach ($store in $namespace.Stores) {
                $display = ''
                try { $display = [string]$store.DisplayName } catch {}
                if ([string]::IsNullOrWhiteSpace($display)) {
                    Write-DiagLine '  - (unnamed store)'
                    continue
                }
                if ($display -match 'Public Folders') {
                    # Known-slow Exchange store: list the name but never open/touch it.
                    Write-DiagLine ("  - {0} (skipped - not opened; known-slow store)" -f $display)
                } else {
                    Write-DiagLine ("  - {0}" -f $display)
                }
            }
        } catch {
            Write-DiagLine ("WARN - could not list stores: {0} (line {1})" -f $_.Exception.Message, $_.InvocationInfo.ScriptLineNumber)
        }
        Write-DiagLine ''
    }

    # --- Resolve target inbox folder DIRECTLY (no store enumeration) -----------
    # Reuse the SAME helper outlook-sync.ps1 uses (Get-SharedInboxFolder /
    # Get-LastMailboxResolution): CreateRecipient + Resolve + GetSharedDefaultFolder.
    # For the default ACCDistrictNursing mailbox this returns before any Stores
    # iteration, so it can never trigger the slow Public Folders bind that stalls
    # the run. If it throws or returns null, log the exact error and exit non-zero
    # WITHOUT enumerating stores.
    Write-DiagLine ("Resolving mailbox {0} directly (store enumeration skipped to avoid slow Public Folders bind)..." -f $SharedMailbox)
    $inbox = $null
    $resolution = ''
    try {
        $inbox = Get-SharedInboxFolder -Namespace $namespace -SharedName $SharedMailbox
        $resolution = Get-LastMailboxResolution
    } catch {
        Write-DiagLine ("FAIL - could not resolve inbox folder for '{0}': {1} (line {2})" -f $SharedMailbox, $_.Exception.Message, $_.InvocationInfo.ScriptLineNumber)
        Write-DiagLine '  FIX: add the ACCDistrictNursing shared mailbox in Outlook (File > Account Settings), enable programmatic access in Trust Center, or set emailSync.sharedMailbox in office-config.'
        Write-BootstrapLog ("FAIL - inbox resolution failed for '{0}': {1} (line {2})" -f $SharedMailbox, $_.Exception.Message, $_.InvocationInfo.ScriptLineNumber)
        throw ("inbox resolution failed for '{0}': {1}" -f $SharedMailbox, $_.Exception.Message)
    }
    if (-not $inbox) {
        Write-DiagLine ("FAIL - Get-SharedInboxFolder returned null for '{0}' (no folder to inspect)" -f $SharedMailbox)
        Write-DiagLine '  FIX: add the ACCDistrictNursing shared mailbox in Outlook (File > Account Settings), enable programmatic access in Trust Center, or set emailSync.sharedMailbox in office-config.'
        Write-BootstrapLog ("FAIL - Get-SharedInboxFolder returned null for '{0}'" -f $SharedMailbox)
        throw ("Get-SharedInboxFolder returned null for '{0}'" -f $SharedMailbox)
    }

    $folderName = ''
    try { $folderName = [string]$inbox.Name } catch {}
    if ([string]::IsNullOrWhiteSpace($folderName)) { $folderName = 'Inbox' }
    Write-DiagLine ("OK - inbox resolved via: {0}" -f $resolution)

    # --- Build the mail-item collection (guarded; never abort the whole run) ---
    $mailItems = $null
    try {
        $mailItems = Get-MailItemsCollection -Folder $inbox
    } catch {
        Write-DiagLine ("WARN - could not build restricted collection ({0}); falling back to folder.Items" -f $_.Exception.Message)
        try { $mailItems = $inbox.Items } catch {
            Write-DiagLine ("WARN - could not read folder.Items either: {0}" -f $_.Exception.Message)
        }
    }

    $allCount = 0
    try { $allCount = [int]$inbox.Items.Count } catch {}
    $unread = 0
    try { $unread = [int]$inbox.UnReadItemCount } catch {}
    $total = 0
    if ($mailItems) { try { $total = [int]$mailItems.Count } catch { $total = 0 } }

    # Progress line requested: emit the moment the folder is resolved + total known,
    # BEFORE the scan loop, so a truncated log still proves we got past resolution.
    Write-BootstrapLog ("Scanning folder '{0}' - {1} messages total" -f $folderName, $total)

    Write-DiagLine ("Inbox item count (all classes): {0}" -f $allCount)
    Write-DiagLine ("Mail item count (IPM.Note / Restrict): {0}" -f $total)
    Write-DiagLine ("Unread count: {0}" -f $unread)

    $scanTotal = if ($total -gt $MaxScan) { $MaxScan } else { $total }
    Write-DiagLine ("Sampling newest {0} of {1} messages for histograms (use -MaxScan to change)" -f $scanTotal, $total)
    Write-BootstrapLog ("Sampling newest {0} of {1} messages for histograms (use -MaxScan to change)" -f $scanTotal, $total)
    Write-DiagLine ''

    # --- Single bounded pass: preview (first 5) + histograms + heartbeats ------
    $shown = 0
    $scanned = 0
    $matchCount = 0
    $senderOnlyCount = 0
    $modeMatchCount = 0
    # True capture count under the new rule: sender-matched emails that ALSO have >=1 supported
    # attachment (.pdf/.docx/.doc). This is what sync will actually save under default captureMode.
    $senderWithAttachmentCount = 0
    # Token presence histogram (colon-optional) among sender-matched emails.
    $tokClaim = 0
    $tokAccid = 0
    $tokBoth = 0
    $tokNeither = 0
    # Attachment extension histogram (distinct ext per email) among sender-matched emails.
    $extHist = @{}
    # Masked samples of sender-matched but subject-REJECTED (legacy pattern) emails.
    $rejectSamples = New-Object System.Collections.Generic.List[string]
    $maxRejectSamples = 6

    # Time the bounded scan so we can confirm it stays fast (was ~0.5-0.9s/msg with
    # a catastrophic multi-minute hang on one message's attachment access before the
    # bounded-sample + cheap-read fix).
    $scanStopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    Write-DiagLine 'First 5 mail items (newest first):'
    for ($idx = 1; $idx -le $scanTotal; $idx++) {
        $item = $null
        try {
            $item = $mailItems.Item($idx)
            if ($item.Class -ne 43) { continue }

            # Each per-message COM read is individually guarded and logs the item
            # index on failure so one toxic message degrades to safe defaults and the
            # scan keeps going (PS 5.1 has no per-COM-call timeout; the mitigation is
            # bounded sample + cheapest-possible property reads + skip-on-error).
            $from = ''
            try { $from = Get-SenderAddress -Item $item } catch {
                Write-BootstrapLog ("WARN - sender read skipped (item {0}): {1}" -f $idx, $_.Exception.Message)
            }
            $subject = ''
            try { $subject = [string]$item.Subject } catch {
                Write-BootstrapLog ("WARN - subject read skipped (item {0}): {1}" -f $idx, $_.Exception.Message)
            }
            $senderOk = $false
            try { $senderOk = Test-AccSender -FromAddress $from -Allowlist $config.Senders } catch {}

            # Attachment extensions are needed for the preview (first 5) and for the
            # histogram (sender-matched). Compute once per item, only when needed.
            # FILENAME METADATA ONLY - no content is downloaded (see Get-AttachmentExtensions).
            $extText = $null
            if ($shown -lt 5 -or $senderOk) { $extText = Get-AttachmentExtensions -Item $item -ItemIndex $idx }

            # Supported-attachment presence drives the new capture verdict (sender + attachment).
            # Computed from the already-read $extText (filename metadata only - no bytes downloaded).
            $hasSupported = $false
            if ($null -ne $extText) { $hasSupported = Test-ExtListHasSupported -ExtText $extText -SupportedExt $config.SupportedExt }
            # Subject match for the CAPTURE verdict uses the same Test-AccSubjectMode as sync.
            $subjectModeOk = $false
            try { $subjectModeOk = Test-AccSubjectMode -Subject $subject -Patterns $config.Patterns -Mode $config.SubjectMatchMode -RequiredTokens $config.RequiredTokens } catch {}

            if ($shown -lt 5) {
                $cats = ''
                try { $cats = [string]$item.Categories } catch {}
                if ([string]::IsNullOrWhiteSpace($cats)) { $cats = '(none)' }
                $reason = Explain-FilterResult -Sender $from -Subject $subject -Allowlist $config.Senders -Patterns $config.Patterns -SkipCategories $config.SkipCategories -Categories $cats -HasSupportedAttachment $hasSupported -SubjectMatch $subjectModeOk -CaptureMode $config.CaptureMode
                $matchTag = if ($reason -like 'would match*') { 'MATCH' } else { 'no-match' }
                Write-DiagLine ("  {0}. [{1}] from={2}" -f ($shown + 1), $matchTag, $from)
                Write-DiagLine ("     subject: {0}" -f (Get-TruncatedSubject -Subject $subject))
                Write-DiagLine ("     attachments: {0}" -f $extText)
                Write-DiagLine ("     category: {0}" -f $cats)
                Write-DiagLine ("     filter: {0}" -f $reason)
                $shown++
            }

            if ($senderOk) {
                $senderOnlyCount++
                if ($hasSupported) { $senderWithAttachmentCount++ }

                $hasClaim = Get-SubjectTokenPresence -Subject $subject -Token 'Claim'
                $hasAccid = Get-SubjectTokenPresence -Subject $subject -Token 'ACCID'
                if ($hasClaim -and $hasAccid) { $tokBoth++ }
                elseif ($hasClaim) { $tokClaim++ }
                elseif ($hasAccid) { $tokAccid++ }
                else { $tokNeither++ }

                if ($extText -eq '(none)') {
                    if ($extHist.ContainsKey('none')) { $extHist['none']++ } else { $extHist['none'] = 1 }
                } else {
                    foreach ($e in ($extText -split ',\s*')) {
                        $key = $e.Trim().TrimStart('.')
                        if ([string]::IsNullOrWhiteSpace($key)) { continue }
                        if ($extHist.ContainsKey($key)) { $extHist[$key]++ } else { $extHist[$key] = 1 }
                    }
                }

                $legacyOk = Test-AccSubject -Subject $subject -Patterns $config.Patterns
                if ($legacyOk) { $matchCount++ }
                if (Test-AccSubjectMode -Subject $subject -Patterns $config.Patterns -Mode $config.SubjectMatchMode -RequiredTokens $config.RequiredTokens) {
                    $modeMatchCount++
                }
                if (-not $legacyOk -and $rejectSamples.Count -lt $maxRejectSamples) {
                    [void]$rejectSamples.Add((Get-MaskedSubject -Subject $subject))
                }
            }
        } catch {
            # One bad message never aborts the scan; log it and keep going.
            Write-BootstrapLog ("WARN - scan error on item {0}: {1} (line {2})" -f $idx, $_.Exception.Message, $_.InvocationInfo.ScriptLineNumber)
        } finally {
            if ($item) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($item) }
            $scanned++
            # Heartbeat: proves the script is still working (vs stopped/hung) even if
            # the report below fails. Written straight to the bootstrap log.
            if ($scanned % $HeartbeatEvery -eq 0) {
                Write-BootstrapLog ("Processed {0}/{1} (sender-matched: {2}, with supported attachment: {3}, subject-matched: {4})" -f $scanned, $scanTotal, $senderOnlyCount, $senderWithAttachmentCount, $modeMatchCount)
            }
        }
    }
    $scanStopwatch.Stop()
    $scanSeconds = [math]::Round($scanStopwatch.Elapsed.TotalSeconds, 1)
    Write-BootstrapLog ("Processed {0} messages total (sender-matched: {1}, with supported attachment: {2}, subject-matched: {3})" -f $scanned, $senderOnlyCount, $senderWithAttachmentCount, $modeMatchCount)
    Write-DiagLine ("Scanned {0} of {1} message(s) in {2}s." -f $scanned, $total, $scanSeconds)
    Write-BootstrapLog ("Scan elapsed: {0}s for {1} message(s)" -f $scanSeconds, $scanned)

    if ($shown -eq 0) {
        Write-DiagLine '  (no mail items found - inbox scan is empty)'
        Write-DiagLine '  Likely cause: shared mailbox not opened in Outlook or delegate access missing.'
    }
    Write-DiagLine ''

    # --- Report (always logged, bounded by clear markers) ----------------------
    Write-DiagLine '===== DIAGNOSE REPORT BEGIN ====='
    try {
        Write-DiagLine 'Known sample filter test (John Bentley Claim/ACCID letter):'
        $sampleSenderOk = Test-AccSender -FromAddress $KnownSampleSender -Allowlist $config.Senders
        $sampleSubjectOk = Test-AccSubject -Subject $KnownSampleSubject -Patterns $config.Patterns
        Write-DiagLine ("  sender {0} -> {1}" -f $KnownSampleSender, $(if ($sampleSenderOk) { 'MATCH' } else { 'NO MATCH' }))
        Write-DiagLine ("  subject sample -> {0}" -f $(if ($sampleSubjectOk) { 'MATCH' } else { 'NO MATCH' }))
        if (-not $sampleSubjectOk) {
            Write-DiagLine '  FIX: ensure office-config includes Claim: and ACCID: in subject patterns.'
        }
        Write-DiagLine ''
        Write-DiagLine ("Inbox totals (of {0} scanned): {1} sender match(es), {2} sender+subject match(es) [legacy 'any' patterns]" -f $scanned, $senderOnlyCount, $matchCount)
        Write-DiagLine ("Subject-token match (hint) under mode '{0}': {1} email(s)" -f $config.SubjectMatchMode, $modeMatchCount)
        Write-DiagLine ("TRUE CAPTURE COUNT under capture mode '{0}': {1} sender-matched email(s) with >=1 supported attachment (.pdf/.docx/.doc) - this is what sync will save (subject optional)" -f $config.CaptureMode, $senderWithAttachmentCount)
        Write-DiagLine ''
        Write-DiagLine 'Token presence among sender-matched emails (colon-optional, case-insensitive):'
        Write-DiagLine ("  Claim only: {0}  |  ACCID only: {1}  |  BOTH: {2}  |  NEITHER: {3}" -f $tokClaim, $tokAccid, $tokBoth, $tokNeither)
        Write-DiagLine ''
        Write-DiagLine 'Attachment extension histogram among sender-matched emails:'
        if ($extHist.Count -eq 0) {
            Write-DiagLine '  (no sender-matched emails)'
        } else {
            $extLine = (($extHist.GetEnumerator() | Sort-Object -Property Value -Descending | ForEach-Object { "{0}:{1}" -f $_.Key, $_.Value }) -join '  ')
            Write-DiagLine ("  {0}" -f $extLine)
        }
        Write-DiagLine ''
        Write-DiagLine 'Masked sample subjects (sender-matched but subject REJECTED by legacy patterns):'
        Write-DiagLine '  (digits -> #, names -> Xxxxx, filter tokens like Claim:/ACCID: kept visible)'
        if ($rejectSamples.Count -eq 0) {
            Write-DiagLine '  (none - every sender-matched email also matched the subject patterns)'
        } else {
            foreach ($s in $rejectSamples) {
                Write-DiagLine ("  - {0}" -f $s)
            }
        }
        $reportProduced = $true
    } catch {
        Write-DiagLine ("WARN - report section error: {0} (line {1})" -f $_.Exception.Message, $_.InvocationInfo.ScriptLineNumber)
        Write-BootstrapLog ("WARN - report section error: {0} (line {1})" -f $_.Exception.Message, $_.InvocationInfo.ScriptLineNumber)
    }
    Write-DiagLine '===== DIAGNOSE REPORT END ====='
    Write-DiagLine ''
    Write-DiagLine 'Diagnose complete. No files were saved.'
}
catch {
    Write-DiagLine ''
    Write-DiagLine ("FAIL - {0} (line {1})" -f $_.Exception.Message, $_.InvocationInfo.ScriptLineNumber)
    Write-BootstrapLog ("FAIL - diagnose error: {0} (line {1})" -f $_.Exception.Message, $_.InvocationInfo.ScriptLineNumber)
    Write-DiagLine ''
    Write-DiagLine 'Common causes:'
    Write-DiagLine '  - Outlook desktop is not running'
    Write-DiagLine '  - Shared mailbox ACCDistrictNursing not added in Outlook'
    Write-DiagLine '  - Programmatic access blocked in Outlook Trust Center'
    # Only fail hard if we could not produce the report at all.
    if (-not $reportProduced) { $script:DiagExitCode = 1 }
}
finally {
    if ($outlook) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook)
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}

Write-DiagLine ''
Write-DiagLine "Log: $env:USERPROFILE\ACC-Suite\logs\email-diagnose-bootstrap.log"
Write-DiagLine ''

if ($script:DiagExitCode -ne 0) { exit $script:DiagExitCode }
