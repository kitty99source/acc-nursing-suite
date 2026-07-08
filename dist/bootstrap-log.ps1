# Inline bootstrap logger for Windows launchers (PowerShell 5.1, no dependencies).
# Dot-source once at the top of launch.ps1 / portal-discover.ps1 / folder-watch.ps1 / outlook-sync.ps1:
#   . (Join-Path $PSScriptRoot 'bootstrap-log.ps1') -LogName 'acc'
# Writes %USERPROFILE%\ACC-Suite\logs\<LogName>-bootstrap.log using shared read/write.

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('acc', 'portal', 'folder-watch', 'email-probe', 'email-sync', 'wfh', 'email-diagnose')]
    [string]$LogName
)

$script:BootstrapLogPath = Join-Path $env:USERPROFILE "ACC-Suite\logs\$LogName-bootstrap.log"

function Write-BootstrapLog {
    param([string]$Message)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    $maxAttempts = 5
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        try {
            $logDir = Split-Path -Parent $script:BootstrapLogPath
            if (-not (Test-Path -LiteralPath $logDir)) {
                [void][System.IO.Directory]::CreateDirectory($logDir)
            }
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($line + [Environment]::NewLine)
            $fs = New-Object System.IO.FileStream(
                $script:BootstrapLogPath,
                [System.IO.FileMode]::Append,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::ReadWrite
            )
            try {
                $fs.Write($bytes, 0, $bytes.Length)
                $fs.Flush()
            } finally {
                $fs.Dispose()
            }
            return
        } catch {
            if ($attempt -lt $maxAttempts) {
                Start-Sleep -Milliseconds (40 * $attempt)
            }
        }
    }
}
