param(
    [string]$InboxDir = '',
    [switch]$VerboseSkips
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

# Per-session cache of files already evaluated this run (path|length|mtime).
# Lets each existing/already-staged file be hashed and announced at most once per
# session, so the 2s polling re-scan never re-hashes or re-prints them.
$script:SeenFileKeys = [System.Collections.Generic.HashSet[string]]::new()

# Default: quiet (summarised skips). Enable per-file skip detail via -VerboseSkips
# or ACC_FOLDER_WATCH_VERBOSE=1.
$script:VerboseSkips = [bool]$VerboseSkips
if ($env:ACC_FOLDER_WATCH_VERBOSE -eq '1') { $script:VerboseSkips = $true }

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

    # Enrich from outlook-sync SHA-256 meta when present (patient/claim/subject).
    $metaPath = Join-Path $Inbox (Join-Path '.email-sync' ("{0}.meta.json" -f $Hash))
    if (Test-Path -LiteralPath $metaPath -PathType Leaf) {
        try {
            $meta = Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($meta.patientName) { $item.patientName = [string]$meta.patientName }
            if ($meta.claimNumber) { $item.claimNumber = [string]$meta.claimNumber }
            if ($meta.accId) { $item.accId = [string]$meta.accId }
            if ($meta.descriptiveFileName) { $item.expectedFileName = [string]$meta.descriptiveFileName }
            elseif ($meta.fileName) { $item.expectedFileName = [string]$meta.fileName }
            if ($meta.subject) {
                $item.emailSubject = [string]$meta.subject
                if ($meta.patientName -or $meta.claimNumber) {
                    $bits = @()
                    if ($meta.patientName) { $bits += [string]$meta.patientName }
                    if ($meta.claimNumber) { $bits += ("Claim:{0}" -f $meta.claimNumber) }
                    if ($meta.accId) { $bits += ("ACCID:{0}" -f $meta.accId) }
                    $item.summary = ("{0} - awaiting HRQ review." -f ($bits -join ' / '))
                    $item.title = ("Letter: {0}" -f $fileName)
                }
            }
        } catch {}
    }

    return @{
        version = 1
        item    = $item
    }
}

function Update-HashIndexRelativePath {
    # After moving a file to processed/, keep hash-index.json pointing at the new relative path.
    param(
        [string]$Inbox,
        [string]$Hash,
        [string]$RelativePath
    )
    $metaDir = Join-Path $Inbox '.email-sync'
    [void][System.IO.Directory]::CreateDirectory($metaDir)
    $indexPath = Join-Path $metaDir 'hash-index.json'
    $index = @{}
    if (Test-Path -LiteralPath $indexPath -PathType Leaf) {
        try {
            $existing = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($existing) {
                $existing.PSObject.Properties | ForEach-Object { $index[$_.Name] = [string]$_.Value }
            }
        } catch {}
    }
    $index[$Hash] = $RelativePath
    $tmp = $indexPath + '.tmp'
    $json = ($index | ConvertTo-Json -Depth 3 -Compress:$false)
    if ([string]::IsNullOrWhiteSpace($json) -or $json -eq 'null') { $json = '{}' }
    [System.IO.File]::WriteAllText($tmp, $json, [Text.Encoding]::UTF8)
    Move-Item -LiteralPath $tmp -Destination $indexPath -Force

    $metaPath = Join-Path $metaDir ("{0}.meta.json" -f $Hash)
    if (Test-Path -LiteralPath $metaPath -PathType Leaf) {
        try {
            $meta = Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $meta | Add-Member -NotePropertyName relativePath -NotePropertyValue $RelativePath -Force
            $metaTmp = $metaPath + '.tmp'
            $metaJson = ($meta | ConvertTo-Json -Depth 4 -Compress:$false)
            [System.IO.File]::WriteAllText($metaTmp, $metaJson, [Text.Encoding]::UTF8)
            Move-Item -LiteralPath $metaTmp -Destination $metaPath -Force
        } catch {}
    }
}

# Returns a status token so the scan can roll up a summary instead of spamming
# one line per file: 'staged' | 'skipped' | 'paused' | 'error' | 'seen' | 'ignored'.
function Invoke-ProcessLetterFile {
    param([string]$FilePath)

    if (-not $script:InboxPath) { return 'ignored' }
    $inbox = $script:InboxPath

    if (-not (Test-Path -LiteralPath $FilePath)) { return 'ignored' }

    $ext = [System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()
    if ($script:SupportedExt -notcontains $ext) { return 'ignored' }

    try {
        $info = Get-Item -LiteralPath $FilePath
    } catch {
        return 'ignored'
    }
    if (-not $info.PSIsContainer -and $info.Length -le 0) { return 'ignored' }

    # Cheap re-scan guard: if this exact file (path+size+mtime) was already
    # evaluated this session, skip silently - no re-hash, no re-print. This is
    # what stops the 2s polling loop from re-announcing already-staged files.
    $cheapKey = '{0}|{1}|{2}' -f $FilePath, $info.Length, $info.LastWriteTimeUtc.Ticks
    if ($script:SeenFileKeys.Contains($cheapKey)) { return 'seen' }

    if (Test-AutomationPaused -Inbox $inbox) {
        [void]$script:SeenFileKeys.Add($cheapKey)
        if ($script:VerboseSkips) {
            Write-Host "[paused] automation hold - skipping $([System.IO.Path]::GetFileName($FilePath))" -ForegroundColor Yellow
        }
        return 'paused'
    }

    try {
        $hash = Get-Sha256Hex -FilePath $FilePath
    } catch {
        Write-Host "[warn] could not hash $FilePath" -ForegroundColor Yellow
        return 'error'
    }

    $leafName = [System.IO.Path]::GetFileName($FilePath)
    if (Test-AlreadyStaged -Inbox $inbox -Hash $hash -FileName $leafName) {
        [void]$script:SeenFileKeys.Add($cheapKey)
        if ($script:VerboseSkips) {
            $sidecarName = [System.IO.Path]::GetFileName((Get-SidecarPath -Inbox $inbox -Hash $hash -FileName $leafName))
            Write-Host "[skip] re-scan: identical bytes for $leafName already staged (.staging\$sidecarName, SHA-256 $($hash.Substring(0, 8))...)" -ForegroundColor Gray
        }
        return 'skipped'
    }

    $sidecar = New-FolderWatchSidecar -FilePath $FilePath -Hash $hash -Inbox $inbox
    $outPath = Get-SidecarPath -Inbox $inbox -Hash $hash -FileName $leafName
    $json = $sidecar | ConvertTo-Json -Depth 6 -Compress:$false
    [System.IO.File]::WriteAllText($outPath, $json, [Text.Encoding]::UTF8)

    $dest = Join-Path $inbox (Join-Path 'processed' ([System.IO.Path]::GetFileName($FilePath)))
    try {
        Move-Item -LiteralPath $FilePath -Destination $dest -Force -ErrorAction Stop
        try {
            Update-HashIndexRelativePath -Inbox $inbox -Hash $hash -RelativePath ("processed\{0}" -f $leafName)
        } catch {}
    } catch {
        Write-Host "[warn] could not move to processed/: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    [void]$script:SeenFileKeys.Add($cheapKey)
    $relative = '.staging\' + [System.IO.Path]::GetFileName($outPath)
    Write-Host "[staged] $([System.IO.Path]::GetFileName($FilePath)) -> $relative" -ForegroundColor Green
    Write-LauncherLogSafe "Staged $([System.IO.Path]::GetFileName($FilePath)) as $relative"
    return 'staged'
}

# Enumerate the inbox once and roll up per-file outcomes into a counts object.
function Invoke-ScanInbox {
    param([string]$Inbox)
    $counts = [ordered]@{ staged = 0; skipped = 0; paused = 0; errors = 0; seen = 0 }
    foreach ($name in [System.IO.Directory]::GetFileSystemEntries($Inbox)) {
        $leaf = [System.IO.Path]::GetFileName($name)
        if ($leaf.StartsWith('.') -or $leaf -eq 'processed') { continue }
        if (-not (Test-Path -LiteralPath $name -PathType Leaf)) { continue }
        switch (Invoke-ProcessLetterFile -FilePath $name) {
            'staged'  { $counts.staged++ }
            'skipped' { $counts.skipped++ }
            'paused'  { $counts.paused++ }
            'error'   { $counts.errors++ }
            'seen'    { $counts.seen++ }
            default   { }
        }
    }
    return $counts
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
    if ($script:VerboseSkips) {
        Write-Host '  Verbose skips: ON (per-file re-scan detail)' -ForegroundColor DarkGray
    }
    Write-Host ''
    Write-LauncherLogSafe "Watching $($script:InboxPath)"

    # Initial enumeration of the existing folder. Skips are summarised (not one
    # line per file) so a large backlog does not flood the console.
    $initial = Invoke-ScanInbox -Inbox $script:InboxPath
    $existing = $initial.staged + $initial.skipped + $initial.paused + $initial.errors
    $summary = "  {0} existing file(s): {1} already staged, {2} newly staged, {3} error(s)" -f ('{0:N0}' -f $existing), ('{0:N0}' -f $initial.skipped), ('{0:N0}' -f $initial.staged), ('{0:N0}' -f $initial.errors)
    if ($initial.paused -gt 0) {
        $summary += (", {0} skipped (automation paused)" -f ('{0:N0}' -f $initial.paused))
    }
    Write-Host $summary -ForegroundColor Cyan
    Write-LauncherLogSafe ("Startup scan:" + $summary.Trim())
    if ($initial.skipped -gt 0 -and -not $script:VerboseSkips) {
        Write-Host '  (re-run with -VerboseSkips or set ACC_FOLDER_WATCH_VERBOSE=1 for per-file detail)' -ForegroundColor DarkGray
    }
    Write-Host ''
    Write-Host '  Press Ctrl+C to stop.' -ForegroundColor Gray
    Write-Host ''

    # Poll for genuinely new drops. Already-seen files are cached, so this loop
    # is silent unless a new file arrives (or an occasional idle heartbeat).
    $idleTicks = 0
    $heartbeatEvery = 150  # ~5 min at 2s/tick
    while ($true) {
        Start-Sleep -Seconds 2
        $r = Invoke-ScanInbox -Inbox $script:InboxPath
        if ($r.staged -gt 0 -or $r.errors -gt 0) {
            $idleTicks = 0
        } else {
            $idleTicks++
            if ($idleTicks -ge $heartbeatEvery) {
                Write-Host ("[watch] idle - {0} file(s) tracked this session, still watching..." -f ('{0:N0}' -f $script:SeenFileKeys.Count)) -ForegroundColor DarkGray
                $idleTicks = 0
            }
        }
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
