# Shared mailbox resolution for Outlook COM scripts (sync + probe).
# Priority: CLI override > office-config.json > ACC_SHARED_MAILBOX env > ACCDistrictNursing default.

$script:DefaultSharedMailbox = 'ACCDistrictNursing'

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

function Get-SharedInboxFolder {
    param(
        [object]$Namespace,
        [string]$SharedName
    )

    if ([string]::IsNullOrWhiteSpace($SharedName)) {
        return $Namespace.GetDefaultFolder(6)
    }

    $recipient = $Namespace.CreateRecipient($SharedName)
    if ($recipient.Resolve()) {
        return $Namespace.GetSharedDefaultFolder($recipient, 6)
    }

    foreach ($store in $Namespace.Stores) {
        try {
            $displayName = [string]$store.DisplayName
            if ($displayName -eq $SharedName -or $displayName -like "*$SharedName*") {
                return $store.GetDefaultFolder(6)
            }
        } catch {
        }
    }

    throw "Shared mailbox not found: $SharedName"
}
