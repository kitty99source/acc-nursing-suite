param()

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'wfh'
. (Join-Path $bootstrapRoot 'inbox-config.ps1')
Write-BootstrapLog 'Reindex-InboxHashes.ps1 started'

# Rebuilds .email-sync\hash-index.json by hashing every letter file in the
# inbox (processed\ + root). The launcher's /_acc/inbox-file endpoint maps a
# letter's SHA-256 to its file via this index; if the index is missing or stale
# (files renamed/moved by another tool), EVERY letter preview 404s in the
# Review Queue. Run this once to repair it. Safe to run repeatedly.

Write-Host ''
Write-Host '  ACC inbox hash reindex (one-off repair)' -ForegroundColor Cyan
Write-Host '  ---------------------------------------' -ForegroundColor Cyan
Write-Host '  Rebuilds the hash -> file map so letter previews load in Review Queue.' -ForegroundColor Gray
Write-Host ''

$inbox = Resolve-InboxPath -ScriptRoot $bootstrapRoot
$inboxFull = [System.IO.Path]::GetFullPath($inbox)
if (-not (Test-Path -LiteralPath $inboxFull -PathType Container)) {
    Write-Host "Inbox not found at $inboxFull - nothing to index." -ForegroundColor Yellow
    exit 0
}

$dirs = @()
$proc = Join-Path $inboxFull 'processed'
if (Test-Path -LiteralPath $proc -PathType Container) { $dirs += $proc }
$dirs += $inboxFull

$files = New-Object System.Collections.Generic.List[string]
foreach ($d in $dirs) {
    foreach ($pattern in @('*.pdf', '*.docx', '*.doc')) {
        try {
            foreach ($f in [System.IO.Directory]::GetFiles($d, $pattern, [System.IO.SearchOption]::TopDirectoryOnly)) {
                [void]$files.Add($f)
            }
        } catch {}
    }
}

$total = $files.Count
Write-Host ("Found {0} letter file(s) to hash." -f $total) -ForegroundColor Gray
if ($total -eq 0) {
    Write-Host 'No .pdf/.docx/.doc files found - nothing to index.' -ForegroundColor Yellow
    exit 0
}

$startedAt = Get-Date
$idx = 0
$hashed = 0
$failed = 0
$map = @{}
$prefix = $inboxFull.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
    foreach ($f in $files) {
        $idx++
        if ($idx % 50 -eq 0 -or $idx -eq $total) {
            $elapsed = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds)
            Write-Host ("  ... {0}/{1} ({2}s, {3} hashed, {4} failed)" -f $idx, $total, $elapsed, $hashed, $failed) -ForegroundColor Gray
        }
        try {
            $fs = [System.IO.File]::OpenRead($f)
            try { $bytes = $sha.ComputeHash($fs) } finally { $fs.Dispose() }
            $hex = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
            if ($f.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                $rel = $f.Substring($prefix.Length)
                if (-not $map.ContainsKey($hex)) { $map[$hex] = $rel }
            }
            $hashed++
        } catch {
            $failed++
        }
    }
} finally {
    $sha.Dispose()
}

try {
    $metaDir = Join-Path $inboxFull '.email-sync'
    [void][System.IO.Directory]::CreateDirectory($metaDir)
    $indexPath = Join-Path $metaDir 'hash-index.json'
    $json = ($map | ConvertTo-Json -Depth 3 -Compress:$false)
    if ([string]::IsNullOrWhiteSpace($json) -or $json -eq 'null') { $json = '{}' }
    $tmp = $indexPath + '.tmp'
    [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding $false))
    Move-Item -LiteralPath $tmp -Destination $indexPath -Force
    Write-Host ''
    Write-Host ("Done. Indexed {0} unique letter(s) into hash-index.json ({1} failed)." -f $map.Count, $failed) -ForegroundColor Green
    Write-Host "  Index: $indexPath" -ForegroundColor Gray
} catch {
    Write-Host "FAIL - could not write hash-index.json: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '  Next: refresh the Review Queue - letter previews should now load.' -ForegroundColor Gray
Write-Host ''
