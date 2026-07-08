param(
    [string]$SharedMailbox = ''
)

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'email-probe'
Write-BootstrapLog 'outlook-probe.ps1 started'

# ACC Outlook COM probe - read-only, work laptop only
#
# Proves Outlook desktop COM automation works on this PC.
# Lists inbox unread count + last 3 subject lines (no body, no attachments saved).
# Does NOT move, delete, or send mail.

$AccSenders = @(
    'Bec.Williams@acc.co.nz',
    'John.Bentley@acc.co.nz',
    'Becky.Tunnell@acc.co.nz'
)

function Write-ProbeLine {
    param([string]$Message)
    Write-Host $Message
    Write-BootstrapLog $Message
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

function Get-TruncatedSubject {
    param([string]$Subject, [int]$MaxLen = 80)
    if ([string]::IsNullOrWhiteSpace($Subject)) { return '(empty subject)' }
    $oneLine = ($Subject -replace '\s+', ' ').Trim()
    if ($oneLine.Length -le $MaxLen) { return $oneLine }
    return $oneLine.Substring(0, $MaxLen) + '...'
}

function Test-AccSender {
    param([string]$FromAddress)
    if ([string]::IsNullOrWhiteSpace($FromAddress)) { return $false }
    foreach ($sender in $AccSenders) {
        if ($FromAddress -match [regex]::Escape($sender)) { return $true }
    }
    return $false
}

Write-ProbeLine ''
Write-ProbeLine 'ACC Outlook COM probe (read-only)'
Write-ProbeLine '================================='
Write-ProbeLine ''

if (-not [string]::IsNullOrWhiteSpace($env:ACC_SHARED_MAILBOX)) {
    $SharedMailbox = $env:ACC_SHARED_MAILBOX
}

$outlook = $null
try {
    Write-ProbeLine 'Connecting to Outlook.Application COM object...'
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace('MAPI')
    [void]$namespace.Logon($null, $null, $false, $true)

    $inbox = Get-InboxFolder -Namespace $namespace -SharedName $SharedMailbox
    $label = if ([string]::IsNullOrWhiteSpace($SharedMailbox)) { 'Default inbox' } else { "Shared inbox: $SharedMailbox" }

    Write-ProbeLine "OK - COM connected ($label)"
    Write-ProbeLine "Unread count: $($inbox.UnReadItemCount)"
    Write-ProbeLine ''

    $items = $inbox.Items
    $items.Sort('[ReceivedTime]', $true)

    Write-ProbeLine 'Last 3 messages (subject only - may contain patient names):'
    $shown = 0
    foreach ($item in $items) {
        if ($shown -ge 3) { break }
        try {
            if ($item.Class -ne 43) { continue }
            $subject = Get-TruncatedSubject -Subject ([string]$item.Subject)
            $from = ''
            try { $from = [string]$item.SenderEmailAddress } catch {}
            $accTag = if (Test-AccSender -FromAddress $from) { ' [ACC sender]' } else { '' }
            Write-ProbeLine ("  {0}. {1}{2}" -f ($shown + 1), $subject, $accTag)
            $shown++
        } finally {
            if ($item) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($item) }
        }
    }
    if ($shown -eq 0) {
        Write-ProbeLine '  (no mail items found in inbox)'
    }

    Write-ProbeLine ''
    Write-ProbeLine 'ACC sender filter test (count only, no subjects listed):'
    $accCount = 0
    foreach ($item in $items) {
        try {
            if ($item.Class -ne 43) { continue }
            $from = ''
            try { $from = [string]$item.SenderEmailAddress } catch {}
            if (Test-AccSender -FromAddress $from) { $accCount++ }
        } finally {
            if ($item) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($item) }
        }
    }
    Write-ProbeLine "  Messages from ACC allowlist senders in inbox: $accCount"
    Write-ProbeLine ''
    Write-ProbeLine 'PASS - Outlook COM read works on this PC.'
    Write-ProbeLine 'Next: engineering can wire P8-017 (save ACC attachments to ACC-Inbox).'
}
catch {
    Write-ProbeLine ''
    Write-ProbeLine ("FAIL - $($_.Exception.Message)")
    Write-ProbeLine ''
    Write-ProbeLine 'Common causes:'
    Write-ProbeLine '  - Outlook desktop is not running (open it and retry)'
    Write-ProbeLine '  - IT blocked programmatic access (Outlook Trust Center -> Programmatic Access)'
    Write-ProbeLine '  - PowerShell blocked by Group Policy'
    Write-ProbeLine ''
    Write-ProbeLine 'Fallback: manual Outlook rule -> copy ACC letters to %USERPROFILE%\ACC-Inbox'
    Write-ProbeLine '          then use Start Folder Watch.cmd (already works, no COM needed).'
    exit 1
}
finally {
    if ($outlook) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook)
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}

Write-ProbeLine ''
Write-ProbeLine "Log: $env:USERPROFILE\ACC-Suite\logs\email-probe-bootstrap.log"
Write-ProbeLine ''
