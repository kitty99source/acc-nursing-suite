# ACC Portal Discovery — double-click launcher (work laptop)
#
# 1. Opens Edge or Chrome with remote debugging on port 9222
# 2. Prompts you to log into Citrix VPN + ACC portal, then click OK
# 3. Runs portal-discover.mjs (CDP attach, no Playwright) and saves results
#
# Zero npm commands visible — Node + scripts live next to this file in dist/.

$script:UseWinForms = $false

function Initialize-Ui {
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop | Out-Null
        $script:UseWinForms = $true
    } catch {
        $script:UseWinForms = $false
    }
}

function Show-MessageBox {
    param(
        [string]$Message,
        [string]$Title = 'ACC Portal Discovery',
        [ValidateSet('Error', 'Information', 'Warning')]
        [string]$Icon = 'Information'
    )
    if ($script:UseWinForms) {
        $iconEnum = [System.Windows.Forms.MessageBoxIcon]::$Icon
        [System.Windows.Forms.MessageBox]::Show(
            $Message,
            $Title,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            $iconEnum
        ) | Out-Null
        return
    }
    $flat = ($Message -replace '\s+', ' ').Trim()
    if ($flat.Length -gt 240) { $flat = $flat.Substring(0, 237) + '...' }
    try {
        & msg.exe $env:USERNAME /time:60 $flat 2>$null | Out-Null
    } catch {}
}

function Show-NodeMissingBox {
    try {
        Start-Process 'https://nodejs.org/' -ErrorAction SilentlyContinue | Out-Null
    } catch {}
    Show-MessageBox -Message @"
Node.js is not installed on this PC.

Your browser should open to nodejs.org.
1. Click the green LTS button
2. Run the installer (Next, Next, Finish)
3. Double-click Start Portal Discover.cmd again

The main ACC app (Start ACC Suite.cmd) works without Node.
"@ -Icon Error
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

$root = $PSScriptRoot
if ([string]::IsNullOrEmpty($root)) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }

$portalUrl = 'http://cl-biprddb02/Reports_MSREPORT/browse/DHB-wide/ACC'
$cdpPort = 9222
$outDir = Join-Path $env:USERPROFILE 'ACC-Suite'
$outFile = Join-Path $outDir 'portal-map.json'
$summaryFile = Join-Path $outDir 'portal-summary.html'
$discoverScript = Join-Path $root 'wfh\portal-discover.mjs'
$cdpClient = Join-Path $root 'wfh\cdp-client.mjs'

Initialize-Ui

if (-not (Find-NodeExe)) {
    Show-NodeMissingBox
    exit 1
}

$ErrorActionPreference = 'Stop'

try {
    Write-Host ''
    Write-Host '  ACC Portal Discovery' -ForegroundColor Cyan
    Write-Host '  --------------------' -ForegroundColor Cyan
    Write-Host ''

    if (-not (Test-Path -LiteralPath $discoverScript)) {
        Show-MessageBox -Message @"
Portal Discovery is not set up on this PC.

Copy the whole dist folder from the dev machine, or ask IT for help.

The main app still works: double-click Start ACC Suite.cmd
"@ -Icon Error
        exit 1
    }

    if (-not (Test-Path -LiteralPath $cdpClient)) {
        Show-MessageBox -Message @"
Portal Discovery is missing required files.

Copy the whole dist folder from the dev machine, or ask IT for help.
"@ -Icon Error
        exit 1
    }

    $node = Find-NodeExe
    $browser = Find-BrowserExe
    if (-not $browser) {
        Show-MessageBox -Message 'Could not find Microsoft Edge or Google Chrome. Install Edge or Chrome, then try again.' -Icon Error
        exit 1
    }

    $browserName = Split-Path -Leaf $browser
    Write-Host "  Browser: $browserName" -ForegroundColor Gray
    Write-Host "  Node:    $node" -ForegroundColor Gray
    Write-Host "  Output:  $outFile" -ForegroundColor Gray
    Write-Host ''

    New-Item -ItemType Directory -Force -Path $outDir | Out-Null

    $browserArgs = @(
        "--remote-debugging-port=$cdpPort",
        '--new-window',
        $portalUrl
    )
    Write-Host "  Opening browser with remote debugging on port $cdpPort …" -ForegroundColor Green
    Start-Process -FilePath $browser -ArgumentList $browserArgs | Out-Null
    Start-Sleep -Seconds 2

    Show-MessageBox -Message @"
Log into Citrix VPN and the ACC portal in the browser that opened.

Navigate to the ACC report / browse page if needed.

Click OK when you are on the report page and ready to scan.
"@ -Icon Information

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
        Show-MessageBox -Message @"
Portal discovery failed.

• Connect Citrix VPN first
• Stay on the ACC report page in the browser
• Close other Chrome/Edge windows if port 9222 is busy

Check this window for details, then try again.
"@ -Icon Error
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

    Show-MessageBox -Message @"
Portal discovery finished.

Results folder:
  $outDir

Review portal-map.json and redact any patient details before sharing.
"@ -Icon Information

    Read-Host 'Press Enter to close'
} catch {
    Show-MessageBox -Message @"
Portal Discovery stopped unexpectedly.

If Node is not installed, open https://nodejs.org and install the green LTS version.

Otherwise: connect VPN, stay on the ACC portal page, and try again.
"@ -Icon Error
    Read-Host 'Press Enter to close'
    exit 1
}
