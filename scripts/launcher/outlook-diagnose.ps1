param(
    [string]$SharedMailbox = ''
)

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
    $skipCategories = @('actioned')
    $subjectMode = $DefaultSubjectMatchMode
    $requiredTokens = @($DefaultRequiredTokens)

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

    return @{
        Senders          = $senders
        Patterns         = $patterns
        SkipCategories   = $skipCategories
        SubjectMatchMode = $subjectMode
        RequiredTokens   = @($requiredTokens)
        ConfigPath       = $configPath
    }
}

function Get-AttachmentExtensions {
    param([object]$Item)
    $exts = New-Object System.Collections.Generic.List[string]
    try {
        $attachments = $Item.Attachments
        for ($i = 1; $i -le $attachments.Count; $i++) {
            $att = $null
            try {
                $att = $attachments.Item($i)
                $fileName = [string]$att.FileName
                $ext = [System.IO.Path]::GetExtension($fileName).ToLowerInvariant()
                if (-not [string]::IsNullOrWhiteSpace($ext) -and -not $exts.Contains($ext)) {
                    [void]$exts.Add($ext)
                }
            } finally {
                if ($att) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($att) }
            }
        }
    } catch {
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

function Explain-FilterResult {
    param(
        [string]$Sender,
        [string]$Subject,
        [string[]]$Allowlist,
        [string[]]$Patterns,
        [string[]]$SkipCategories,
        [string]$Categories
    )
    if (-not (Test-AccSender -FromAddress $Sender -Allowlist $Allowlist)) {
        return "sender mismatch ($Sender)"
    }
    if (-not (Test-AccSubject -Subject $Subject -Patterns $Patterns)) {
        return 'subject mismatch (needs Claim:/ACCID: or other pattern)'
    }
    if (-not [string]::IsNullOrWhiteSpace($Categories)) {
        foreach ($skip in $SkipCategories) {
            if ([string]::IsNullOrWhiteSpace($skip)) { continue }
            if ($Categories -match [regex]::Escape($skip)) {
                return "skipped category ($Categories)"
            }
        }
    }
    return 'would match sync filters'
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
Write-DiagLine ("Subject match mode: {0} (required tokens: {1})" -f $config.SubjectMatchMode, ($config.RequiredTokens -join ', '))
Write-DiagLine ''

$outlook = $null
try {
    Write-DiagLine 'Connecting to Outlook.Application COM object...'
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace('MAPI')
    [void]$namespace.Logon($null, $null, $false, $true)

    Write-DiagLine 'Visible stores:'
    foreach ($store in $namespace.Stores) {
        try {
            $display = [string]$store.DisplayName
            $hints = Get-StoreSmtpHint -Store $store
            $hintText = if ($hints.Count -gt 0) { ($hints | Select-Object -Unique) -join ' / ' } else { '(no SMTP hint)' }
            Write-DiagLine ("  - {0} [{1}]" -f $display, $hintText)
        } catch {
        }
    }
    Write-DiagLine ''

    $inbox = Get-SharedInboxFolder -Namespace $namespace -SharedName $SharedMailbox
    $resolution = Get-LastMailboxResolution
    $mailItems = Get-MailItemsCollection -Folder $inbox

    Write-DiagLine "OK - inbox resolved via: $resolution"
    Write-DiagLine "Inbox item count (all classes): $($inbox.Items.Count)"
    Write-DiagLine "Mail item count (IPM.Note / Restrict): $($mailItems.Count)"
    Write-DiagLine "Unread count: $($inbox.UnReadItemCount)"
    Write-DiagLine ''

    Write-DiagLine 'First 5 mail items (newest first):'
    $shown = 0
    $total = [int]$mailItems.Count
    for ($idx = 1; $idx -le $total; $idx++) {
        if ($shown -ge 5) { break }
        $item = $null
        try {
            $item = $mailItems.Item($idx)
            if ($item.Class -ne 43) { continue }

            $from = Get-SenderAddress -Item $item
            $subject = ''
            try { $subject = [string]$item.Subject } catch {}
            $cats = ''
            try { $cats = [string]$item.Categories } catch {}
            if ([string]::IsNullOrWhiteSpace($cats)) { $cats = '(none)' }
            $exts = Get-AttachmentExtensions -Item $item
            $senderOk = Test-AccSender -FromAddress $from -Allowlist $config.Senders
            $subjectOk = Test-AccSubject -Subject $subject -Patterns $config.Patterns
            $matchTag = if ($senderOk -and $subjectOk) { 'MATCH' } else { 'no-match' }
            $reason = Explain-FilterResult -Sender $from -Subject $subject -Allowlist $config.Senders -Patterns $config.Patterns -SkipCategories $config.SkipCategories -Categories $cats

            Write-DiagLine ("  {0}. [{1}] from={2}" -f ($shown + 1), $matchTag, $from)
            Write-DiagLine ("     subject: {0}" -f (Get-TruncatedSubject -Subject $subject))
            Write-DiagLine ("     attachments: {0}" -f $exts)
            Write-DiagLine ("     category: {0}" -f $cats)
            Write-DiagLine ("     filter: {0}" -f $reason)
            $shown++
        } finally {
            if ($item) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($item) }
        }
    }
    if ($shown -eq 0) {
        Write-DiagLine '  (no mail items found - inbox scan is empty)'
        Write-DiagLine '  Likely cause: shared mailbox not opened in Outlook or delegate access missing.'
    }
    Write-DiagLine ''

    Write-DiagLine 'Known sample filter test (John Bentley Claim/ACCID letter):'
    $sampleSenderOk = Test-AccSender -FromAddress $KnownSampleSender -Allowlist $config.Senders
    $sampleSubjectOk = Test-AccSubject -Subject $KnownSampleSubject -Patterns $config.Patterns
    Write-DiagLine ("  sender {0} -> {1}" -f $KnownSampleSender, $(if ($sampleSenderOk) { 'MATCH' } else { 'NO MATCH' }))
    Write-DiagLine ("  subject sample -> {0}" -f $(if ($sampleSubjectOk) { 'MATCH' } else { 'NO MATCH' }))
    if (-not $sampleSubjectOk) {
        Write-DiagLine '  FIX: ensure office-config includes Claim: and ACCID: in subject patterns.'
    }
    Write-DiagLine ''

    $matchCount = 0
    $senderOnlyCount = 0
    $modeMatchCount = 0
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

    for ($idx = 1; $idx -le $total; $idx++) {
        $item = $null
        try {
            $item = $mailItems.Item($idx)
            if ($item.Class -ne 43) { continue }
            $from = Get-SenderAddress -Item $item
            $subject = ''
            try { $subject = [string]$item.Subject } catch {}
            if (-not (Test-AccSender -FromAddress $from -Allowlist $config.Senders)) { continue }

            $senderOnlyCount++

            $hasClaim = Get-SubjectTokenPresence -Subject $subject -Token 'Claim'
            $hasAccid = Get-SubjectTokenPresence -Subject $subject -Token 'ACCID'
            if ($hasClaim -and $hasAccid) { $tokBoth++ }
            elseif ($hasClaim) { $tokClaim++ }
            elseif ($hasAccid) { $tokAccid++ }
            else { $tokNeither++ }

            # distinct extensions on this email (or 'none')
            $extText = Get-AttachmentExtensions -Item $item
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
        } finally {
            if ($item) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($item) }
        }
    }
    Write-DiagLine "Inbox totals: $senderOnlyCount sender match(es), $matchCount sender+subject match(es) [legacy 'any' patterns]"
    Write-DiagLine ("Would match under current mode '{0}': {1} email(s)" -f $config.SubjectMatchMode, $modeMatchCount)
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
    Write-DiagLine ''
    Write-DiagLine 'Diagnose complete. No files were saved.'
}
catch {
    Write-DiagLine ''
    Write-DiagLine ("FAIL - $($_.Exception.Message)")
    Write-DiagLine ''
    Write-DiagLine 'Common causes:'
    Write-DiagLine '  - Outlook desktop is not running'
    Write-DiagLine '  - Shared mailbox ACCDistrictNursing not added in Outlook'
    Write-DiagLine '  - Programmatic access blocked in Outlook Trust Center'
    exit 1
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
