# ============================================================================
#  Smoke-AdminSetup.ps1  --  READ-ONLY District Nursing Admin Suite install smoke
# ----------------------------------------------------------------------------
#  Prints a pasteable report covering:
#    - quiet .vbs / launch.ps1 / lifecycle.ps1 present next to this tools folder?
#    - %USERPROFILE%\ACC-Suite exists? logs folder?
#    - I:\ACC\District Nursing exists? _Staging?
#  Optional write probe: -WriteProbe creates then deletes
#    _Staging\_smoke_test.txt (OFF by default).
#
#  Default is READ-ONLY. Output goes to Desktop AND console.
#  Desktop report may mention paths - delete after use. Never commit.
#
#  HOW TO RUN:
#    powershell -NoProfile -ExecutionPolicy Bypass -File `
#      .\scripts\tools\Smoke-AdminSetup.ps1
#    With write/delete probe:
#      .\Smoke-AdminSetup.ps1 -WriteProbe
# ============================================================================

param(
    [string]$IDriveRoot = 'I:\ACC\District Nursing',
    [string]$StagingSubfolder = '_Staging',
    [string]$LauncherDir = '',
    [switch]$WriteProbe,
    [string]$OutFile = ''
)

$ErrorActionPreference = 'Continue'

function Write-Info { param([string]$m) Write-Host $m }
function Write-Warn { param([string]$m) Write-Host $m -ForegroundColor Yellow }
function Write-Ok   { param([string]$m) Write-Host $m -ForegroundColor Green }
function Write-Err  { param([string]$m) Write-Host $m -ForegroundColor Red }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ([string]::IsNullOrWhiteSpace($OutFile)) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $OutFile = Join-Path $desktop "AdminSuite-Smoke-$stamp.txt"
}

$lines = New-Object System.Collections.Generic.List[string]
function Add-Line {
    param([string]$m)
    [void]$lines.Add($m)
    Write-Info $m
}
function Add-Ok {
    param([string]$m)
    [void]$lines.Add($m)
    Write-Ok $m
}
function Add-Bad {
    param([string]$m)
    [void]$lines.Add($m)
    Write-Err $m
}
function Add-WarnLine {
    param([string]$m)
    [void]$lines.Add($m)
    Write-Warn $m
}

if ([string]::IsNullOrWhiteSpace($LauncherDir)) {
    $here = $PSScriptRoot
    if ([string]::IsNullOrEmpty($here)) { $here = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
    $LauncherDir = Join-Path (Split-Path -Parent $here) 'launcher'
}

Add-Line 'ACC Admin Suite setup smoke (READ-ONLY by default)'
Add-Line '--------------------------------------------------'
Add-Line ("Generated: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Add-Line ("LauncherDir: {0}" -f $LauncherDir)
Add-Line ("IDriveRoot:   {0}" -f $IDriveRoot)
Add-Line ("Staging:      {0}" -f $StagingSubfolder)
Add-Line 'PHI WARNING: Desktop report is local. Delete after use. Do not commit.'
Add-Line ''

$required = @(
    'launch.ps1',
    'lifecycle.ps1',
    'bootstrap-log.ps1',
    'wfh-mode.ps1',
    'Start ACC Suite (quiet).vbs',
    'Start ACC Suite (quiet).cmd',
    'README.txt'
)
Add-Line 'LAUNCHER FILES'
foreach ($name in $required) {
    $p = Join-Path $LauncherDir $name
    if (Test-Path -LiteralPath $p -PathType Leaf) {
        Add-Ok ("  OK  {0}" -f $name)
    } else {
        Add-Bad ("  MISSING  {0}" -f $name)
    }
}
Add-Line ''

$suite = Join-Path $env:USERPROFILE 'ACC-Suite'
$logs = Join-Path $suite 'logs'
Add-Line 'SUITE DIR (created on first quiet/lifecycle run)'
if (Test-Path -LiteralPath $suite -PathType Container) {
    Add-Ok ("  OK  {0}" -f $suite)
} else {
    Add-WarnLine ("  not yet created: {0}" -f $suite)
}
if (Test-Path -LiteralPath $logs -PathType Container) {
    Add-Ok ("  OK  logs: {0}" -f $logs)
} else {
    Add-WarnLine ("  logs folder not yet created: {0}" -f $logs)
}
Add-Line ''

Add-Line 'I-DRIVE DISTRICT NURSING ROOT'
if (Test-Path -LiteralPath $IDriveRoot -PathType Container) {
    Add-Ok ("  OK  {0}" -f $IDriveRoot)
    $staging = Join-Path $IDriveRoot $StagingSubfolder
    if (Test-Path -LiteralPath $staging -PathType Container) {
        Add-Ok ("  OK  staging: {0}" -f $staging)
    } else {
        Add-WarnLine ("  staging not found yet: {0} (created on first Accept writeback)" -f $staging)
    }
    $letters = Join-Path $IDriveRoot 'Letters'
    if (Test-Path -LiteralPath $letters -PathType Container) {
        Add-Ok '  OK  Letters\ live archive present'
    } else {
        Add-WarnLine '  Letters\ not found (fine if archive lives elsewhere)'
    }
} else {
    Add-WarnLine ("  not found: {0}" -f $IDriveRoot)
}
Add-Line ''

if ($WriteProbe) {
    Add-Line 'WRITE PROBE (-WriteProbe)'
    $staging = Join-Path $IDriveRoot $StagingSubfolder
    if (-not (Test-Path -LiteralPath $IDriveRoot -PathType Container)) {
        Add-Bad '  SKIPPED - IDriveRoot missing'
    } else {
        if (-not (Test-Path -LiteralPath $staging -PathType Container)) {
            try {
                New-Item -ItemType Directory -Path $staging -Force | Out-Null
            } catch {
                Add-Bad ("  FAIL create staging: {0}" -f $_.Exception.Message)
            }
        }
        if (Test-Path -LiteralPath $staging -PathType Container) {
            $probe = Join-Path $staging '_smoke_test.txt'
            try {
                [System.IO.File]::WriteAllText($probe, "smoke $($stamp)")
                Remove-Item -LiteralPath $probe -Force -ErrorAction Stop
                Add-Ok '  OK  create+delete _Staging\_smoke_test.txt'
            } catch {
                Add-Bad ("  FAIL  {0}" -f $_.Exception.Message)
            }
        }
    }
    Add-Line ''
}

Add-Line 'REMINDERS'
Add-Line '  - Pin Desktop shortcut to quiet .vbs for day-to-day use'
Add-Line '  - Close last browser tab to stop Hidden server'
Add-Line '  - Never commit Desktop finder/smoke reports (PHI paths)'
Add-Line ''
Add-Line 'Done.'

$text = ($lines -join "`r`n") + "`r`n"
[System.IO.File]::WriteAllText($OutFile, $text, [System.Text.UTF8Encoding]::new($false))
Write-Host ""
Write-Host ("Report written: {0}" -f $OutFile) -ForegroundColor Cyan
