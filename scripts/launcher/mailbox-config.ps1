# Shared mailbox resolution for Outlook COM scripts (sync + probe + diagnose).
# Priority: CLI override > office-config.json > ACC_SHARED_MAILBOX env > ACCDistrictNursing default.

$script:DefaultSharedMailbox = 'ACCDistrictNursing'
$script:LastMailboxResolution = ''

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

    foreach ($store in $Namespace.Stores) {
        try {
            if (Test-StoreMatchesSharedName -Store $store -SharedName $SharedName) {
                $folder = $store.GetDefaultFolder(6)
                if ($folder) {
                    $display = ''
                    try { $display = [string]$store.DisplayName } catch {}
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
