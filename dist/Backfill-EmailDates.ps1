param()

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'email-sync'
. (Join-Path $bootstrapRoot 'inbox-config.ps1')
Write-BootstrapLog 'Backfill-EmailDates.ps1 started'

# One-off repair tool for letters synced BEFORE emailDate was added to .email-sync
# meta.json (2026-07-10). Walks every {hash}.meta.json missing emailDate and fills
# it in so already-processed items pick up "Email received" in the Review Queue.
#
# Preferred source: Outlook COM lookup by EntryID (exact ReceivedTime).
# Fallback: the saved attachment file's LastWriteTimeUtc (approximate - marked
# with emailDateApprox=true so it is never confused with a real Outlook date).
#
# Safe to run repeatedly: only patches meta.json files that are still missing
# emailDate, and never touches already-imported Review Queue items directly
# (those are patched by the "Backfill email dates" button in the app, which
# reads emailDate back out via the /_acc/email-meta bridge endpoint).

Write-Host ''
Write-Host '  ACC email date backfill (one-off repair)' -ForegroundColor Cyan
Write-Host '  -----------------------------------------' -ForegroundColor Cyan
Write-Host '  Filling in emailDate for letters synced before this field existed.' -ForegroundColor Gray
Write-Host ''

$inbox = Resolve-InboxPath -ScriptRoot $bootstrapRoot
$metaDir = Join-Path $inbox '.email-sync'
if (-not (Test-Path -LiteralPath $metaDir -PathType Container)) {
    Write-Host "No .email-sync folder found at $metaDir - nothing to backfill." -ForegroundColor Yellow
    exit 0
}

$metaFiles = @(Get-ChildItem -LiteralPath $metaDir -Filter '*.meta.json' -File -ErrorAction SilentlyContinue)
if ($metaFiles.Count -eq 0) {
    Write-Host 'No .meta.json files found - nothing to backfill.' -ForegroundColor Yellow
    exit 0
}

$missing = @()
foreach ($f in $metaFiles) {
    try {
        $meta = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $meta.emailDate) { $missing += [pscustomobject]@{ Path = $f.FullName; Meta = $meta } }
    } catch {
        Write-Host "  WARN - could not read $($f.Name): $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ("Found {0} meta file(s), {1} missing emailDate." -f $metaFiles.Count, $missing.Count) -ForegroundColor Gray
if ($missing.Count -eq 0) {
    Write-Host 'Everything already has an email date. Nothing to do.' -ForegroundColor Green
    exit 0
}

$outlook = $null
$namespace = $null
try {
    Write-Host 'Connecting to Outlook.Application COM object (for exact received times)...' -ForegroundColor Gray
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace('MAPI')
    [void]$namespace.Logon($null, $null, $false, $true)
    Write-Host 'OK - Outlook COM connected.' -ForegroundColor Green
} catch {
    Write-Host "WARN - could not connect to Outlook ($($_.Exception.Message)); falling back to file timestamps for all items." -ForegroundColor Yellow
    $namespace = $null
}

$fromOutlook = 0
$fromFileTime = 0
$failed = 0

foreach ($row in $missing) {
    $meta = $row.Meta
    $hash = [string]$meta.hash
    $entryId = [string]$meta.entryId
    $emailDateIso = $null
    $approx = $false

    if ($namespace -and -not [string]::IsNullOrWhiteSpace($entryId)) {
        try {
            $item = $namespace.GetItemFromID($entryId)
            if ($item -and $item.ReceivedTime) {
                $received = [datetime]$item.ReceivedTime
                $emailDateIso = $received.ToUniversalTime().ToString('o')
                $fromOutlook++
            }
        } catch {
            # Stale EntryID (moved/deleted mail, different store) - fall through to file time.
        }
    }

    if (-not $emailDateIso) {
        $candidatePaths = @()
        if ($meta.relativePath) { $candidatePaths += (Join-Path $inbox ([string]$meta.relativePath)) }
        if ($meta.descriptiveFileName) { $candidatePaths += (Join-Path $inbox (Join-Path 'processed' ([string]$meta.descriptiveFileName))) }
        if ($meta.fileName) { $candidatePaths += (Join-Path $inbox (Join-Path 'processed' ([string]$meta.fileName))) }
        foreach ($p in $candidatePaths) {
            if (Test-Path -LiteralPath $p -PathType Leaf) {
                try {
                    $emailDateIso = (Get-Item -LiteralPath $p).LastWriteTimeUtc.ToString('o')
                    $approx = $true
                    $fromFileTime++
                } catch {}
                break
            }
        }
    }

    if (-not $emailDateIso) {
        $failed++
        continue
    }

    try {
        $meta | Add-Member -NotePropertyName emailDate -NotePropertyValue $emailDateIso -Force
        $meta | Add-Member -NotePropertyName emailDateApprox -NotePropertyValue $approx -Force
        $json = $meta | ConvertTo-Json -Depth 4 -Compress:$false
        $tmpPath = $row.Path + '.tmp'
        [System.IO.File]::WriteAllText($tmpPath, $json, [Text.Encoding]::UTF8)
        Move-Item -LiteralPath $tmpPath -Destination $row.Path -Force

        # Also patch any still-pending .staging sidecar for this hash so a fresh
        # import (or anyone who clears IndexedDB) gets the date immediately.
        if ($hash) {
            $stagingDir = Join-Path $inbox '.staging'
            if (Test-Path -LiteralPath $stagingDir -PathType Container) {
                foreach ($sc in @(Get-ChildItem -LiteralPath $stagingDir -Filter ("{0}_*.json" -f $hash) -File -ErrorAction SilentlyContinue)) {
                    try {
                        $scObj = Get-Content -LiteralPath $sc.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
                        if ($scObj -and $scObj.item) {
                            $scObj.item | Add-Member -NotePropertyName emailDate -NotePropertyValue $emailDateIso -Force
                            $scJson = $scObj | ConvertTo-Json -Depth 6 -Compress:$false
                            [System.IO.File]::WriteAllText($sc.FullName, $scJson, [Text.Encoding]::UTF8)
                        }
                    } catch {}
                }
            }
        }
    } catch {
        Write-Host "  WARN - could not write $($row.Path): $($_.Exception.Message)" -ForegroundColor Yellow
        $failed++
    }
}

Write-Host ''
Write-Host ("Done. Outlook lookups: {0}, file-time fallback: {1}, could not resolve: {2}." -f $fromOutlook, $fromFileTime, $failed) -ForegroundColor Green
Write-Host ''
Write-Host '  Next: open the app and click "Backfill email dates" in Review Queue' -ForegroundColor Gray
Write-Host '  (Check queue health panel) to pull these dates into already-staged items.' -ForegroundColor Gray
Write-Host ''
