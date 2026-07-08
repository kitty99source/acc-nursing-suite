param(
    [string]$InboxDir = ''
)

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'folder-watch'
. (Join-Path $bootstrapRoot 'inbox-config.ps1')
Write-BootstrapLog 'folder-watch.ps1 started'

# ACC Folder Watch - work laptop (PowerShell only, no Node.js)
#
# Watches %USERPROFILE%\ACC-Inbox for PDF and Word letter drops.
# Writes staging sidecar JSON to ACC-Inbox\.staging\ for Human Review Queue.
# Moves originals to ACC-Inbox\processed\ after staging.

$script:LauncherLogEnabled = $false
$script:InboxPath = $null
$script:SupportedExt = @('.pdf', '.docx')

function Write-LauncherLogSafe {
    param([string]$Message)
    try {
        if ($script:LauncherLogEnabled -and (Get-Command Write-LauncherLog -ErrorAction SilentlyContinue)) {
            Write-LauncherLog $Message
        } else {
            Write-BootstrapLog $Message
        }
    } catch {
        try { Write-BootstrapLog $Message } catch {}
    }
}

try {
    [void][System.IO.Directory]::CreateDirectory((Join-Path $env:USERPROFILE 'ACC-Suite\logs'))
} catch {}

try {
    $logHelper = Join-Path $bootstrapRoot 'launcher-log.ps1'
    if (Test-Path -LiteralPath $logHelper) {
        . $logHelper
        Initialize-LauncherLog -Prefix 'folder-watch' -ShowSuccessOnExit:$false | Out-Null
        $script:LauncherLogEnabled = $true
    }
} catch {}

function Test-AutomationPaused {
    param([string]$Inbox)
    if ($env:ACC_AUTOMATION_PAUSED -eq '1') { return $true }
    return Test-Path -LiteralPath (Join-Path $Inbox '.automation-paused')
}

function Get-Sha256Hex {
    param([string]$FilePath)
    $hash = Get-FileHash -LiteralPath $FilePath -Algorithm SHA256
    return $hash.Hash.ToLowerInvariant()
}

function Get-SidecarFileStem {
    param([string]$FileName)
    $base = [System.IO.Path]::GetFileName($FileName)
    if ([string]::IsNullOrWhiteSpace($base)) { $base = 'attachment' }
    $invalid = [System.IO.Path]::GetInvalidFileNameChars() -join ''
    $safe = [regex]::Replace($base, "[$([regex]::Escape($invalid))]", '_')
    if ($safe.Length -gt 120) {
        $ext = [System.IO.Path]::GetExtension($safe)
        $stem = [System.IO.Path]::GetFileNameWithoutExtension($safe)
        if ($stem.Length -gt (120 - $ext.Length)) {
            $stem = $stem.Substring(0, 120 - $ext.Length)
        }
        $safe = $stem + $ext
    }
    return $safe
}

function Get-SidecarPath {
    param(
        [string]$Inbox,
        [string]$Hash,
        [string]$FileName
    )
    $stem = Get-SidecarFileStem -FileName $FileName
    return Join-Path $Inbox (Join-Path '.staging' ("{0}_{1}.json" -f $Hash, $stem))
}

function Test-AlreadyStaged {
    param(
        [string]$Inbox,
        [string]$Hash,
        [string]$FileName
    )
    return Test-Path -LiteralPath (Get-SidecarPath -Inbox $Inbox -Hash $Hash -FileName $FileName)
}

function New-FolderWatchSidecar {
    param(
        [string]$FilePath,
        [string]$Hash,
        [string]$Inbox
    )
    $fileName = [System.IO.Path]::GetFileName($FilePath)
    $today = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
    $item = [ordered]@{
        id             = [guid]::NewGuid().ToString()
        type           = 'letter-import-pending'
        status         = 'pending'
        source         = 'folder'
        createdAt      = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        severity       = 'info'
        title          = "Folder: $fileName"
        summary        = 'Letter dropped in ACC-Inbox - awaiting HRQ review and letter parse.'
        sourceFileName = $fileName
        sourceHash     = $Hash
        sourcePath     = $FilePath
        runId          = "folder-watch-$today"
    }
    return @{
        version = 1
        item    = $item
    }
}

function Invoke-ProcessLetterFile {
    param([string]$FilePath)

    if (-not $script:InboxPath) { return }
    $inbox = $script:InboxPath

    if (Test-AutomationPaused -Inbox $inbox) {
        Write-Host "[paused] automation hold - skipping $([System.IO.Path]::GetFileName($FilePath))" -ForegroundColor Yellow
        return
    }

    if (-not (Test-Path -LiteralPath $FilePath)) { return }

    $ext = [System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()
    if ($script:SupportedExt -notcontains $ext) { return }

    try {
        $info = Get-Item -LiteralPath $FilePath
    } catch {
        return
    }
    if (-not $info.PSIsContainer -and $info.Length -le 0) { return }

    try {
        $hash = Get-Sha256Hex -FilePath $FilePath
    } catch {
        Write-Host "[warn] could not hash $FilePath" -ForegroundColor Yellow
        return
    }

    $leafName = [System.IO.Path]::GetFileName($FilePath)
    if (Test-AlreadyStaged -Inbox $inbox -Hash $hash -FileName $leafName) {
        $sidecarName = [System.IO.Path]::GetFileName((Get-SidecarPath -Inbox $inbox -Hash $hash -FileName $leafName))
        Write-Host "[skip] re-scan: identical bytes for $leafName already staged (.staging\$sidecarName, SHA-256 $($hash.Substring(0, 8))...)" -ForegroundColor Gray
        return
    }

    $sidecar = New-FolderWatchSidecar -FilePath $FilePath -Hash $hash -Inbox $inbox
    $outPath = Get-SidecarPath -Inbox $inbox -Hash $hash -FileName $leafName
    $json = $sidecar | ConvertTo-Json -Depth 6 -Compress:$false
    [System.IO.File]::WriteAllText($outPath, $json, [Text.Encoding]::UTF8)

    $dest = Join-Path $inbox (Join-Path 'processed' ([System.IO.Path]::GetFileName($FilePath)))
    try {
        Move-Item -LiteralPath $FilePath -Destination $dest -Force -ErrorAction Stop
    } catch {
        Write-Host "[warn] could not move to processed/: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    $relative = '.staging\' + [System.IO.Path]::GetFileName($outPath)
    Write-Host "[staged] $([System.IO.Path]::GetFileName($FilePath)) -> $relative" -ForegroundColor Green
    Write-LauncherLogSafe "Staged $([System.IO.Path]::GetFileName($FilePath)) as $relative"
}

function Invoke-ScanInbox {
    param([string]$Inbox)
    foreach ($name in [System.IO.Directory]::GetFileSystemEntries($Inbox)) {
        $leaf = [System.IO.Path]::GetFileName($name)
        if ($leaf.StartsWith('.') -or $leaf -eq 'processed') { continue }
        if (-not (Test-Path -LiteralPath $name -PathType Leaf)) { continue }
        Invoke-ProcessLetterFile -FilePath $name
    }
}

try {
    $ErrorActionPreference = 'Stop'
    $script:InboxPath = Resolve-InboxPath -Override $InboxDir -ScriptRoot $bootstrapRoot
    Initialize-InboxDirs -Inbox $script:InboxPath

    if (Test-AutomationPaused -Inbox $script:InboxPath) {
        Write-Host "[paused] $($script:InboxPath) - remove .automation-paused or unset ACC_AUTOMATION_PAUSED to resume" -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host '  ACC Folder Watch' -ForegroundColor Cyan
    Write-Host '  ----------------' -ForegroundColor Cyan
    Write-Host '  (PowerShell only - no extra software)' -ForegroundColor Gray
    Write-Host ''
    Write-Host "  Watching: $($script:InboxPath)" -ForegroundColor Green
    Write-Host '  Drop PDF or Word (.docx) letters here.' -ForegroundColor Gray
    Write-Host '  Sidecars: ACC-Inbox\.staging\*.json' -ForegroundColor Gray
    Write-Host '  In the app: Review Queue -> Import folder-watch sidecars' -ForegroundColor Gray
    Write-Host ''
    Write-LauncherLogSafe "Watching $($script:InboxPath)"

    Invoke-ScanInbox -Inbox $script:InboxPath

    Write-Host '  Press Ctrl+C to stop.' -ForegroundColor Gray
    Write-Host ''

    while ($true) {
        Start-Sleep -Seconds 2
        Invoke-ScanInbox -Inbox $script:InboxPath
    }
} catch {
    Write-BootstrapLog "FATAL: $($_.Exception.Message)"
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($script:LauncherLogEnabled -and (Get-Command Write-LauncherLogException -ErrorAction SilentlyContinue)) {
        Write-LauncherLogException $_
    }
    Read-Host 'Press Enter to close'
    exit 1
} finally {
    if ($script:LauncherLogEnabled -and (Get-Command Complete-LauncherLog -ErrorAction SilentlyContinue)) {
        Complete-LauncherLog -Title 'ACC Folder Watch'
    }
}
