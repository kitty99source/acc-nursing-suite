param(
    [switch]$Apply
)

# ACC Inbox attachment rename (one-time / re-runnable)
# Dry-run by default. Pass -Apply to rename on disk.
# STOP Start Folder Watch.cmd before -Apply (avoids duplicate staging).

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
. (Join-Path $bootstrapRoot 'bootstrap-log.ps1') -LogName 'inbox-rename'
. (Join-Path $bootstrapRoot 'inbox-config.ps1')
Write-BootstrapLog 'Rename-AccInboxAttachments.ps1 started'

function Write-RenameLine {
    param([string]$Message, [string]$Color = 'Gray')
    Write-Host $Message -ForegroundColor $Color
    Write-BootstrapLog $Message
}

function Get-UniquePath {
    param(
        [string]$Dir,
        [string]$FileName
    )
    $candidate = Join-Path $Dir $FileName
    if (-not (Test-Path -LiteralPath $candidate)) { return $candidate }
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $ext = [System.IO.Path]::GetExtension($FileName)
    $n = 1
    while ($true) {
        $alt = Join-Path $Dir ("{0}-{1}{2}" -f $stem, $n, $ext)
        if (-not (Test-Path -LiteralPath $alt)) { return $alt }
        $n++
        if ($n -gt 999) { throw "Too many duplicate files for $FileName" }
    }
}

function Limit-FileNameLength {
    param(
        [string]$FileName,
        [int]$MaxLength = 150
    )
    if ([string]::IsNullOrEmpty($FileName)) { return $FileName }
    if ($FileName.Length -le $MaxLength) { return $FileName }
    $ext = [System.IO.Path]::GetExtension($FileName)
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $keep = $MaxLength - $ext.Length
    if ($keep -lt 1) {
        return $FileName.Substring(0, $MaxLength)
    }
    return ($stem.Substring(0, $keep) + $ext)
}

function Test-IsDescriptiveFileName {
    # Mirrors isDescriptiveName in src/lib/attachmentNaming.ts - KEEP IN SYNC.
    param([string]$FileName)
    $leaf = [System.IO.Path]::GetFileName($FileName)
    if ([string]::IsNullOrWhiteSpace($leaf)) { return $false }
    if ($leaf -match '^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?_Claim[A-Za-z0-9]+_') { return $true }
    if ($leaf -match '^Claim[A-Za-z0-9]+_') { return $true }
    if ($leaf -match '^[A-Za-z0-9]+-[A-Za-z0-9]+_') { return $true }
    return $false
}

function Strip-DescriptivePrefix {
    # Mirrors stripDescriptivePrefix in src/lib/attachmentNaming.ts - KEEP IN SYNC.
    param([string]$FileName)
    $leaf = [System.IO.Path]::GetFileName($FileName)
    if ([string]::IsNullOrWhiteSpace($leaf)) { return $leaf }
    if (-not (Test-IsDescriptiveFileName -FileName $leaf)) { return $leaf }
    $m = [regex]::Match($leaf, '^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?_Claim[A-Za-z0-9]+_(.+)$')
    if ($m.Success) { return $m.Groups[1].Value }
    $m = [regex]::Match($leaf, '^Claim[A-Za-z0-9]+_(.+)$')
    if ($m.Success) { return $m.Groups[1].Value }
    $m = [regex]::Match($leaf, '^[A-Za-z0-9]+-[A-Za-z0-9]+_(.+)$')
    if ($m.Success) { return $m.Groups[1].Value }
    return $leaf
}

function New-DescriptiveFileName {
    # Mirrors New-DescriptiveFileName in outlook-sync.ps1 / descriptiveAttachmentName.ts.
    param(
        [string]$Subject,
        [string]$OriginalFileName
    )
    $leaf = [System.IO.Path]::GetFileName($OriginalFileName)
    if ([string]::IsNullOrWhiteSpace($leaf)) { return $OriginalFileName }
    $original = Strip-DescriptivePrefix -FileName $leaf
    if ([string]::IsNullOrWhiteSpace($Subject)) { return $original }

    $patientPart = ''
    $sepIndex = $Subject.IndexOf(' - Claim', [System.StringComparison]::OrdinalIgnoreCase)
    if ($sepIndex -ge 0) {
        $nameSource = $Subject.Substring(0, $sepIndex)
        $nameSource = ($nameSource -replace '\s+', ' ').Trim()
        $nameSource = [regex]::Replace($nameSource, '^(?i:mr|mrs|ms|miss|dr)\.?\s+', '')
        $words = @()
        foreach ($w in ($nameSource -split '\s+')) {
            $clean = [regex]::Replace($w, '[^A-Za-z0-9]', '')
            if ($clean.Length -gt 0) { $words += $clean }
        }
        if ($words.Count -ge 2) {
            $patientPart = ('{0}-{1}' -f $words[$words.Count - 1], $words[0])
        } elseif ($words.Count -eq 1) {
            $patientPart = $words[0]
        }
    }

    $claimPart = ''
    $claimMatch = [regex]::Match($Subject, '(?i:claim)\s*[:#]?\s*([A-Za-z0-9]+)')
    if ($claimMatch.Success) {
        $claimPart = [regex]::Replace($claimMatch.Groups[1].Value, '[^A-Za-z0-9]', '')
    }

    $prefix = ''
    if ($patientPart -and $claimPart) {
        $prefix = ('{0}_Claim{1}' -f $patientPart, $claimPart)
    } elseif ($patientPart) {
        $prefix = $patientPart
    } elseif ($claimPart) {
        $prefix = ('Claim{0}' -f $claimPart)
    }

    if ([string]::IsNullOrWhiteSpace($prefix)) { return $original }
    $descriptive = ('{0}_{1}' -f $prefix, $original)
    return (Limit-FileNameLength -FileName $descriptive -MaxLength 150)
}

function Get-PatientNameFromSubject {
    param([string]$Subject)
    if ([string]::IsNullOrWhiteSpace($Subject)) { return $null }
    $sepIndex = $Subject.IndexOf(' - Claim', [System.StringComparison]::OrdinalIgnoreCase)
    if ($sepIndex -lt 0) { return $null }
    $nameSource = $Subject.Substring(0, $sepIndex)
    $nameSource = ($nameSource -replace '\s+', ' ').Trim()
    $nameSource = [regex]::Replace($nameSource, '^(?i:mr|mrs|ms|miss|dr)\.?\s+', '')
    if ([string]::IsNullOrWhiteSpace($nameSource)) { return $null }
    return $nameSource
}

function Get-ClaimFromSubject {
    param([string]$Subject)
    if ([string]::IsNullOrWhiteSpace($Subject)) { return $null }
    $claimMatch = [regex]::Match($Subject, '(?i:claim)\s*[:#]?\s*([A-Za-z0-9]+)')
    if (-not $claimMatch.Success) { return $null }
    $token = [regex]::Replace($claimMatch.Groups[1].Value, '[^A-Za-z0-9]', '')
    if ([string]::IsNullOrWhiteSpace($token)) { return $null }
    return $token
}

function Get-AccIdFromSubject {
    param([string]$Subject)
    if ([string]::IsNullOrWhiteSpace($Subject)) { return $null }
    $m = [regex]::Match($Subject, '(?i:accid)\s*[:#]?\s*([A-Za-z0-9\-]+)')
    if (-not $m.Success) { return $null }
    return $m.Groups[1].Value.Trim()
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

function Normalize-MatchName {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name)) { return '' }
    $leaf = [System.IO.Path]::GetFileName($Name)
    try {
        $leaf = [System.Uri]::UnescapeDataString($leaf)
    } catch {}
    return $leaf.Trim().ToLowerInvariant()
}

function Get-Sha256Hex {
    param([string]$FilePath)
    $hash = Get-FileHash -LiteralPath $FilePath -Algorithm SHA256
    return $hash.Hash.ToLowerInvariant()
}

# --- Main --------------------------------------------------------------------

$inbox = Resolve-InboxPath -ScriptRoot $bootstrapRoot
$statusPath = Join-Path (Resolve-AccSuiteDir) 'email-sync-status.json'
$stagingDir = Join-Path $inbox '.staging'
$processedDir = Join-Path $inbox 'processed'
$logDir = Join-Path (Resolve-AccSuiteDir) 'logs'
[void][System.IO.Directory]::CreateDirectory($logDir)
$logPath = Join-Path $logDir ("inbox-rename-{0:yyyyMMdd}.log" -f (Get-Date))

Write-RenameLine ''
Write-RenameLine 'ACC Inbox attachment rename' 'Cyan'
Write-RenameLine '===========================' 'Cyan'
Write-RenameLine ''
if ($Apply) {
    Write-RenameLine 'Mode: APPLY (will rename files on disk)' 'Yellow'
} else {
    Write-RenameLine 'Mode: DRY-RUN (no changes). Pass -Apply to rename.' 'Green'
}
Write-RenameLine ("Inbox:  {0}" -f $inbox)
Write-RenameLine ("Status: {0}" -f $statusPath)
Write-RenameLine ''
Write-RenameLine 'IMPORTANT: Stop Start Folder Watch.cmd before -Apply.' 'Yellow'
Write-RenameLine '           Renaming while watch is running can re-stage duplicates.' 'Yellow'
Write-RenameLine ''

if (-not (Test-Path -LiteralPath $inbox -PathType Container)) {
    Write-RenameLine ("FAIL - inbox not found: {0}" -f $inbox) 'Red'
    exit 1
}

$subjectByName = @{}
$savedFilesTruncated = $false
if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
    try {
        $raw = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8
        $status = $raw | ConvertFrom-Json
        if ($status.savedFilesTruncated) { $savedFilesTruncated = $true }
        if ($status.savedFiles) {
            foreach ($f in @($status.savedFiles)) {
                $fn = [string]$f.fileName
                $subj = [string]$f.subject
                if ([string]::IsNullOrWhiteSpace($fn)) { continue }
                $key = Normalize-MatchName -Name $fn
                if ($key -and -not $subjectByName.ContainsKey($key)) {
                    $subjectByName[$key] = $subj
                }
                # Also index by stripped descriptive base so already-renamed files still match.
                $base = Strip-DescriptivePrefix -FileName $fn
                $baseKey = Normalize-MatchName -Name $base
                if ($baseKey -and -not $subjectByName.ContainsKey($baseKey)) {
                    $subjectByName[$baseKey] = $subj
                }
            }
        }
        Write-RenameLine ("Loaded {0} subject(s) from email-sync-status.json" -f $subjectByName.Count)
        if ($savedFilesTruncated) {
            Write-RenameLine 'WARN - savedFiles was truncated (>200). Some older files may lack subject metadata.' 'Yellow'
        }
    } catch {
        Write-RenameLine ("WARN - could not parse email-sync-status.json: {0}" -f $_.Exception.Message) 'Yellow'
    }
} else {
    Write-RenameLine 'WARN - email-sync-status.json not found. Cannot rename without subjects.' 'Yellow'
}

$extOk = @('.pdf', '.docx', '.doc')
$files = New-Object System.Collections.Generic.List[string]
foreach ($dir in @($inbox, $processedDir)) {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
    foreach ($path in [System.IO.Directory]::GetFiles($dir)) {
        $leaf = [System.IO.Path]::GetFileName($path)
        if ($leaf.StartsWith('.')) { continue }
        $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
        if ($extOk -notcontains $ext) { continue }
        [void]$files.Add($path)
    }
}

Write-RenameLine ("Found {0} letter file(s) in inbox + processed" -f $files.Count)
Write-RenameLine ''

$wouldRename = 0
$skippedOk = 0
$noMeta = 0
$renamed = 0
$errors = 0
$noMetaList = New-Object System.Collections.Generic.List[string]

foreach ($path in $files) {
    $leaf = [System.IO.Path]::GetFileName($path)
    $dir = [System.IO.Path]::GetDirectoryName($path)
    $key = Normalize-MatchName -Name $leaf
    $baseKey = Normalize-MatchName -Name (Strip-DescriptivePrefix -FileName $leaf)

    $subject = $null
    if ($subjectByName.ContainsKey($key)) {
        $subject = $subjectByName[$key]
    } elseif ($subjectByName.ContainsKey($baseKey)) {
        $subject = $subjectByName[$baseKey]
    }

    if ([string]::IsNullOrWhiteSpace($subject)) {
        $noMeta++
        [void]$noMetaList.Add($leaf)
        Write-RenameLine ("  [skip] no subject metadata: {0}" -f $leaf) 'DarkGray'
        continue
    }

    $base = Strip-DescriptivePrefix -FileName $leaf
    $targetName = New-DescriptiveFileName -Subject $subject -OriginalFileName $base
    if ($targetName -eq $leaf) {
        $skippedOk++
        Write-RenameLine ("  [ok] already uniform: {0}" -f $leaf) 'DarkGray'
        continue
    }

    $dest = Get-UniquePath -Dir $dir -FileName $targetName
    $finalName = [System.IO.Path]::GetFileName($dest)
    Write-RenameLine ("  {0}" -f $leaf)
    Write-RenameLine ("    -> {0}" -f $finalName) 'Cyan'
    $wouldRename++

    if (-not $Apply) { continue }

    try {
        $hash = $null
        try { $hash = Get-Sha256Hex -FilePath $path } catch {}

        Move-Item -LiteralPath $path -Destination $dest -Force -ErrorAction Stop
        $renamed++
        $line = ("{0:o}  {1}  ->  {2}" -f (Get-Date).ToUniversalTime(), $leaf, $finalName)
        Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8

        # Atomically update matching .staging sidecar (hash_oldStem.json -> hash_newStem.json).
        if ($hash -and (Test-Path -LiteralPath $stagingDir -PathType Container)) {
            $oldStem = Get-SidecarFileStem -FileName $leaf
            $newStem = Get-SidecarFileStem -FileName $finalName
            $oldSidecar = Join-Path $stagingDir ("{0}_{1}.json" -f $hash, $oldStem)
            $newSidecar = Join-Path $stagingDir ("{0}_{1}.json" -f $hash, $newStem)
            if (Test-Path -LiteralPath $oldSidecar -PathType Leaf) {
                try {
                    $rawSc = Get-Content -LiteralPath $oldSidecar -Raw -Encoding UTF8
                    $sc = $rawSc | ConvertFrom-Json
                    if ($sc.item) {
                        $sc.item.sourceFileName = $finalName
                        $sc.item.expectedFileName = $finalName
                        $sc.item.title = ("Folder: {0}" -f $finalName)
                        $pn = Get-PatientNameFromSubject -Subject $subject
                        $cn = Get-ClaimFromSubject -Subject $subject
                        $aid = Get-AccIdFromSubject -Subject $subject
                        if ($pn) { $sc.item | Add-Member -NotePropertyName patientName -NotePropertyValue $pn -Force }
                        if ($cn) { $sc.item | Add-Member -NotePropertyName claimNumber -NotePropertyValue $cn -Force }
                        if ($aid) { $sc.item | Add-Member -NotePropertyName accId -NotePropertyValue $aid -Force }
                        $sc.item | Add-Member -NotePropertyName emailSubject -NotePropertyValue $subject -Force
                    }
                    $json = $sc | ConvertTo-Json -Depth 8 -Compress:$false
                    [System.IO.File]::WriteAllText($newSidecar, $json, [Text.Encoding]::UTF8)
                    if ($newSidecar -ne $oldSidecar) {
                        Remove-Item -LiteralPath $oldSidecar -Force -ErrorAction SilentlyContinue
                    }
                    Write-RenameLine ("    sidecar updated: {0}" -f ([System.IO.Path]::GetFileName($newSidecar))) 'DarkGray'
                } catch {
                    Write-RenameLine ("    WARN - sidecar update failed: {0}" -f $_.Exception.Message) 'Yellow'
                }
            }
        }
    } catch {
        $errors++
        Write-RenameLine ("    FAIL - {0}" -f $_.Exception.Message) 'Red'
    }
}

Write-RenameLine ''
Write-RenameLine 'Summary' 'Cyan'
Write-RenameLine '-------' 'Cyan'
Write-RenameLine ("  Would rename / renamed: {0}" -f $(if ($Apply) { $renamed } else { $wouldRename }))
Write-RenameLine ("  Already uniform:        {0}" -f $skippedOk)
Write-RenameLine ("  No subject metadata:    {0}" -f $noMeta)
Write-RenameLine ("  Errors:                 {0}" -f $errors)
if ($Apply -and (Test-Path -LiteralPath $logPath)) {
    Write-RenameLine ("  Log: {0}" -f $logPath)
}
if ($noMetaList.Count -gt 0 -and $noMetaList.Count -le 30) {
    Write-RenameLine ''
    Write-RenameLine 'Files needing manual subject (not renamed):' 'Yellow'
    foreach ($n in $noMetaList) {
        Write-RenameLine ("  - {0}" -f $n) 'DarkGray'
    }
} elseif ($noMetaList.Count -gt 30) {
    Write-RenameLine ("  ({0} files without metadata - see dry-run output above)" -f $noMetaList.Count) 'Yellow'
}
Write-RenameLine ''
if (-not $Apply -and $wouldRename -gt 0) {
    Write-RenameLine 'Re-run with -Apply to perform these renames (after stopping Folder Watch).' 'Green'
}
Write-RenameLine ''

if ($errors -gt 0) { exit 1 }
exit 0
