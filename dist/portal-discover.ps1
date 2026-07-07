# ACC Portal Discovery — double-click launcher (work laptop)
#
# Pure PowerShell — no Node.js required.
# 1. Opens Edge or Chrome with remote debugging on port 9222
# 2. Prompts you to log into Citrix VPN + ACC portal, then click OK
# 3. Attaches via Chrome DevTools Protocol (HTTP + WebSocket) and saves results

$script:UseWinForms = $false
$script:CdpNextId = 0

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

function Redact-Sensitive {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return $Text }
    $t = $Text
    $t = [regex]::Replace($t, '\b[A-Z]{3}\d{4}\b', '[NHI]')
    $t = [regex]::Replace($t, '\b\d{11}\b', '[CLAIM]')
    $t = [regex]::Replace($t, '\b\d{1,2}/\d{1,2}/\d{4}\b', '[DATE]')
    return $t
}

function Escape-Html {
    param([string]$S)
    if ($null -eq $S) { return '' }
    return [System.Net.WebUtility]::HtmlEncode([string]$S)
}

function Get-CdpTargets {
    param([string]$CdpBase)
    $url = ($CdpBase.TrimEnd('/') + '/json/list')
    try {
        return @(Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 10)
    } catch {
        throw "Could not reach the browser debug port at $CdpBase. Make sure Edge or Chrome is open with remote debugging."
    }
}

function Select-PortalTab {
    param($Targets)
    $pages = @($Targets | Where-Object {
            $_.type -eq 'page' -and
            $_.webSocketDebuggerUrl -and
            $_.url -and
            $_.url -notmatch '^(chrome|edge|devtools)://'
        })
    if (-not $pages.Count) { return $null }
    $acc = $pages | Where-Object { ($_.url + $_.title) -match 'acc|msreport|biprd' } | Select-Object -First 1
    if ($acc) { return $acc }
    return $pages[0]
}

function New-CdpSession {
    param([string]$WsUrl)

    Add-Type -AssemblyName System.Net.WebSockets -ErrorAction Stop
    Add-Type -AssemblyName System.Threading -ErrorAction Stop

    $ws = [System.Net.WebSockets.ClientWebSocket]::new()
    $uri = [Uri]$WsUrl
    $cts = [System.Threading.CancellationTokenSource]::new()

    $connectTask = $ws.ConnectAsync($uri, $cts.Token)
    if (-not $connectTask.Wait(15000)) {
        $ws.Dispose()
        throw 'WebSocket connect timed out.'
    }
    if ($connectTask.IsFaulted) {
        $ws.Dispose()
        throw ($connectTask.Exception.InnerException.Message)
    }

    return [PSCustomObject]@{
        WebSocket = $ws
        Cts       = $cts
    }
}

function Close-CdpSession {
    param($Session)
    if (-not $Session) { return }
    try {
        if ($Session.WebSocket -and $Session.WebSocket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
            $closeTask = $Session.WebSocket.CloseAsync(
                [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
                'done',
                $Session.Cts.Token
            )
            $closeTask.Wait(3000) | Out-Null
        }
    } catch {}
    try { $Session.WebSocket.Dispose() } catch {}
    try { $Session.Cts.Dispose() } catch {}
}

function Receive-CdpJson {
    param($Session, [int]$TimeoutMs = 60000)

    $ws = $Session.WebSocket
    $cts = $Session.Cts
    $buffer = New-Object byte[] 262144
    $ms = New-Object System.IO.MemoryStream

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
            throw 'WebSocket closed unexpectedly.'
        }
        $segment = [ArraySegment[byte]]::new($buffer)
        $receiveTask = $ws.ReceiveAsync($segment, $cts.Token)
        $remaining = ($deadline - [DateTime]::UtcNow).TotalMilliseconds
        if ($remaining -lt 1) { break }
        if (-not $receiveTask.Wait([int][Math]::Min($remaining, 5000))) { continue }

        $result = $receiveTask.Result
        if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
            throw 'WebSocket closed by browser.'
        }
        if ($result.Count -gt 0) {
            $ms.Write($buffer, 0, $result.Count)
        }
        if ($result.EndOfMessage) { break }
    }

    if ($ms.Length -eq 0) { return $null }
    $text = [Text.Encoding]::UTF8.GetString($ms.ToArray())
    return $text | ConvertFrom-Json
}

function Send-CdpCommand {
    param(
        $Session,
        [string]$Method,
        [hashtable]$Params = @{},
        [int]$TimeoutMs = 60000
    )

    $script:CdpNextId++
    $id = $script:CdpNextId
    $payload = @{ id = $id; method = $Method; params = $Params }
    $json = $payload | ConvertTo-Json -Compress -Depth 20

    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $segment = [ArraySegment[byte]]::new($bytes)
    $sendTask = $Session.WebSocket.SendAsync(
        $segment,
        [System.Net.WebSockets.WebSocketMessageType]::Text,
        $true,
        $Session.Cts.Token
    )
    if (-not $sendTask.Wait(10000)) {
        throw "CDP send timeout: $Method"
    }

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    while ([DateTime]::UtcNow -lt $deadline) {
        $msg = Receive-CdpJson -Session $Session -TimeoutMs ([int]($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        if (-not $msg) { continue }
        if ($msg.id -eq $id) {
            if ($msg.error) {
                $errText = if ($msg.error.message) { $msg.error.message } else { ($msg.error | ConvertTo-Json -Compress) }
                throw "CDP error ($Method): $errText"
            }
            return $msg.result
        }
    }
    throw "CDP timeout waiting for response: $Method"
}

function Initialize-CdpSession {
    param($Session)
    Send-CdpCommand -Session $Session -Method 'Page.enable' | Out-Null
    Send-CdpCommand -Session $Session -Method 'Runtime.enable' | Out-Null
    try { Send-CdpCommand -Session $Session -Method 'Accessibility.enable' | Out-Null } catch {}
}

function Invoke-CdpEvaluate {
    param(
        $Session,
        [string]$Expression
    )
    $result = Send-CdpCommand -Session $Session -Method 'Runtime.evaluate' -Params @{
        expression    = $Expression
        returnByValue = $true
    }
    if ($result.exceptionDetails) {
        $detail = if ($result.exceptionDetails.text) { $result.exceptionDetails.text } else { 'Runtime.evaluate failed' }
        throw $detail
    }
    return $result.result.value
}

function Get-CdpPageUrl {
    param($Session, [string]$Fallback = '')
    try {
        $tree = Send-CdpCommand -Session $Session -Method 'Page.getFrameTree'
        if ($tree.frameTree.frame.url) { return [string]$tree.frameTree.frame.url }
    } catch {}
    return $Fallback
}

function Get-PageSnapshot {
    param(
        $Session,
        [string]$FallbackUrl,
        [string]$FallbackTitle,
        [int]$Depth = 0,
        [bool]$IncludeLinks = $true
    )

    $url = Redact-Sensitive (Get-CdpPageUrl -Session $Session -Fallback $FallbackUrl)
    $title = Redact-Sensitive ([string](Invoke-CdpEvaluate -Session $Session -Expression 'document.title'))

    $links = @()
    $headings = @()
    $breadcrumbs = @()

    if ($IncludeLinks) {
        $linksJs = @'
(() => {
  const out = [];
  for (const el of document.querySelectorAll('a[href], button, [role="link"], [role="button"]')) {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const href = el.getAttribute('href') ?? '';
    const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
    if (!text && !href) continue;
    let selector = '';
    if (el.id) selector = '#' + el.id;
    else if (el.getAttribute('data-testid')) selector = '[data-testid="' + el.getAttribute('data-testid') + '"]';
    else if (el.getAttribute('aria-label')) selector = '[aria-label="' + el.getAttribute('aria-label') + '"]';
    out.push({ text: text.slice(0, 200), href, role, selector });
  }
  return out.slice(0, 200);
})()
'@
        $headingsJs = @'
(() =>
  [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 30))()
'@
        $breadcrumbsJs = @'
(() => {
  const nav = document.querySelector('[aria-label*="breadcrumb" i], nav.breadcrumb, .breadcrumb');
  if (!nav) return [];
  return [...nav.querySelectorAll('a, span, li')]
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
})()
'@

        try {
            $rawLinks = Invoke-CdpEvaluate -Session $Session -Expression $linksJs
            if ($rawLinks) {
                $links = @($rawLinks | ForEach-Object {
                        [PSCustomObject]@{
                            text     = Redact-Sensitive ([string]$_.text)
                            href     = [string]$_.href
                            role     = [string]$_.role
                            selector = [string]$_.selector
                        }
                    })
            }
        } catch {
            Write-Host "  [warn] link extraction skipped: $($_.Exception.Message)" -ForegroundColor Yellow
        }

        try {
            $rawHeadings = Invoke-CdpEvaluate -Session $Session -Expression $headingsJs
            if ($rawHeadings) {
                $headings = @($rawHeadings | ForEach-Object { Redact-Sensitive ([string]$_) })
            }
        } catch {}

        try {
            $rawCrumbs = Invoke-CdpEvaluate -Session $Session -Expression $breadcrumbsJs
            if ($rawCrumbs) {
                $breadcrumbs = @($rawCrumbs | ForEach-Object { Redact-Sensitive ([string]$_) })
            }
        } catch {}
    }

    if ([string]::IsNullOrWhiteSpace($title)) { $title = Redact-Sensitive $FallbackTitle }

    return [PSCustomObject]@{
        depth         = $Depth
        url           = $url
        title         = $title
        headings      = $headings
        breadcrumbs   = $breadcrumbs
        links         = $links
        accessibility = $null
        capturedAt    = (Get-Date).ToUniversalTime().ToString('o')
    }
}

function Write-PortalSummaryHtml {
    param(
        [hashtable]$Map,
        [string]$OutPath
    )

    $summaryPath = Join-Path (Split-Path -Parent $OutPath) 'portal-summary.html'
    $pageIndex = 0
    $rows = ($Map.pages | ForEach-Object {
            $p = $_
            $pageIndex++
            $linkCount = @($p.links).Count
            $headingLine = if (@($p.headings).Count) {
                "<p><strong>Headings:</strong> $(Escape-Html (($p.headings -join ' · ')))</p>"
            } else { '' }
            $linksBlock = if ($linkCount -gt 0) {
                $items = ($p.links | Select-Object -First 15 | ForEach-Object {
                        $lt = Escape-Html ($(if ($_.text) { $_.text } else { $_.href }))
                        $lh = Escape-Html $_.href
                        "<li>$lt <code>$lh</code></li>"
                    }) -join ''
                "<details><summary>Sample links ($([Math]::Min($linkCount, 15)) shown)</summary><ul>$items</ul></details>"
            } else { '' }

            @"
    <section class="page">
      <h2>$pageIndex. $(Escape-Html ($(if ($p.title) { $p.title } else { '(no title)' })))</h2>
      <p class="meta"><strong>URL:</strong> $(Escape-Html $p.url)</p>
      <p class="meta"><strong>Depth:</strong> $($p.depth) · <strong>Links:</strong> $linkCount</p>
      $headingLine
      $linksBlock
    </section>
"@
        }) -join "`n"

    $crawlLabel = if ($Map.crawlEnabled) { 'yes' } else { 'no' }
    $html = @"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>ACC Portal Discovery — $($Map.pageCount) page(s)</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { color: #0b5; }
    .page { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
    .meta { color: #555; font-size: 0.9rem; }
    code { font-size: 0.8rem; word-break: break-all; }
    .note { background: #fff8e6; padding: 0.75rem; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>ACC Portal Discovery</h1>
  <p class="note">Review and redact patient names or identifiers before sharing this file.</p>
  <p><strong>Pages captured:</strong> $($Map.pageCount) · <strong>Crawl:</strong> $crawlLabel</p>
  <p><strong>JSON:</strong> <code>$(Escape-Html $OutPath)</code></p>
  $rows
</body>
</html>
"@

    [System.IO.File]::WriteAllText($summaryPath, $html, [Text.Encoding]::UTF8)
    return $summaryPath
}

function ConvertTo-JsonDeep {
    param($InputObject, [int]$Depth = 20)
    return ($InputObject | ConvertTo-Json -Depth $Depth)
}

# --- Main ---

$root = $PSScriptRoot
if ([string]::IsNullOrEmpty($root)) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }

$portalUrl = 'http://cl-biprddb02/Reports_MSREPORT/browse/DHB-wide/ACC'
$cdpBase = 'http://127.0.0.1:9222'
$outDir = Join-Path $env:USERPROFILE 'ACC-Suite'
$outFile = Join-Path $outDir 'portal-map.json'
$summaryFile = Join-Path $outDir 'portal-summary.html'

Initialize-Ui
$ErrorActionPreference = 'Stop'

try {
    Write-Host ''
    Write-Host '  ACC Portal Discovery' -ForegroundColor Cyan
    Write-Host '  --------------------' -ForegroundColor Cyan
    Write-Host '  (PowerShell only — no extra software)' -ForegroundColor Gray
    Write-Host ''

    $browser = Find-BrowserExe
    if (-not $browser) {
        Show-MessageBox -Message 'Could not find Microsoft Edge or Google Chrome. Install Edge or Chrome, then try again.' -Icon Error
        exit 1
    }

    $browserName = Split-Path -Leaf $browser
    Write-Host "  Browser: $browserName" -ForegroundColor Gray
    Write-Host "  Output:  $outFile" -ForegroundColor Gray
    Write-Host ''

    New-Item -ItemType Directory -Force -Path $outDir | Out-Null

    $browserArgs = @(
        "--remote-debugging-port=9222",
        '--new-window',
        $portalUrl
    )
    Write-Host '  Opening browser with remote debugging on port 9222 …' -ForegroundColor Green
    Start-Process -FilePath $browser -ArgumentList $browserArgs | Out-Null
    Start-Sleep -Seconds 2

    Show-MessageBox -Message @"
Log into Citrix VPN and the ACC portal in the browser that opened.

Navigate to the ACC report / browse page if needed.

Click OK when you are on the report page and ready to scan.
"@ -Icon Information

    Write-Host '  Scanning portal (this may take a minute) …' -ForegroundColor Green
    Write-Host ''

    $allTargets = Get-CdpTargets -CdpBase $cdpBase
    $tab = Select-PortalTab -Targets $allTargets

    $pages = @()
    $webSocketWorked = $false
    $session = $null

    if ($tab -and $tab.webSocketDebuggerUrl) {
        try {
            Write-Host "  Attaching to: $($tab.title)" -ForegroundColor Gray
            $session = New-CdpSession -WsUrl $tab.webSocketDebuggerUrl
            Initialize-CdpSession -Session $session
            $snap = Get-PageSnapshot -Session $session -FallbackUrl $tab.url -FallbackTitle $tab.title -Depth 0 -IncludeLinks $true
            $pages += $snap
            $webSocketWorked = $true
            Write-Host "  [snap] $($snap.title) — $($snap.url)" -ForegroundColor Green
        } catch {
            Write-Host "  [warn] WebSocket snapshot failed: $($_.Exception.Message)" -ForegroundColor Yellow
            Write-Host '  Falling back to tab list only (URLs and titles).' -ForegroundColor Yellow
        } finally {
            Close-CdpSession -Session $session
            $session = $null
        }
    }

    if (-not $pages.Count) {
        $pageTargets = @($allTargets | Where-Object {
                $_.type -eq 'page' -and $_.url -and $_.url -notmatch '^(chrome|edge|devtools)://'
            })
        if (-not $pageTargets.Count) {
            Show-MessageBox -Message @"
No portal page found in the browser.

• Connect Citrix VPN first
• Stay on the ACC report page in the browser
• Close other Chrome/Edge windows if port 9222 is busy

Then double-click Start Portal Discover.cmd again.
"@ -Icon Error
            Read-Host 'Press Enter to close'
            exit 1
        }
        foreach ($t in $pageTargets) {
            $pages += [PSCustomObject]@{
                depth         = 0
                url           = Redact-Sensitive ([string]$t.url)
                title         = Redact-Sensitive ([string]$t.title)
                headings      = @()
                breadcrumbs   = @()
                links         = @()
                accessibility = $null
                capturedAt    = (Get-Date).ToUniversalTime().ToString('o')
            }
        }
        Write-Host "  Saved $($pages.Count) tab(s) from browser (no link extraction)." -ForegroundColor Yellow
    }

    $map = @{
        version       = 1
        generator     = 'portal-discover.ps1'
        cdpUrl        = $cdpBase
        crawlEnabled  = $false
        webSocketUsed = $webSocketWorked
        pageCount     = $pages.Count
        pages         = $pages
        allTargets    = @($allTargets | ForEach-Object {
                @{
                    id    = $_.id
                    type  = $_.type
                    url   = Redact-Sensitive ([string]$_.url)
                    title = Redact-Sensitive ([string]$_.title)
                }
            })
        notes         = @(
            'Review portal-map.json before commit — redact any patient names or identifiers.'
            'Do not store portal credentials in this file.'
        )
    }

    $json = ConvertTo-JsonDeep -InputObject $map
    [System.IO.File]::WriteAllText($outFile, $json, [Text.Encoding]::UTF8)
    Write-Host ''
    Write-Host "  Wrote $outFile ($($pages.Count) page(s))" -ForegroundColor Green

    $summaryFile = Write-PortalSummaryHtml -Map $map -OutPath $outFile
    Write-Host "  Wrote $summaryFile" -ForegroundColor Green
    Write-Host ''

    if (Test-Path -LiteralPath $summaryFile) {
        try { Start-Process $summaryFile | Out-Null } catch {
            Write-Host "  Could not open summary HTML. Open manually: $summaryFile" -ForegroundColor Yellow
        }
    }

    try { Start-Process explorer.exe $outDir | Out-Null } catch {
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

• Connect Citrix VPN first
• Stay on the ACC portal page in the browser
• Close other Chrome/Edge windows if port 9222 is busy

Check this window for details, then try again.
"@ -Icon Error
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}
