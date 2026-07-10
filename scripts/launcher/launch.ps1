param()

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'acc'
$inboxConfig = Join-Path $bootstrapRoot 'inbox-config.ps1'
if (Test-Path -LiteralPath $inboxConfig) { . $inboxConfig }
Write-BootstrapLog 'launch.ps1 started'

# ACC District Nursing Admin Suite - local launcher
#
# Serves the sibling index.html from http://127.0.0.1 (loopback ONLY) so the app
# runs in a secure context. That makes the File System Access API (autosave-to-file),
# AES-GCM encryption and IndexedDB all work reliably (they are unreliable over file://).
#
# Zero install, no admin: uses ONLY Windows PowerShell + .NET. It deliberately uses
# System.Net.Sockets.TcpListener (NOT HttpListener) because TcpListener needs no URL
# ACL reservation and therefore works for a standard, non-admin user.
#
# Nothing is ever exposed to the network - the socket binds to 127.0.0.1 only.

$script:LauncherLogEnabled = $false

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

function Try-OpenAccSuiteBrowser {
    param(
        [string]$Label,
        [string]$FilePath,
        [string[]]$ArgumentList,
        [switch]$SkipPathCheck
    )
    Write-LauncherLogSafe "Step: try browser - $Label"
    if (-not $SkipPathCheck -and $FilePath -and -not (Test-Path -LiteralPath $FilePath)) {
        Write-LauncherLogSafe "Step: skip browser - $Label (path not found: $FilePath)"
        return $false
    }
    try {
        Write-LauncherLogSafe "Step: Start-Process before - $Label"
        if ($ArgumentList -and $ArgumentList.Count -gt 0) {
            Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -ErrorAction Stop | Out-Null
        } else {
            Start-Process -FilePath $FilePath -ErrorAction Stop | Out-Null
        }
        Write-LauncherLogSafe "Step: Start-Process after - $Label (ok)"
        return $true
    } catch {
        Write-LauncherLogSafe "Step: Start-Process after - $Label (failed: $($_.Exception.Message))"
        return $false
    }
}

function Send-Response {
    param(
        [System.Net.Sockets.TcpClient] $Client,
        [int]    $StatusCode,
        [string] $StatusText,
        [byte[]] $Body,
        [string] $ContentType = 'text/html; charset=utf-8'
    )
    try {
        $stream = $Client.GetStream()
        if ($null -eq $Body) { $Body = [byte[]]@() }
        $headerText =
            "HTTP/1.1 $StatusCode $StatusText`r`n" +
            "Content-Type: $ContentType`r`n" +
            "Content-Length: $($Body.Length)`r`n" +
            "Cache-Control: no-store`r`n" +
            "Connection: close`r`n" +
            "`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        if ($Body.Length -gt 0) { $stream.Write($Body, 0, $Body.Length) }
        $stream.Flush()
    } catch {
        # Client went away mid-write - ignore.
    }
}

function Get-RequestPath {
    param([string]$RequestLine)
    if (-not $RequestLine) { return '/' }
    $parts = $RequestLine.Split(' ')
    if ($parts.Length -lt 2) { return '/' }
    $path = $parts[1]
    $q = $path.IndexOf('?')
    if ($q -ge 0) { $path = $path.Substring(0, $q) }
    if ([string]::IsNullOrEmpty($path)) { return '/' }
    return $path
}

function Get-RequestQueryValue {
    # Extract a single query parameter from the raw request line (path?key=value).
    param(
        [string]$RequestLine,
        [string]$Key
    )
    if (-not $RequestLine -or [string]::IsNullOrWhiteSpace($Key)) { return $null }
    $parts = $RequestLine.Split(' ')
    if ($parts.Length -lt 2) { return $null }
    $raw = $parts[1]
    $q = $raw.IndexOf('?')
    if ($q -lt 0) { return $null }
    $query = $raw.Substring($q + 1)
    foreach ($pair in $query.Split('&')) {
        $eq = $pair.IndexOf('=')
        if ($eq -lt 0) { continue }
        $k = $pair.Substring(0, $eq)
        if ($k -ne $Key) { continue }
        $v = $pair.Substring($eq + 1)
        try { return [System.Uri]::UnescapeDataString($v) } catch { return $v }
    }
    return $null
}

$script:StagingListCacheBody = $null
$script:StagingListCacheSig = $null
# Per-file parse cache (path -> @{ ticks; obj }) so a signature miss (ANY new/
# changed sidecar) only re-reads/re-parses the files that actually changed,
# not the whole .staging folder. Before this, one new letter dropping in with
# 1500+ existing sidecars meant re-reading and re-parsing all 1500+ of them on
# every poll that saw the new file.
$script:StagingFileParseCache = @{}

function Remove-SidecarEmbeddedBytesText {
    # Strip the huge "fileBase64"/"fileMimeType" values from a sidecar's RAW text
    # BEFORE parsing. ConvertFrom-Json on a 4 MB base64 string is what made the
    # endpoint take minutes / run out of memory. base64 and mime values never
    # contain a double-quote, so a simple text strip is safe, then we tidy any
    # dangling comma left behind (e.g. when the stripped field was last).
    param([string]$Raw)
    $t = $Raw
    $t = [regex]::Replace($t, '"fileBase64"\s*:\s*"[^"]*"\s*,?', '')
    $t = [regex]::Replace($t, '"fileMimeType"\s*:\s*"[^"]*"\s*,?', '')
    $t = [regex]::Replace($t, ',(\s*[}\]])', '$1')
    return $t
}

function Get-StagingSidecarsBody {
    # List ACC-Inbox\.staging\*.json as a JSON array for Review Queue auto-import.
    if (-not (Get-Command Resolve-InboxPath -ErrorAction SilentlyContinue)) { return $null }
    try {
        $inbox = Resolve-InboxPath -ScriptRoot $bootstrapRoot
        $staging = Join-Path $inbox '.staging'
        if (-not (Test-Path -LiteralPath $staging -PathType Container)) {
            $utf8Empty = New-Object System.Text.UTF8Encoding $false
            return $utf8Empty.GetBytes('[]')
        }

        $files = [System.IO.Directory]::GetFiles($staging, '*.json')

        # Cheap signature (count + newest mtime) so repeated 30s polls don't
        # re-read every sidecar. GetLastWriteTimeUtc reads no file content.
        $maxTicks = [long]0
        foreach ($f in $files) {
            $ticks = [System.IO.File]::GetLastWriteTimeUtc($f).Ticks
            if ($ticks -gt $maxTicks) { $maxTicks = $ticks }
        }
        $sig = "{0}:{1}" -f $files.Count, $maxTicks
        if ($script:StagingListCacheBody -and $script:StagingListCacheSig -eq $sig) {
            return $script:StagingListCacheBody
        }

        $items = New-Object System.Collections.Generic.List[object]
        $seenPaths = New-Object System.Collections.Generic.HashSet[string]
        foreach ($path in $files) {
            [void]$seenPaths.Add($path)
            $ticksNow = [System.IO.File]::GetLastWriteTimeUtc($path).Ticks
            $cached = $script:StagingFileParseCache[$path]
            if ($cached -and $cached.ticks -eq $ticksNow) {
                [void]$items.Add($cached.obj)
                continue
            }
            try {
                $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
                $hadBytes = $raw -match '"fileBase64"\s*:'
                $lean = if ($hadBytes) { Remove-SidecarEmbeddedBytesText -Raw $raw } else { $raw }
                $obj = $lean | ConvertFrom-Json
                if ($obj) {
                    [void]$items.Add($obj)
                    # Self-heal: rewrite the sidecar without its embedded bytes so
                    # it is small forever (bytes stay resolvable by hash via
                    # /_acc/inbox-file). One-time cost the first time we see a
                    # legacy heavy sidecar; keeps the disk and this endpoint lean.
                    $cacheTicks = $ticksNow
                    if ($hadBytes) {
                        try {
                            $tmp = $path + '.tmp'
                            $utf8w = New-Object System.Text.UTF8Encoding $false
                            [System.IO.File]::WriteAllText($tmp, ($lean.Trim()), $utf8w)
                            Move-Item -LiteralPath $tmp -Destination $path -Force
                            $cacheTicks = [System.IO.File]::GetLastWriteTimeUtc($path).Ticks
                        } catch {}
                    }
                    $script:StagingFileParseCache[$path] = @{ ticks = $cacheTicks; obj = $obj }
                }
            } catch {}
        }
        # Drop cache entries for sidecars that no longer exist on disk so this
        # hashtable doesn't grow unbounded across a long-running launcher session.
        if ($script:StagingFileParseCache.Count -gt $seenPaths.Count) {
            $stale = @($script:StagingFileParseCache.Keys | Where-Object { -not $seenPaths.Contains($_) })
            foreach ($k in $stale) { $script:StagingFileParseCache.Remove($k) }
        }
        # Windows PowerShell 5.1 unwraps a single-element array to a bare object.
        # The browser bridge requires a JSON array (localAccBridge checks Array.isArray).
        $arr = @($items.ToArray())
        if ($arr.Count -eq 0) {
            $json = '[]'
        } elseif ($arr.Count -eq 1) {
            $inner = ConvertTo-Json -InputObject $arr[0] -Depth 10 -Compress:$false
            $json = "[$inner]"
        } else {
            $json = ConvertTo-Json -InputObject $arr -Depth 10 -Compress:$false
        }
        if ([string]::IsNullOrWhiteSpace($json)) { $json = '[]' }
        $utf8 = New-Object System.Text.UTF8Encoding $false
        $body = $utf8.GetBytes($json)

        # Recompute the signature after self-heal rewrites (their mtimes changed)
        # so the next poll hits the cache instead of rebuilding again.
        $maxTicks2 = [long]0
        foreach ($f in [System.IO.Directory]::GetFiles($staging, '*.json')) {
            $ticks2 = [System.IO.File]::GetLastWriteTimeUtc($f).Ticks
            if ($ticks2 -gt $maxTicks2) { $maxTicks2 = $ticks2 }
        }
        $script:StagingListCacheSig = "{0}:{1}" -f $files.Count, $maxTicks2
        $script:StagingListCacheBody = $body
        return $body
    } catch {
        return $null
    }
}

$script:InboxHashMap = $null
$script:InboxHashSig = $null

function Get-InboxLetterFiles {
    # All resolvable letter files: processed\ first (where folder-watch moves
    # them), then the inbox root (not-yet-moved drops). Top level only.
    param([string]$InboxFull)
    $list = New-Object System.Collections.Generic.List[string]
    $dirs = @()
    $proc = Join-Path $InboxFull 'processed'
    if (Test-Path -LiteralPath $proc -PathType Container) { $dirs += $proc }
    $dirs += $InboxFull
    foreach ($d in $dirs) {
        foreach ($pattern in @('*.pdf', '*.docx', '*.doc')) {
            try {
                foreach ($f in [System.IO.Directory]::GetFiles($d, $pattern, [System.IO.SearchOption]::TopDirectoryOnly)) {
                    [void]$list.Add($f)
                }
            } catch {}
        }
    }
    return $list
}

function Get-InboxHashMap {
    # Content-addressed fallback: SHA-256 -> full path for every letter file on
    # disk. Rebuilt only when the file set changes (count + newest mtime), cached
    # for the session, and persisted back to hash-index.json so the fast path
    # works next time. This makes /_acc/inbox-file resolve letters even when the
    # hash-index is missing, stale, or was written by a different tool - which is
    # what was causing every preview to 404.
    param([string]$InboxFull)
    $files = Get-InboxLetterFiles -InboxFull $InboxFull
    $maxTicks = [long]0
    foreach ($f in $files) {
        $t = [System.IO.File]::GetLastWriteTimeUtc($f).Ticks
        if ($t -gt $maxTicks) { $maxTicks = $t }
    }
    $sig = "{0}:{1}" -f $files.Count, $maxTicks
    if ($script:InboxHashMap -and $script:InboxHashSig -eq $sig) { return $script:InboxHashMap }

    Write-LauncherLogSafe ("Building inbox hash map ({0} letter files)..." -f $files.Count)
    $map = @{}
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        foreach ($f in $files) {
            try {
                $fs = [System.IO.File]::OpenRead($f)
                try { $bytes = $sha.ComputeHash($fs) } finally { $fs.Dispose() }
                $hex = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
                if (-not $map.ContainsKey($hex)) { $map[$hex] = $f }
            } catch {}
        }
    } finally {
        $sha.Dispose()
    }
    $script:InboxHashMap = $map
    $script:InboxHashSig = $sig

    # Persist to hash-index.json (relative paths) so the fast path resolves next run.
    try {
        $metaDir = Join-Path $InboxFull '.email-sync'
        [void][System.IO.Directory]::CreateDirectory($metaDir)
        $idxOut = @{}
        $prefix = $InboxFull.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
        foreach ($k in $map.Keys) {
            $p = $map[$k]
            if ($p.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                $idxOut[$k] = $p.Substring($prefix.Length)
            }
        }
        $indexPath = Join-Path $metaDir 'hash-index.json'
        $json = ($idxOut | ConvertTo-Json -Depth 3 -Compress:$false)
        if ([string]::IsNullOrWhiteSpace($json) -or $json -eq 'null') { $json = '{}' }
        $tmp = $indexPath + '.tmp'
        [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding $false))
        Move-Item -LiteralPath $tmp -Destination $indexPath -Force
    } catch {}

    return $map
}

function Resolve-InboxFileByHash {
    # Hash-only lookup via .email-sync\hash-index.json (no arbitrary paths).
    # Returns full path or $null. Restricts to .pdf/.docx under ACC-Inbox.
    param([string]$Hash)
    if ([string]::IsNullOrWhiteSpace($Hash)) { return $null }
    $h = $Hash.Trim().ToLowerInvariant()
    if ($h -notmatch '^[a-f0-9]{64}$') { return $null }
    if (-not (Get-Command Resolve-InboxPath -ErrorAction SilentlyContinue)) { return $null }
    try {
        $inbox = Resolve-InboxPath -ScriptRoot $bootstrapRoot
        $inboxFull = [System.IO.Path]::GetFullPath($inbox)
        $indexPath = Join-Path $inbox (Join-Path '.email-sync' 'hash-index.json')
        $rel = $null
        if (Test-Path -LiteralPath $indexPath -PathType Leaf) {
            $index = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($index) {
                $prop = $index.PSObject.Properties[$h]
                if ($prop) { $rel = [string]$prop.Value }
            }
        }
        if ([string]::IsNullOrWhiteSpace($rel)) {
            $metaPath = Join-Path $inbox (Join-Path '.email-sync' ("{0}.meta.json" -f $h))
            if (Test-Path -LiteralPath $metaPath -PathType Leaf) {
                $meta = Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($meta.relativePath) { $rel = [string]$meta.relativePath }
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($rel)) {
            # Reject path traversal in the relative path.
            $traversal = $false
            foreach ($seg in ($rel -replace '\\', '/').Split('/')) {
                if ($seg -eq '..' -or $seg -eq '.') { $traversal = $true; break }
            }
            if (-not $traversal) {
                $candidate = Join-Path $inboxFull ($rel -replace '/', [System.IO.Path]::DirectorySeparatorChar)
                $full = [System.IO.Path]::GetFullPath($candidate)
                # Require a trailing separator so ACC-Inbox-evil\... cannot match ACC-Inbox prefix.
                $inboxPrefix = $inboxFull.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
                if ($full.StartsWith($inboxPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
                    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
                    if ($ext -eq '.pdf' -or $ext -eq '.docx' -or $ext -eq '.doc') {
                        return $full
                    }
                }
            }
        }

        # Fast path missed (no index entry, stale path, renamed/moved file).
        # Fall back to a content-hash scan of the inbox so the letter still
        # resolves. Cached + persisted so this cost is paid at most once.
        $map = Get-InboxHashMap -InboxFull $inboxFull
        if ($map.ContainsKey($h)) {
            $full = $map[$h]
            if (Test-Path -LiteralPath $full -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
                if ($ext -eq '.pdf' -or $ext -eq '.docx' -or $ext -eq '.doc') {
                    return $full
                }
            }
        }
        return $null
    } catch {
        return $null
    }
}

function Get-EmailMetaBody {
    # Small lookup so the app can backfill emailDate onto already-imported Review
    # Queue items without re-importing the whole sidecar (which would be skipped
    # as a duplicate). Returns {"emailDate":"...","emailDateApprox":bool} or $null.
    param([string]$Hash)
    if ([string]::IsNullOrWhiteSpace($Hash)) { return $null }
    $h = $Hash.Trim().ToLowerInvariant()
    if ($h -notmatch '^[a-f0-9]{64}$') { return $null }
    if (-not (Get-Command Resolve-InboxPath -ErrorAction SilentlyContinue)) { return $null }
    try {
        $inbox = Resolve-InboxPath -ScriptRoot $bootstrapRoot
        $metaPath = Join-Path $inbox (Join-Path '.email-sync' ("{0}.meta.json" -f $h))
        if (-not (Test-Path -LiteralPath $metaPath -PathType Leaf)) { return $null }
        $meta = Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $meta.emailDate) { return $null }
        $out = [ordered]@{
            emailDate       = [string]$meta.emailDate
            emailDateApprox = [bool]$meta.emailDateApprox
        }
        $json = $out | ConvertTo-Json -Depth 3 -Compress:$false
        $utf8 = New-Object System.Text.UTF8Encoding $false
        return $utf8.GetBytes($json)
    } catch {
        return $null
    }
}

function Get-StaticContentType {
    param([string]$Extension)
    switch ($Extension.ToLowerInvariant()) {
        '.html' { return 'text/html; charset=utf-8' }
        '.htm'  { return 'text/html; charset=utf-8' }
        '.js'   { return 'application/javascript; charset=utf-8' }
        '.mjs'  { return 'application/javascript; charset=utf-8' }
        '.css'  { return 'text/css; charset=utf-8' }
        '.json' { return 'application/json; charset=utf-8' }
        '.txt'  { return 'text/plain; charset=utf-8' }
        default { return 'application/octet-stream' }
    }
}

function Get-EmailSyncStatusBody {
    $statusPath = Join-Path $env:USERPROFILE 'ACC-Suite\email-sync-status.json'
    if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
        return [System.IO.File]::ReadAllBytes($statusPath)
    }

    $statePath = Join-Path $env:USERPROFILE 'ACC-Suite\email-sync-state.json'
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
        return $null
    }

    try {
        $raw = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8
        $obj = $raw | ConvertFrom-Json
        $lastRunAt = $null
        if ($obj.runStats -and $obj.runStats.lastRunAt) {
            $lastRunAt = [string]$obj.runStats.lastRunAt
        }
        if (-not $lastRunAt) { return $null }

        $ids = @()
        if ($obj.processedEntryIds) { $ids = @($obj.processedEntryIds) }
        $fallback = @{
            version            = 1
            lastRunAt          = $lastRunAt
            outcome            = 'ok'
            mode               = 'backlog'
            savedCount         = 0
            skippedCount       = if ($obj.runStats.totalSkipped) { [int]$obj.runStats.totalSkipped } else { 0 }
            errorCount         = if ($obj.runStats.totalErrors) { [int]$obj.runStats.totalErrors } else { 0 }
            savedFiles         = @()
            errors             = @()
            inboxPath          = ''
            sharedMailbox      = ''
            processedTotal     = $ids.Count
            inferredFromState  = $true
        }
        $json = $fallback | ConvertTo-Json -Depth 4 -Compress:$false
        $utf8 = New-Object System.Text.UTF8Encoding $false
        return $utf8.GetBytes($json)
    } catch {
        return $null
    }
}

function Resolve-StaticFile {
    param(
        [string]$Root,
        [string]$RequestPath
    )
    if ($RequestPath -eq '/' -or $RequestPath -eq '/index.html') {
        return Join-Path $Root 'index.html'
    }
    $rel = $RequestPath.TrimStart('/')
    if ([string]::IsNullOrEmpty($rel)) {
        return Join-Path $Root 'index.html'
    }
    foreach ($seg in $rel.Split('/')) {
        if ($seg -eq '..' -or $seg -eq '.') { return $null }
    }
    $candidate = Join-Path $Root ($rel -replace '/', [System.IO.Path]::DirectorySeparatorChar)
    try {
        $full = [System.IO.Path]::GetFullPath($candidate)
        $rootFull = [System.IO.Path]::GetFullPath($Root)
        if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $null
        }
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
            return $null
        }
        return $full
    } catch {
        return $null
    }
}

try {
    $ErrorActionPreference = 'Stop'

    # --- Optional logging (must never block launch) ----------------------------
    try {
        $logRoot = $PSScriptRoot
        if ([string]::IsNullOrEmpty($logRoot)) { $logRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
        $logHelper = Join-Path $logRoot 'launcher-log.ps1'
        if (Test-Path -LiteralPath $logHelper) {
            . $logHelper
            Initialize-LauncherLog -Prefix 'acc-suite' -ShowSuccessOnExit:$false | Out-Null
            $script:LauncherLogEnabled = $true
            if (Get-Command Show-LauncherLogPath -ErrorAction SilentlyContinue) { Show-LauncherLogPath }
        }
    } catch {}

    # --- Resolve the file to serve (sibling index.html) -----------------------
    $root = $PSScriptRoot
    if ([string]::IsNullOrEmpty($root)) { $root = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
    $indexPath = Join-Path $root 'index.html'

    Write-LauncherLogSafe "Step: resolve index.html ($indexPath)"

    if (-not (Test-Path -LiteralPath $indexPath)) {
        Write-LauncherLogSafe "ERROR: index.html not found at $indexPath"
        try {
            if ($script:LauncherLogEnabled) { Write-LauncherLogException (New-Object System.IO.FileNotFoundException "index.html was not found next to this script: $indexPath") }
        } catch {}
        Write-Host "ERROR: index.html was not found next to this script:" -ForegroundColor Red
        Write-Host "  $indexPath" -ForegroundColor Red
        Write-Host ""
        Write-Host "Make sure launch.ps1 sits in the same folder as index.html." -ForegroundColor Yellow
        Read-Host "Press Enter to close"
        exit 1
    }

    # Read the whole single-file app once into memory.
    Write-LauncherLogSafe 'Step: read index.html'
    $htmlBytes = [System.IO.File]::ReadAllBytes($indexPath)

    # --- Bind a TcpListener to loopback on a free port ------------------------
    Write-LauncherLogSafe 'Step: bind TcpListener to loopback'
    $loopback = [System.Net.IPAddress]::Loopback   # 127.0.0.1 ONLY - never 0.0.0.0
    $preferred = 8765
    $maxPort = 8800

    $listener = $null
    $port = 0
    $candidate = $null

    for ($p = $preferred; $p -le $maxPort; $p++) {
        $candidate = $null
        try {
            $candidate = New-Object System.Net.Sockets.TcpListener($loopback, $p)
            $candidate.Start()
            $listener = $candidate
            $port = $p
            break
        } catch {
            if ($candidate) { try { $candidate.Stop() } catch {} }
        }
    }

    if ($null -eq $listener) {
        try {
            $candidate = New-Object System.Net.Sockets.TcpListener($loopback, 0)
            $candidate.Start()
            $listener = $candidate
            $port = ([System.Net.IPEndPoint]$candidate.LocalEndpoint).Port
        } catch {
            throw "Could not bind a local port: $($_.Exception.Message)"
        }
    }

    $url = "http://127.0.0.1:$port/"
    Write-LauncherLogSafe "Step: listening at $url"

    # --- Friendly banner ------------------------------------------------------
    Write-Host ""
    Write-Host "  ACC District Nursing Admin Suite" -ForegroundColor Cyan
    Write-Host "  --------------------------------" -ForegroundColor Cyan
    Write-Host "  Serving locally at: $url" -ForegroundColor Green
    Write-Host "  URL=$url"
    Write-Host ""
    Write-Host "  This is LOCAL ONLY (loopback 127.0.0.1) - nothing is exposed to the network." -ForegroundColor Gray
    Write-Host "  Keep this window open while you use the app; close it (or press Ctrl+C) to stop." -ForegroundColor Yellow
    Write-Host ""

    # --- Open the browser (Edge preferred; multiple paths + cmd start fallback) -
    Write-LauncherLogSafe 'Step: open browser'
    $browserOpened = $false

    $edgePaths = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
        'msedge.exe'
    )
    foreach ($edgePath in $edgePaths) {
        if (Try-OpenAccSuiteBrowser -Label "Microsoft Edge ($edgePath)" -FilePath $edgePath -ArgumentList @($url) -SkipPathCheck:($edgePath -eq 'msedge.exe')) {
            $browserOpened = $true
            break
        }
    }

    if (-not $browserOpened) {
        $chromePaths = @(
            (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
            (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')
            'chrome.exe'
        )
        foreach ($chromePath in $chromePaths) {
            if (Try-OpenAccSuiteBrowser -Label "Google Chrome ($chromePath)" -FilePath $chromePath -ArgumentList @($url) -SkipPathCheck:($chromePath -eq 'chrome.exe')) {
                $browserOpened = $true
                break
            }
        }
    }

    if (-not $browserOpened) {
        Write-LauncherLogSafe 'Step: try browser - default handler (Start-Process URL)'
        try {
            Write-LauncherLogSafe 'Step: Start-Process before - default handler'
            Start-Process $url -ErrorAction Stop | Out-Null
            Write-LauncherLogSafe 'Step: Start-Process after - default handler (ok)'
            $browserOpened = $true
        } catch {
            Write-LauncherLogSafe "Step: Start-Process after - default handler (failed: $($_.Exception.Message))"
        }
    }

    if (-not $browserOpened) {
        if (Try-OpenAccSuiteBrowser -Label 'cmd start URL' -FilePath 'cmd.exe' -ArgumentList @('/c', 'start', '""', $url)) {
            $browserOpened = $true
        }
    }

    if (-not $browserOpened) {
        Write-LauncherLogSafe "WARN: could not auto-open browser - open manually: $url"
        Write-Host ""
        Write-Host "  Could not auto-open a browser." -ForegroundColor Yellow
        Write-Host "  Open manually: $url" -ForegroundColor Yellow
        Write-Host ""
    } else {
        Write-LauncherLogSafe 'Step: browser open succeeded'
    }

    $notFound = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')

    # --- Serve loop: resilient, one bad connection never kills the server -----
    Write-LauncherLogSafe 'Step: enter serve loop'
    try {
        while ($true) {
            $client = $null
            try {
                $client = $listener.AcceptTcpClient()
                $client.ReceiveTimeout = 5000
                $client.SendTimeout = 5000

                $stream = $client.GetStream()

                $buffer = New-Object byte[] 8192
                $sb = New-Object System.Text.StringBuilder
                $requestLine = ''
                $deadline = [DateTime]::UtcNow.AddSeconds(5)

                while ([DateTime]::UtcNow -lt $deadline) {
                    if ($stream.DataAvailable -or $client.Available -gt 0) {
                        $read = $stream.Read($buffer, 0, $buffer.Length)
                        if ($read -le 0) { break }
                        [void]$sb.Append([System.Text.Encoding]::ASCII.GetString($buffer, 0, $read))
                        $text = $sb.ToString()
                        $nl = $text.IndexOf("`n")
                        if ($nl -ge 0) {
                            $requestLine = $text.Substring(0, $nl).Trim()
                            break
                        }
                        if ($sb.Length -gt 65536) { break }
                    } else {
                        Start-Sleep -Milliseconds 10
                    }
                }

                $method = ''
                if ($requestLine) {
                    $parts = $requestLine.Split(' ')
                    if ($parts.Length -ge 1) { $method = $parts[0].ToUpperInvariant() }
                }

                if ($method -eq 'GET') {
                    $reqPath = Get-RequestPath -RequestLine $requestLine
                    if ($reqPath -eq '/_acc/email-sync-status.json') {
                        $body = Get-EmailSyncStatusBody
                        if ($body) {
                            Send-Response -Client $client -StatusCode 200 -StatusText 'OK' -Body $body -ContentType 'application/json; charset=utf-8'
                        } else {
                            Send-Response -Client $client -StatusCode 404 -StatusText 'Not Found' -Body $notFound -ContentType 'text/plain; charset=utf-8'
                        }
                    } elseif ($reqPath -eq '/_acc/staging') {
                        $body = Get-StagingSidecarsBody
                        if ($null -ne $body) {
                            Send-Response -Client $client -StatusCode 200 -StatusText 'OK' -Body $body -ContentType 'application/json; charset=utf-8'
                        } else {
                            Send-Response -Client $client -StatusCode 404 -StatusText 'Not Found' -Body $notFound -ContentType 'text/plain; charset=utf-8'
                        }
                    } elseif ($reqPath -eq '/_acc/email-meta') {
                        $hash = Get-RequestQueryValue -RequestLine $requestLine -Key 'hash'
                        $body = Get-EmailMetaBody -Hash $hash
                        if ($null -ne $body) {
                            Send-Response -Client $client -StatusCode 200 -StatusText 'OK' -Body $body -ContentType 'application/json; charset=utf-8'
                        } else {
                            Send-Response -Client $client -StatusCode 404 -StatusText 'Not Found' -Body $notFound -ContentType 'text/plain; charset=utf-8'
                        }
                    } elseif ($reqPath -eq '/_acc/inbox-file') {
                        $hash = Get-RequestQueryValue -RequestLine $requestLine -Key 'hash'
                        $filePath = Resolve-InboxFileByHash -Hash $hash
                        if ($filePath) {
                            $body = [System.IO.File]::ReadAllBytes($filePath)
                            $ext = [System.IO.Path]::GetExtension($filePath)
                            $ctype = Get-StaticContentType -Extension $ext
                            Send-Response -Client $client -StatusCode 200 -StatusText 'OK' -Body $body -ContentType $ctype
                        } else {
                            Send-Response -Client $client -StatusCode 404 -StatusText 'Not Found' -Body $notFound -ContentType 'text/plain; charset=utf-8'
                        }
                    } else {
                        $filePath = Resolve-StaticFile -Root $root -RequestPath $reqPath
                        if ($filePath) {
                            if ($filePath -eq $indexPath) {
                                $body = $htmlBytes
                            } else {
                                $body = [System.IO.File]::ReadAllBytes($filePath)
                            }
                            $ext = [System.IO.Path]::GetExtension($filePath)
                            $ctype = Get-StaticContentType -Extension $ext
                            Send-Response -Client $client -StatusCode 200 -StatusText 'OK' -Body $body -ContentType $ctype
                        } else {
                            Send-Response -Client $client -StatusCode 404 -StatusText 'Not Found' -Body $notFound -ContentType 'text/plain; charset=utf-8'
                        }
                    }
                } else {
                    Send-Response -Client $client -StatusCode 404 -StatusText 'Not Found' -Body $notFound -ContentType 'text/plain; charset=utf-8'
                }
            } catch {
                # Malformed request, reset connection, etc. - keep the server alive.
            } finally {
                if ($client) { try { $client.Close() } catch {} }
            }
        }
    } finally {
        if ($listener) { try { $listener.Stop() } catch {} }
        Write-LauncherLogSafe 'Step: server stopped'
        Write-Host ""
        Write-Host "  Server stopped. You can close this window." -ForegroundColor Gray
    }
} catch {
    Write-BootstrapLog "FATAL: $($_.Exception.Message)"
    if ($_.ScriptStackTrace) { Write-BootstrapLog $_.ScriptStackTrace }
    Write-LauncherLogSafe "FATAL: $($_.Exception.Message)"
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}
