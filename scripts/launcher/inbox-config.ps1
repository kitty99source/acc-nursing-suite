# ACC-Inbox path resolution for folder-watch, email sync, and Explorer shortcuts.
# Priority: CLI override > ACC_INBOX_PATH env > ACC_INBOX env > office-config accInbox.inboxPath > %USERPROFILE%\ACC-Inbox

function Resolve-AccSuiteDir {
    return Join-Path $env:USERPROFILE 'ACC-Suite'
}

function Get-OfficeConfigPath {
    param([string]$ScriptRoot = '')

    $suite = Resolve-AccSuiteDir
    if ([string]::IsNullOrEmpty($ScriptRoot)) {
        $ScriptRoot = $PSScriptRoot
    }
    if ([string]::IsNullOrEmpty($ScriptRoot)) {
        $ScriptRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent
    }
    $paths = @(
        (Join-Path $suite 'office-config.json'),
        (Join-Path $ScriptRoot 'office-config.example.json')
    )
    foreach ($p in $paths) {
        if (Test-Path -LiteralPath $p) { return $p }
    }
    return $null
}

function Resolve-InboxPath {
    param(
        [string]$Override = '',
        [string]$ScriptRoot = ''
    )

    if (-not [string]::IsNullOrWhiteSpace($Override)) {
        return [System.IO.Path]::GetFullPath($Override)
    }
    if (-not [string]::IsNullOrWhiteSpace($env:ACC_INBOX_PATH)) {
        return [System.IO.Path]::GetFullPath($env:ACC_INBOX_PATH)
    }
    if (-not [string]::IsNullOrWhiteSpace($env:ACC_INBOX)) {
        return [System.IO.Path]::GetFullPath($env:ACC_INBOX)
    }

    $configPath = Get-OfficeConfigPath -ScriptRoot $ScriptRoot
    if ($configPath) {
        try {
            $raw = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
            $cfg = $raw | ConvertFrom-Json
            if ($cfg.accInbox -and $cfg.accInbox.inboxPath) {
                $path = [string]$cfg.accInbox.inboxPath
                if (-not [string]::IsNullOrWhiteSpace($path)) {
                    return [System.IO.Path]::GetFullPath($path)
                }
            }
        } catch {
        }
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
