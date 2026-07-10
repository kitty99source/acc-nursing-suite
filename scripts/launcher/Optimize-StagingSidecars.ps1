param()

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'wfh'
. (Join-Path $bootstrapRoot 'inbox-config.ps1')
Write-BootstrapLog 'Optimize-StagingSidecars.ps1 started'

# One-off performance repair. Early builds embedded the whole letter as base64
# inside each .staging sidecar (up to 4 MB each). With hundreds of letters, the
# /_acc/staging list endpoint choked parsing them and the app showed "Local
# staging bridge is down". This strips the embedded bytes out of every sidecar
# so the list is tiny and fast. The bytes stay resolvable on demand by hash via
# /_acc/inbox-file, so nothing is lost. Safe to run repeatedly.

Write-Host ''
Write-Host '  ACC staging sidecar optimiser (one-off repair)' -ForegroundColor Cyan
Write-Host '  ----------------------------------------------' -ForegroundColor Cyan
Write-Host '  Removing embedded file bytes from .staging sidecars so the' -ForegroundColor Gray
Write-Host '  Review Queue list loads fast (fixes "bridge is down").' -ForegroundColor Gray
Write-Host ''
Write-Host '  TIP: close the Folder Watch window while this runs.' -ForegroundColor Yellow
Write-Host ''

$inbox = Resolve-InboxPath -ScriptRoot $bootstrapRoot
$staging = Join-Path $inbox '.staging'
if (-not (Test-Path -LiteralPath $staging -PathType Container)) {
    Write-Host "No .staging folder found at $staging - nothing to optimise." -ForegroundColor Yellow
    exit 0
}

$files = @(Get-ChildItem -LiteralPath $staging -Filter '*.json' -File -ErrorAction SilentlyContinue)
if ($files.Count -eq 0) {
    Write-Host 'No sidecars found - nothing to optimise.' -ForegroundColor Yellow
    exit 0
}

Write-Host ("Found {0} sidecar(s). Scanning for embedded bytes..." -f $files.Count) -ForegroundColor Gray

$startedAt = Get-Date
$total = $files.Count
$idx = 0
$slimmed = 0
$alreadyLean = 0
$failed = 0
$bytesBefore = [long]0
$bytesAfter = [long]0

foreach ($f in $files) {
    $idx++
    if ($idx % 25 -eq 0 -or $idx -eq $total) {
        $elapsed = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds)
        Write-Host ("  ... {0}/{1} ({2}s, {3} slimmed, {4} already lean, {5} failed)" -f $idx, $total, $elapsed, $slimmed, $alreadyLean, $failed) -ForegroundColor Gray
    }
    try {
        $raw = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
        if ($raw -notmatch '"fileBase64"\s*:') { $alreadyLean++; continue }
        $bytesBefore += [System.Text.Encoding]::UTF8.GetByteCount($raw)
        $lean = [regex]::Replace($raw, '"fileBase64"\s*:\s*"[^"]*"\s*,?', '')
        $lean = [regex]::Replace($lean, '"fileMimeType"\s*:\s*"[^"]*"\s*,?', '')
        $lean = [regex]::Replace($lean, ',(\s*[}\]])', '$1')
        # Validate before overwriting - never leave a corrupt sidecar behind.
        $null = $lean | ConvertFrom-Json
        $leanTrimmed = $lean.Trim()
        $bytesAfter += [System.Text.Encoding]::UTF8.GetByteCount($leanTrimmed)
        $tmp = $f.FullName + '.tmp'
        [System.IO.File]::WriteAllText($tmp, $leanTrimmed, (New-Object System.Text.UTF8Encoding $false))
        Move-Item -LiteralPath $tmp -Destination $f.FullName -Force
        $slimmed++
    } catch {
        Write-Host "  WARN - could not optimise $($f.Name): $($_.Exception.Message)" -ForegroundColor Yellow
        $failed++
    }
}

$savedMb = [Math]::Round(($bytesBefore - $bytesAfter) / 1MB, 1)
Write-Host ''
Write-Host ("Done. Slimmed: {0}, already lean: {1}, failed: {2}. Reclaimed ~{3} MB." -f $slimmed, $alreadyLean, $failed, $savedMb) -ForegroundColor Green
Write-Host ''
Write-Host '  Next: open (or refresh) the Review Queue - the "bridge is down"' -ForegroundColor Gray
Write-Host '  banner should clear and the list should load quickly.' -ForegroundColor Gray
Write-Host ''
