# Shared launcher logging + MessageBox helpers (work laptop, no install).
# Dot-source from launch.ps1 / portal-discover.ps1 / folder-watch.ps1.

$script:LauncherLogPath = $null
$script:LauncherLocalLogPath = $null
$script:LauncherLogPrefix = 'launcher'
$script:LauncherHadError = $false
$script:LauncherShowSuccessOnExit = $true
$script:UseWinForms = $false

function Get-LauncherScriptDir {
    if ($script:LauncherDir -and -not [string]::IsNullOrWhiteSpace($script:LauncherDir)) {
        return $script:LauncherDir.TrimEnd('\', '/')
    }
    if ($env:ACC_LAUNCHER_DIR -and -not [string]::IsNullOrWhiteSpace($env:ACC_LAUNCHER_DIR)) {
        return $env:ACC_LAUNCHER_DIR.TrimEnd('\', '/')
    }
    if ($PSScriptRoot -and -not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        return $PSScriptRoot.TrimEnd('\', '/')
    }
    return (Split-Path -Parent $MyInvocation.MyCommand.Path).TrimEnd('\', '/')
}

function Initialize-LauncherUi {
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop | Out-Null
        $script:UseWinForms = $true
    } catch {
        $script:UseWinForms = $false
    }
}

function Show-LauncherMessageBox {
    param(
        [string]$Message,
        [string]$Title = 'ACC Suite',
        [ValidateSet('Error', 'Information', 'Warning')]
        [string]$Icon = 'Information'
    )
    $flat = ($Message -replace '\s+', ' ').Trim()
    if ($flat.Length -gt 240) { $flat = $flat.Substring(0, 237) + '...' }
    # msg.exe works without .NET WinForms — try first on locked-down hospital PCs
    try { & msg.exe $env:USERNAME /time:120 $flat 2>$null | Out-Null; return } catch {}
    if ($script:UseWinForms) {
        try {
            $iconEnum = [System.Windows.Forms.MessageBoxIcon]::$Icon
            [System.Windows.Forms.MessageBox]::Show(
                $Message,
                $Title,
                [System.Windows.Forms.MessageBoxButtons]::OK,
                $iconEnum
            ) | Out-Null
        } catch {}
    }
}

function Initialize-LauncherLog {
    param(
        [string]$Prefix,
        [switch]$ShowSuccessOnExit
    )
    $script:LauncherLogPrefix = $Prefix
    $script:LauncherHadError = $false
    if ($PSBoundParameters.ContainsKey('ShowSuccessOnExit')) {
        $script:LauncherShowSuccessOnExit = [bool]$ShowSuccessOnExit
    } else {
        $script:LauncherShowSuccessOnExit = $true
    }

    Initialize-LauncherUi

    $launcherDir = Get-LauncherScriptDir
    $script:LauncherLocalLogPath = Join-Path $launcherDir 'launch-error.log'

    $logDir = Join-Path $env:USERPROFILE 'ACC-Suite\logs'
    try {
        [void][System.IO.Directory]::CreateDirectory($logDir)
    } catch {
        $logDir = Join-Path $env:TEMP 'ACC-Suite-logs'
        [void][System.IO.Directory]::CreateDirectory($logDir)
    }

    $timestamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
    $script:LauncherLogPath = Join-Path $logDir "$Prefix-$timestamp.log"
    try { Write-LauncherLog "=== $Prefix started ===" } catch {}
    try { Write-LauncherLog "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" } catch {}
    try { Write-LauncherLog "Script dir: $launcherDir" } catch {}
    try {
        $cwd = try { (Get-Location).Path } catch { '(unknown)' }
        Write-LauncherLog "Working directory: $cwd"
    } catch {}
    return $script:LauncherLogPath
}

function Write-LauncherLog {
    param([string]$Message)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    try {
        if ($script:LauncherLogPath) {
            Add-Content -LiteralPath $script:LauncherLogPath -Value $line -Encoding UTF8
        }
    } catch {}
    try {
        if ($script:LauncherLocalLogPath) {
            Add-Content -LiteralPath $script:LauncherLocalLogPath -Value $line -Encoding UTF8
        }
    } catch {}
    try { Write-Host $line } catch {}
}

function Write-LauncherLogException {
    param($ErrorRecord)
    $script:LauncherHadError = $true
    $msg = if ($ErrorRecord.Exception) { $ErrorRecord.Exception.Message } else { [string]$ErrorRecord }
    Write-LauncherLog "ERROR: $msg"
    if ($ErrorRecord.ScriptStackTrace) {
        Write-LauncherLog "Stack trace:`n$($ErrorRecord.ScriptStackTrace)"
    }
    if ($ErrorRecord.Exception -and $ErrorRecord.Exception.StackTrace) {
        Write-LauncherLog ".NET stack:`n$($ErrorRecord.Exception.StackTrace)"
    }
}

function Complete-LauncherLog {
    param(
        [string]$Title = 'ACC Suite',
        [switch]$SuppressSuccessMessage
    )
    if (-not $script:LauncherLogPath) { return }

    $localHint = if ($script:LauncherLocalLogPath) { "`nAlso: $($script:LauncherLocalLogPath)" } else { '' }

    if ($script:LauncherHadError) {
        Write-LauncherLog "=== finished with errors ==="
        Show-LauncherMessageBox -Title $Title -Icon Error -Message @"
Error — log saved to:
$($script:LauncherLogPath)$localHint

Send this file to support.
"@
    } elseif (-not $SuppressSuccessMessage -and $script:LauncherShowSuccessOnExit) {
        Write-LauncherLog "=== finished successfully ==="
        Show-LauncherMessageBox -Title $Title -Icon Information -Message @"
Done — log saved to:
$($script:LauncherLogPath)$localHint
"@
    } else {
        Write-LauncherLog "=== finished successfully (server still running or success message suppressed) ==="
    }
}

function Show-LauncherStartupSuccess {
    param([string]$Title = 'ACC Suite')
    if (-not $script:LauncherLogPath) { return }
    $localHint = if ($script:LauncherLocalLogPath) { "`nAlso: $($script:LauncherLocalLogPath)" } else { '' }
    Write-LauncherLog "Startup completed successfully"
    Show-LauncherMessageBox -Title $Title -Icon Information -Message @"
Done — ACC Suite is running.

Log saved to:
$($script:LauncherLogPath)$localHint

Keep this window open while you use the app.
"@
}
