# ============================================================================
#  Find-RemittanceCsv.ps1  --  READ-ONLY remittance/invoice CSV hunter on I: (Admin)
# ----------------------------------------------------------------------------
#  Adapted from Loan Eq / Remittance Tracker for District Nursing Admin Suite.
#  Wider hunt:
#    - Paige root (always)
#    - Team root light scan (always)
#    - Explicit remittance/invoice folders under Paige
#    - I:\ACC\District Nursing (Admin I-drive home)
#    - User Desktop (common drop zone)
#  Scores by filename AND by CSV header tokens (Payment Reference, ACC Claim,
#  Vendor ID, Payment Amount, ACC45 Ref, ProviderID, ClaimNumber, etc.).
#
#  READ-ONLY. Desktop report. Delete after use. Never commit (may contain PHI paths).
# ============================================================================

param(
    [string]$PaigeRoot = 'I:\ACC\Paige',
    [string]$TeamRoot = 'I:\ACC\1 Team',
    [string]$AdminRoot = 'I:\ACC\District Nursing',
    [switch]$SkipTeam,
    [switch]$SkipDesktop,
    [switch]$SkipAdminRoot,
    [string]$OutFile = ''
)

$ErrorActionPreference = 'Continue'

function Write-Info { param([string]$m) Write-Host $m }
function Write-Warn { param([string]$m) Write-Host $m -ForegroundColor Yellow }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ([string]::IsNullOrWhiteSpace($OutFile)) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $OutFile = Join-Path $desktop "RemittanceCsvFind-$stamp.txt"
}

$lines = New-Object System.Collections.Generic.List[string]
function Add-Line {
    param([string]$m)
    [void]$lines.Add($m)
    Write-Info $m
}

Add-Line 'Find Remittance CSV v2 (READ-ONLY)'
Add-Line '----------------------------------'
Add-Line ("Generated: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Add-Line 'Scans Paige + Team (light) + Desktop + known invoice folders.'
Add-Line 'Scores CSV headers even when the filename is generic.'
Add-Line 'PHI WARNING: This report is local. Delete after use. Do not commit.'
Add-Line 'READ-ONLY: does not modify or delete any files.'
Add-Line ''

$namePattern = '(remit|payment|remittance|RemittanceDownload|vendor.?id|payment.?ref)'
$pathHintPattern = '(remit|invoice|payment|acc\s*invoice|1\s*acc)'
$headerTokens = @(
    'payment reference',
    'payment reference number',
    'acc claim',
    'acc claim number',
    'acc45 ref',
    'claim number',
    'remittance',
    'payment date',
    'payment amount',
    'vendor id',
    'bank account',
    'amount paid',
    'scheduleline'
)

function Get-HeaderSnippet {
    param([string]$Path, [int]$MaxChars = 240)
    try {
        $sr = $null
        try {
            $sr = [System.IO.StreamReader]::new($Path, [System.Text.Encoding]::UTF8, $true)
            $first = $sr.ReadLine()
            if ($null -eq $first) { return '' }
            $first = $first.Trim()
            if ($first.Length -gt $MaxChars) { return $first.Substring(0, $MaxChars) + '...' }
            return $first
        } finally {
            if ($null -ne $sr) { $sr.Close(); $sr.Dispose() }
        }
    } catch {
        return ''
    }
}

function Get-RemitScore {
    param([string]$Name, [string]$FullPath, [string]$Ext, [string]$Header)
    $score = 0
    $n = $Name.ToLowerInvariant()
    $p = $FullPath.ToLowerInvariant()
    if ($n -match 'remittance') { $score += 10 }
    elseif ($n -match 'remit') { $score += 8 }
    if ($n -match 'payment') { $score += 3 }
    if ($n -match 'download') { $score += 2 }
    if ($n -match 'acc') { $score += 1 }
    if ($p -match $pathHintPattern) { $score += 4 }
    if ($Ext -eq '.csv') { $score += 5 }
    elseif ($Ext -eq '.xlsx' -or $Ext -eq '.xls') { $score += 1 }

    if (-not [string]::IsNullOrWhiteSpace($Header)) {
        $h = $Header.ToLowerInvariant()
        foreach ($tok in $headerTokens) {
            if ($h.Contains($tok)) { $score += 3 }
        }
        if ($h -match 'payment.?reference') { $score += 5 }
        if ($h -match 'acc.?claim') { $score += 5 }
        if ($h -match 'vendor.?id') { $score += 3 }
        if ($h -match 'payment.?amount') { $score += 3 }
    }
    return $score
}

function Should-ConsiderFile {
    param([System.IO.FileInfo]$File, [string]$Header)
    $ext = $File.Extension.ToLowerInvariant()
    if ($ext -ne '.csv' -and $ext -ne '.xlsx' -and $ext -ne '.xls') { return $false }
    $n = $File.Name
    $p = $File.FullName
    if ($n -match $namePattern) { return $true }
    if ($p -match $pathHintPattern) { return $true }
    # Header-only hits for CSV (expensive path already limited by folder walk)
    if ($ext -eq '.csv' -and -not [string]::IsNullOrWhiteSpace($Header)) {
        $h = $Header.ToLowerInvariant()
        if ($h -match 'payment.?reference' -or $h -match 'acc.?claim' -or $h -match 'vendor.?id') {
            return $true
        }
    }
    return $false
}

function Scan-Root {
    param(
        [string]$Root,
        [string]$Label,
        [int]$MaxDepth,
        [bool]$HeaderSniffAllCsv,
        [System.Collections.Generic.List[object]]$Out
    )
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        Write-Warn ("Root not found: {0}" -f $Root)
        Add-Line ("[{0}] NOT FOUND: {1}" -f $Label, $Root)
        Add-Line ''
        return
    }

    Add-Line ("Scanning {0}: {1} (maxDepth={2})" -f $Label, $Root, $MaxDepth)
    $stack = New-Object System.Collections.Generic.Stack[object]
    $stack.Push(@{ Path = $Root; Depth = 0 })
    $dirsSeen = 0
    $filesSeen = 0
    $hits = 0
    $started = Get-Date

    while ($stack.Count -gt 0) {
        $frame = $stack.Pop()
        $dir = [string]$frame.Path
        $depth = [int]$frame.Depth
        $dirsSeen += 1
        if (($dirsSeen % 20) -eq 0) {
            $elapsed = [int]((Get-Date) - $started).TotalSeconds
            Write-Info ("  ... still scanning ({0}s) - {1} folders, {2} files, {3} hits" -f $elapsed, $dirsSeen, $filesSeen, $hits)
        }

        $entries = @()
        try { $entries = @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue) } catch { continue }

        foreach ($e in $entries) {
            if ($e.PSIsContainer) {
                if ($depth -lt $MaxDepth) {
                    $dn = $e.Name.ToLowerInvariant()
                    if ($dn -eq '$recycle.bin' -or $dn -eq 'system volume information' -or $dn -eq 'node_modules') { continue }
                    $stack.Push(@{ Path = $e.FullName; Depth = ($depth + 1) })
                }
                continue
            }

            $filesSeen += 1
            $ext = $e.Extension.ToLowerInvariant()
            if ($ext -ne '.csv' -and $ext -ne '.xlsx' -and $ext -ne '.xls') { continue }

            $header = ''
            $nameOrPathHit = ($e.Name -match $namePattern) -or ($e.FullName -match $pathHintPattern)
            if ($ext -eq '.csv' -and ($HeaderSniffAllCsv -or $nameOrPathHit)) {
                # Cap sniff size - skip huge files for header-only discovery
                if ($e.Length -lt 15MB) {
                    $header = Get-HeaderSnippet -Path $e.FullName -MaxChars 240
                }
            } elseif ($ext -eq '.csv' -and $nameOrPathHit) {
                $header = Get-HeaderSnippet -Path $e.FullName -MaxChars 240
            }

            if (-not (Should-ConsiderFile -File $e -Header $header)) { continue }

            $hits += 1
            $score = Get-RemitScore -Name $e.Name -FullPath $e.FullName -Ext $ext -Header $header
            if ($score -lt 3) { continue }
            [void]$Out.Add([pscustomobject]@{
                FullPath  = $e.FullName
                SizeBytes = [long]$e.Length
                LastWrite = $e.LastWriteTime
                Ext       = $ext
                Header    = $header
                Score     = $score
                Source    = $Label
            })
            Write-Info ("  hit: [{0}] {1}" -f $score, $e.FullName)
        }
    }

    Add-Line ("  walked {0} folder(s), {1} file(s), {2} hit(s)" -f $dirsSeen, $filesSeen, $hits)
    Add-Line ''
}

$candidates = New-Object System.Collections.Generic.List[object]

# Explicit high-value folders first (deeper sniff)
$priorityFolders = @(
    (Join-Path $PaigeRoot '1 ACC Invoices & Remittances'),
    (Join-Path $PaigeRoot 'Loan Equipment'),
    $PaigeRoot
)
$seenRoots = @{}
foreach ($pf in $priorityFolders) {
    $key = $pf.ToLowerInvariant()
    if ($seenRoots.ContainsKey($key)) { continue }
    $seenRoots[$key] = $true
    $depth = if ($pf -eq $PaigeRoot) { 10 } else { 12 }
    $sniff = ($pf -ne $PaigeRoot) # sniff all CSV headers in invoice/loan folders
    Scan-Root -Root $pf -Label (Split-Path $pf -Leaf) -MaxDepth $depth -HeaderSniffAllCsv:$sniff -Out $candidates
}

if (-not $SkipAdminRoot) {
    Scan-Root -Root $AdminRoot -Label 'DistrictNursing' -MaxDepth 6 -HeaderSniffAllCsv:$true -Out $candidates
}

if (-not $SkipTeam) {
    Scan-Root -Root $TeamRoot -Label 'Team' -MaxDepth 5 -HeaderSniffAllCsv:$false -Out $candidates
}

if (-not $SkipDesktop) {
    $desk = [Environment]::GetFolderPath('Desktop')
    Scan-Root -Root $desk -Label 'Desktop' -MaxDepth 2 -HeaderSniffAllCsv:$true -Out $candidates
}

# Dedupe by path
$byPath = @{}
foreach ($c in $candidates) {
    $k = $c.FullPath.ToLowerInvariant()
    if (-not $byPath.ContainsKey($k) -or $c.Score -gt $byPath[$k].Score) {
        $byPath[$k] = $c
    }
}
$ranked = @($byPath.Values) | Sort-Object -Property @{ Expression = 'Score'; Descending = $true }, @{ Expression = 'LastWrite'; Descending = $true }

Add-Line '========================================================================'
Add-Line 'CANDIDATES (highest score first)'
Add-Line '========================================================================'
Add-Line ''

if ($ranked.Count -eq 0) {
    Add-Line '(none found)'
    Add-Line 'Likely remittances live as PDF only, or under a path outside Paige/Team/Desktop.'
    Add-Line 'Suite already has a grounded CSV remittance shape from an earlier sample - PDF import is not built.'
} else {
    $i = 0
    foreach ($c in $ranked) {
        $i += 1
        if ($i -gt 25) {
            Add-Line ("... and {0} more (top 25 shown)" -f ($ranked.Count - 25))
            break
        }
        $sizeKb = [Math]::Round($c.SizeBytes / 1KB, 1)
        Add-Line ("--- #{0}  score={1}  ({2}) ---" -f $i, $c.Score, $c.Source)
        Add-Line ("path:      {0}" -f $c.FullPath)
        Add-Line ("size:      {0} KB" -f $sizeKb)
        Add-Line ("lastWrite: {0}" -f $c.LastWrite.ToString('yyyy-MM-dd HH:mm:ss'))
        Add-Line ("ext:       {0}" -f $c.Ext)
        if ($c.Ext -eq '.csv') {
            if ([string]::IsNullOrWhiteSpace($c.Header)) {
                Add-Line 'header:    (could not read first line)'
            } else {
                Add-Line ("header:    {0}" -f $c.Header)
            }
        } else {
            Add-Line 'header:    (xlsx/xls - not sniffed; open manually if needed)'
        }
        Add-Line ''
    }
}

Add-Line 'SUMMARY'
Add-Line ("  candidates: {0}" -f $ranked.Count)
if ($ranked.Count -gt 0) {
    $best = $ranked | Select-Object -First 1
    Add-Line ("  best guess: {0}" -f $best.FullPath)
    Add-Line ("  best score: {0}" -f $best.Score)
}
Add-Line ''
Add-Line 'Remember: delete this report after use. Do not commit it.'

$text = ($lines -join "`r`n") + "`r`n"
[System.IO.File]::WriteAllText($OutFile, $text, [System.Text.UTF8Encoding]::new($true))
Write-Info ''
Write-Info ("Report written: {0}" -f $OutFile)
Write-Info 'Done.'
exit 0
