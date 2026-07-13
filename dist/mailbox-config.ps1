# Shared mailbox resolution for Outlook COM scripts (sync + probe + diagnose).
# Priority: CLI override > office-config.json > ACC_SHARED_MAILBOX env > ACCDistrictNursing default.
#
# COM-SAFE CONNECT (same rules as Loan Eq / Dump-LoanEqFolder.ps1):
#   - Attach to the ALREADY-RUNNING Outlook via Marshal.GetActiveObject.
#   - Fall back to New-Object ONLY when Outlook is not running AND we are not elevated
#     (or when Outlook is running as the same user and GetActiveObject flaked).
#   - NEVER Logon with NewSession=$true (a 2nd MAPI session OOMs / hangs).
#   - Elevation mismatch (admin script + normal-user Outlook) must throw a clear message,
#     not silently spawn a second Outlook that mounts every mailbox.

$script:DefaultSharedMailbox = 'ACCDistrictNursing'
$script:LastMailboxResolution = ''

# Returns the Outlook.Application COM object, or throws with a coworker-safe message.
function Connect-RunningOutlook {
    param([switch]$AllowStart)

    $outlook = $null
    $attached = $false
    for ($try = 1; $try -le 3 -and -not $attached; $try++) {
        try {
            $outlook = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
            $attached = $true
        } catch {
            if ($try -lt 3) { Start-Sleep -Seconds 2 }
        }
    }

    if (-not $attached) {
        $isAdmin = $false
        try {
            $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        } catch {}
        $olRunning = $false
        try { if (Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue) { $olRunning = $true } } catch {}

        if ($isAdmin -and $olRunning) {
            throw 'This window is running AS ADMINISTRATOR but Outlook is running as a normal user. COM cannot cross that boundary, and starting a fresh Outlook here would mount all mailboxes and run out of memory. FIX: close this admin window and start the suite from a NORMAL (non-admin) quiet shortcut with Outlook already open.'
        } elseif ($olRunning) {
            # Same user - New-Object returns the existing instance (does not spawn a second one).
            try { $outlook = New-Object -ComObject Outlook.Application; $attached = $true } catch {}
        } elseif ($AllowStart) {
            try { $outlook = New-Object -ComObject Outlook.Application; $attached = $true } catch {}
        } else {
            throw 'Outlook does not appear to be running. Open the Outlook DESKTOP app (signed in, ACCDistrictNursing shared mailbox available), then press Refresh again.'
        }
    }
    if (-not $attached -or -not $outlook) {
        throw 'Could not obtain an Outlook COM object.'
    }
    return $outlook
}

function Resolve-AccSuiteDir {
    return Join-Path $env:USERPROFILE 'ACC-Suite'
}

function Get-OfficeConfigPath {
    $suite = Resolve-AccSuiteDir
    $root = $PSScriptRoot
    if ([string]::IsNullOrEmpty($root)) {
        $root = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent
    }
    $paths = @(
        (Join-Path $suite 'office-config.json'),
        (Join-Path $root 'office-config.example.json')
    )
    foreach ($p in $paths) {
        if (Test-Path -LiteralPath $p) { return $p }
    }
    return $null
}

function Resolve-SharedMailbox {
    param([string]$Override = '')

    if (-not [string]::IsNullOrWhiteSpace($Override)) {
        return $Override.Trim()
    }

    $configPath = Get-OfficeConfigPath
    if ($configPath) {
        try {
            $raw = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
            $cfg = $raw | ConvertFrom-Json
            if ($cfg.emailSync -and $cfg.emailSync.sharedMailbox) {
                $name = [string]$cfg.emailSync.sharedMailbox
                if (-not [string]::IsNullOrWhiteSpace($name)) { return $name.Trim() }
            }
            if ($cfg.sharedMailbox) {
                $name = [string]$cfg.sharedMailbox
                if (-not [string]::IsNullOrWhiteSpace($name)) { return $name.Trim() }
            }
        } catch {
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:ACC_SHARED_MAILBOX)) {
        return $env:ACC_SHARED_MAILBOX.Trim()
    }

    return $script:DefaultSharedMailbox
}

function Get-StoreSmtpHint {
    param([object]$Store)
    $hints = @()
    try {
        $display = [string]$Store.DisplayName
        if (-not [string]::IsNullOrWhiteSpace($display)) { $hints += $display }
    } catch {
    }
    try {
        $root = $Store.GetRootFolder()
        try {
            $smtp = [string]$root.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x39FE001E')
            if (-not [string]::IsNullOrWhiteSpace($smtp)) { $hints += $smtp }
        } catch {
        }
        try {
            $smtp = [string]$root.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x3003001F')
            if (-not [string]::IsNullOrWhiteSpace($smtp)) { $hints += $smtp }
        } catch {
        }
        if ($root) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($root) }
    } catch {
    }
    return $hints
}

function Test-StoreMatchesSharedName {
    param(
        [object]$Store,
        [string]$SharedName
    )
    if (-not $Store -or [string]::IsNullOrWhiteSpace($SharedName)) { return $false }

    $needle = $SharedName.Trim().ToLowerInvariant()
    $hints = Get-StoreSmtpHint -Store $Store
    foreach ($hint in $hints) {
        $lower = $hint.ToLowerInvariant()
        if ($lower -eq $needle) { return $true }
        if ($lower.Contains($needle)) { return $true }
        if ($needle.Contains('@') -and $lower.Contains($needle)) { return $true }
        $local = $needle.Split('@')[0]
        if (-not [string]::IsNullOrWhiteSpace($local) -and $local.Length -ge 4 -and $lower.Contains($local)) {
            return $true
        }
    }
    return $false
}

function Get-SharedInboxFolder {
    param(
        [object]$Namespace,
        [string]$SharedName
    )

    $script:LastMailboxResolution = ''

    if ([string]::IsNullOrWhiteSpace($SharedName)) {
        $script:LastMailboxResolution = 'default user inbox (GetDefaultFolder)'
        return $Namespace.GetDefaultFolder(6)
    }

    $recipient = $Namespace.CreateRecipient($SharedName)
    if ($recipient.Resolve()) {
        try {
            $folder = $Namespace.GetSharedDefaultFolder($recipient, 6)
            if ($folder) {
                $script:LastMailboxResolution = "CreateRecipient+GetSharedDefaultFolder ($SharedName)"
                return $folder
            }
        } catch {
        }
    }

    # Fallback store enumeration. This path only runs when CreateRecipient+GetSharedDefaultFolder
    # above did NOT resolve - i.e. it is NOT the working ACCDistrictNursing path that sync uses
    # (sync resolves via the recipient path and returns before reaching here), so nothing here can
    # regress sync. We skip the "Public Folders" Exchange store: opening its default folder /
    # root can block for ~20 minutes and it is never an ACC letter mailbox.
    foreach ($store in $Namespace.Stores) {
        $display = ''
        try { $display = [string]$store.DisplayName } catch {}
        if ($display -match 'Public Folders') { continue }
        try {
            if (Test-StoreMatchesSharedName -Store $store -SharedName $SharedName) {
                $folder = $store.GetDefaultFolder(6)
                if ($folder) {
                    $script:LastMailboxResolution = "store match ($display)"
                    return $folder
                }
            }
        } catch {
        }
    }

    $available = @()
    foreach ($store in $Namespace.Stores) {
        try {
            $display = [string]$store.DisplayName
            if (-not [string]::IsNullOrWhiteSpace($display)) { $available += $display }
        } catch {
        }
    }
    $storeList = if ($available.Count -gt 0) { $available -join '; ' } else { '(no stores visible)' }
    throw "Shared mailbox not found: $SharedName. Visible stores: $storeList"
}

function Get-LastMailboxResolution {
    return $script:LastMailboxResolution
}

function Get-SenderAddress {
    param([object]$Item)

    # Raw sender address. For Exchange-internal senders this is an X.500 legacyExchangeDN
    # (e.g. /O=EXCHANGELABS/OU=.../CN=RECIPIENTS/CN=...), NOT a real SMTP address, so it can
    # never match the SMTP-only allowlist. We resolve those to the primary SMTP address below.
    $from = ''
    try { $from = [string]$Item.SenderEmailAddress } catch {}

    # Is this an Exchange-internal sender whose address is not usable SMTP?
    $senderType = ''
    try { $senderType = [string]$Item.SenderEmailType } catch {}
    $looksExchange = $false
    if ($senderType -eq 'EX') { $looksExchange = $true }
    if ($from -match '^/[oO]=') { $looksExchange = $true }

    # Fast path: already a normal SMTP sender (e.g. John.Bentley@acc.co.nz). Preserves existing
    # behaviour and makes ZERO extra COM/directory calls for the common case.
    if (-not [string]::IsNullOrWhiteSpace($from) -and -not $looksExchange -and $from.Contains('@')) {
        return $from.Trim().ToLowerInvariant()
    }

    # Exchange-internal (or empty/unknown) sender: resolve to primary SMTP.
    # Order is tuned for SPEED and no-stall safety: cheap MAPI property reads that are already on
    # the item come first; the directory-backed GetExchangeUser() (which can be a slow lookup) is
    # only attempted if the property reads fail. Every step is isolated in try/catch and never
    # throws - on total failure we return the original address unchanged.

    # PR_SENDER_SMTP_ADDRESS (unicode) - cheap MAPI property on the item itself.
    try {
        $smtp = [string]$Item.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x5D01001F')
        if (-not [string]::IsNullOrWhiteSpace($smtp) -and $smtp.Contains('@')) {
            return $smtp.Trim().ToLowerInvariant()
        }
    } catch {}

    # PR_SENT_REPRESENTING_SMTP_ADDRESS (unicode) - covers send-on-behalf / shared mailbox sends.
    try {
        $smtp = [string]$Item.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x5D02001F')
        if (-not [string]::IsNullOrWhiteSpace($smtp) -and $smtp.Contains('@')) {
            return $smtp.Trim().ToLowerInvariant()
        }
    } catch {}

    # Sender.GetExchangeUser().PrimarySmtpAddress - directory-backed, tried after cheap reads.
    # Sender may be null; GetExchangeUser() returns null for non-user senders (distribution
    # lists, public folders), so guard every hop.
    try {
        $sender = $Item.Sender
        if ($sender) {
            $exUser = $sender.GetExchangeUser()
            if ($exUser) {
                $smtp = [string]$exUser.PrimarySmtpAddress
                if (-not [string]::IsNullOrWhiteSpace($smtp) -and $smtp.Contains('@')) {
                    return $smtp.Trim().ToLowerInvariant()
                }
            }
        }
    } catch {}

    # Sender.Address if it already looks like SMTP.
    try {
        $addr = [string]$Item.Sender.Address
        if (-not [string]::IsNullOrWhiteSpace($addr) -and $addr.Contains('@')) {
            return $addr.Trim().ToLowerInvariant()
        }
    } catch {}

    # Fallback: original SenderEmailAddress unchanged so nothing regresses.
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

function Test-SubjectPatternUsesRegex {
    param([string]$Pattern)
    if ([string]::IsNullOrWhiteSpace($Pattern)) { return $false }
    return $Pattern -match '[\[\].*+?^${}()|\\]'
}

function Test-AccSubject {
    param(
        [string]$Subject,
        [string[]]$Patterns
    )
    if ([string]::IsNullOrWhiteSpace($Subject)) { return $false }
    foreach ($pat in $Patterns) {
        if ([string]::IsNullOrWhiteSpace($pat)) { continue }
        if (Test-SubjectPatternUsesRegex -Pattern $pat) {
            if ($Subject -match $pat) { return $true }
        } else {
            if ($Subject.IndexOf($pat, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return $true
            }
        }
    }
    return $false
}

# Colon-optional, case-insensitive token presence test.
# Token 'Claim:' (or 'Claim') matches 'Claim:123', 'Claim 123', 'CLAIM123', 'reclaim' etc.
# Deliberately permissive: everything that passes still flows to the Human Review Queue.
function Get-SubjectTokenPresence {
    param(
        [string]$Subject,
        [string]$Token
    )
    if ([string]::IsNullOrWhiteSpace($Subject) -or [string]::IsNullOrWhiteSpace($Token)) { return $false }
    $needle = $Token.Trim().TrimEnd(':').Trim()
    if ([string]::IsNullOrWhiteSpace($needle)) { return $false }
    return ($Subject.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
}

# Subject matcher with configurable mode:
#   'any'    - legacy OR over subjectPatterns (Test-AccSubject) - broadest.
#   'tokens' - subject contains ANY required token (default; e.g. Claim OR ACCID), colon-optional.
#   'all'    - subject contains ALL required tokens (require BOTH Claim AND ACCID).
# Unknown/blank mode falls back to 'tokens'.
function Test-AccSubjectMode {
    param(
        [string]$Subject,
        [string[]]$Patterns,
        [string]$Mode = 'tokens',
        [string[]]$RequiredTokens
    )
    if ([string]::IsNullOrWhiteSpace($Subject)) { return $false }
    if (-not $RequiredTokens -or $RequiredTokens.Count -eq 0) {
        $RequiredTokens = @('Claim', 'ACCID')
    }
    $m = 'tokens'
    if (-not [string]::IsNullOrWhiteSpace($Mode)) { $m = $Mode.Trim().ToLowerInvariant() }

    if ($m -eq 'any') {
        return (Test-AccSubject -Subject $Subject -Patterns $Patterns)
    }
    if ($m -eq 'all') {
        foreach ($tok in $RequiredTokens) {
            if ([string]::IsNullOrWhiteSpace($tok)) { continue }
            if (-not (Get-SubjectTokenPresence -Subject $Subject -Token $tok)) { return $false }
        }
        return $true
    }
    # default: 'tokens' - EITHER/any required token present
    foreach ($tok in $RequiredTokens) {
        if ([string]::IsNullOrWhiteSpace($tok)) { continue }
        if (Get-SubjectTokenPresence -Subject $Subject -Token $tok) { return $true }
    }
    return $false
}

# Case-insensitive supported-extension test. Accepts '.PDF', '.Pdf', '.pdf' identically.
function Test-SupportedExtension {
    param(
        [string]$FileName,
        [string[]]$SupportedExt
    )
    if ([string]::IsNullOrWhiteSpace($FileName)) { return $false }
    if (-not $SupportedExt -or $SupportedExt.Count -eq 0) { return $false }
    $ext = [System.IO.Path]::GetExtension($FileName)
    if ([string]::IsNullOrWhiteSpace($ext)) { return $false }
    $ext = $ext.Trim().ToLowerInvariant()
    foreach ($allowed in $SupportedExt) {
        if ([string]::IsNullOrWhiteSpace($allowed)) { continue }
        $a = $allowed.Trim().ToLowerInvariant()
        if (-not $a.StartsWith('.')) { $a = '.' + $a }
        if ($ext -eq $a) { return $true }
    }
    return $false
}

function Merge-UniqueStringList {
    param([string[]]$Values)
    $seen = @{}
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($entry in $Values) {
        if ([string]::IsNullOrWhiteSpace($entry)) { continue }
        $key = $entry.Trim().ToLowerInvariant()
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        [void]$out.Add($entry.Trim())
    }
    return @($out.ToArray())
}
