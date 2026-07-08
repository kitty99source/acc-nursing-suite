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

function Write-DiagLine {
    param([string]$Message)
    Write-Host $Message
    Write-BootstrapLog $Message
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

    $configPath = Get-OfficeConfigPath
    if ($configPath) {
        try {
            $raw = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
            $cfg = $raw | ConvertFrom-Json
            $mergedSenders = @()
            $mergedPatterns = @()
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
        } catch {
            Write-DiagLine "WARN - could not parse office config: $($_.Exception.Message)"
        }
    }

    return @{
        Senders        = $senders
        Patterns       = $patterns
        SkipCategories = $skipCategories
        ConfigPath     = $configPath
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
    for ($idx = 1; $idx -le $total; $idx++) {
        $item = $null
        try {
            $item = $mailItems.Item($idx)
            if ($item.Class -ne 43) { continue }
            $from = Get-SenderAddress -Item $item
            $subject = ''
            try { $subject = [string]$item.Subject } catch {}
            if (Test-AccSender -FromAddress $from -Allowlist $config.Senders) {
                $senderOnlyCount++
                if (Test-AccSubject -Subject $subject -Patterns $config.Patterns) {
                    $matchCount++
                }
            }
        } finally {
            if ($item) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($item) }
        }
    }
    Write-DiagLine "Inbox totals: $senderOnlyCount sender match(es), $matchCount sender+subject match(es)"
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
