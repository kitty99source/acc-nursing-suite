# ACC Portal Discovery — double-click launcher (work laptop)
#
# 1. Opens Edge or Chrome with remote debugging on port 9222
# 2. Prompts you to log into Citrix VPN + ACC portal, then click OK
# 3. Runs portal-discover.mjs (CDP attach, no Playwright) and saves results
#
# Zero npm commands visible — Node + scripts live next to this file in dist/.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms | Out-Null

$root = $PSScriptRoot
if ([string]::IsNullOrEmpty($root)) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }

$portalUrl = 'http://cl-biprddb02/Reports_MSREPORT/browse/DHB-wide/ACC'
$cdpPort = 9222
$outDir = Join-Path $env:USERPROFILE 'ACC-Suite'
$outFile = Join-Path $outDir 'portal-map.json'
$summaryFile = Join-Path $outDir 'portal-summary.html'
$discoverScript = Join-Path $root 'wfh\portal-discover.mjs'
$cdpClient = Join-Path $root 'wfh\cdp-client.mjs'

function Show-ErrorBox {
    param([string]$Message)
    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        'ACC Portal Discovery',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

function Find-NodeExe {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and (Test-Path -LiteralPath $cmd.Source)) { return $cmd.Source }

    $candidates = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )
    foreach ($p in $candidates) {
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    }
    return $null
}

function Find-BrowserExe {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($p in $candidates) {
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    }
    return $null
}

Write-Host ''
Write-Host '  ACC Portal Discovery' -ForegroundColor Cyan
Write-Host '  --------------------' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path -LiteralPath $discoverScript)) {
    Show-ErrorBox "Missing portal-discover.mjs.`n`nExpected:`n  $discoverScript`n`nRun npm run build on the dev machine and copy the whole dist folder."
    exit 1
}

if (-not (Test-Path -LiteralPath $cdpClient)) {
    Show-ErrorBox "Missing cdp-client.mjs.`n`nExpected:`n  $cdpClient`n`nRun npm run build and copy dist/ again."
    exit 1
}

$node = Find-NodeExe
if (-not $node) {
    Show-ErrorBox @"
Node.js was not found on this PC.

Install Node.js LTS (v18 or newer) from:
  https://nodejs.org/

Then double-click Start Portal Discover.cmd again.
"@
    exit 1
}

$browser = Find-BrowserExe
if (-not $browser) {
    Show-ErrorBox "Could not find Microsoft Edge or Google Chrome.`n`nInstall Edge or Chrome, then try again."
    exit 1
}

$browserName = Split-Path -Leaf $browser
Write-Host "  Browser: $browserName" -ForegroundColor Gray
Write-Host "  Node:    $node" -ForegroundColor Gray
Write-Host "  Output:  $outFile" -ForegroundColor Gray
Write-Host ''

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Launch browser with remote debugging (portal URL may fail off VPN — user navigates manually)
$browserArgs = @(
    "--remote-debugging-port=$cdpPort",
    '--new-window',
    $portalUrl
)
Write-Host "  Opening browser with remote debugging on port $cdpPort …" -ForegroundColor Green
Start-Process -FilePath $browser -ArgumentList $browserArgs | Out-Null
Start-Sleep -Seconds 2

[System.Windows.Forms.MessageBox]::Show(
    @"
Log into Citrix VPN and the ACC portal in the browser that opened.

Navigate to the ACC report / browse page if needed.

Click OK when you are on the report page and ready to scan.
"@,
    'ACC Portal Discovery',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null

Write-Host '  Scanning portal (this may take a minute) …' -ForegroundColor Green
Write-Host ''

$env:PORTAL_DISCOVER_LAUNCHER = '1'
$nodeArgs = @(
    $discoverScript,
    '--attach',
    '--crawl',
    '--out', $outFile
)

& $node @nodeArgs
$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) { $exitCode = 0 }

if ($exitCode -ne 0) {
    Show-ErrorBox @"
Portal discovery failed.

Check the messages in this window, then try again:
  • Connect Citrix VPN first
  • Stay on the ACC report page in the debug browser
  • Close other Chrome/Edge windows if port 9222 is busy
"@
    Read-Host 'Press Enter to close'
    exit $exitCode
}

Write-Host ''
Write-Host "  Done! Results saved to:" -ForegroundColor Green
Write-Host "    $outFile" -ForegroundColor Green
Write-Host ''

if (Test-Path -LiteralPath $summaryFile) {
    try {
        Start-Process $summaryFile | Out-Null
    } catch {
        Write-Host "  Could not open summary HTML. Open manually: $summaryFile" -ForegroundColor Yellow
    }
}

try {
    Start-Process explorer.exe $outDir | Out-Null
} catch {
    Write-Host "  Open folder manually: $outDir" -ForegroundColor Yellow
}

[System.Windows.Forms.MessageBox]::Show(
    "Portal discovery finished.`n`nResults folder:`n  $outDir`n`nReview portal-map.json and redact any patient details before sharing.",
    'ACC Portal Discovery',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null

Read-Host 'Press Enter to close'
