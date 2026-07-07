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

$ErrorActionPreference = 'Stop'

# --- Optional logging (must never block launch) --------------------------------
$script:LauncherLogEnabled = $false

function Write-LauncherLogSafe {
    param([string]$Message)
    try {
        if ($script:LauncherLogEnabled -and (Get-Command Write-LauncherLog -ErrorAction SilentlyContinue)) {
            Write-LauncherLog $Message
        }
    } catch {}
}

try {
    $logRoot = $PSScriptRoot
    if ([string]::IsNullOrEmpty($logRoot)) { $logRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
    $logHelper = Join-Path $logRoot 'launcher-log.ps1'
    if (Test-Path -LiteralPath $logHelper) {
        . $logHelper
        Initialize-LauncherLog -Prefix 'acc-suite' -ShowSuccessOnExit:$false | Out-Null
        $script:LauncherLogEnabled = $true
    }
} catch {}

# --- Resolve the file to serve (sibling index.html) -------------------------
$root = $PSScriptRoot
if ([string]::IsNullOrEmpty($root)) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
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
Write-LauncherLogSafe "Step: read index.html"
$htmlBytes = [System.IO.File]::ReadAllBytes($indexPath)

# --- Bind a TcpListener to loopback on a free port --------------------------
Write-LauncherLogSafe 'Step: bind TcpListener to loopback'
$loopback = [System.Net.IPAddress]::Loopback   # 127.0.0.1 ONLY - never 0.0.0.0
$preferred = 8765
$maxPort = 8800

$listener = $null
$port = 0

for ($p = $preferred; $p -le $maxPort; $p++) {
    try {
        $candidate = New-Object System.Net.Sockets.TcpListener($loopback, $p)
        $candidate.Start()
        $listener = $candidate
        $port = $p
        break
    } catch {
        # Port busy / unavailable - try the next one.
        if ($candidate) { try { $candidate.Stop() } catch {} }
    }
}

# If the whole preferred range is taken, let the OS pick any free port (port 0).
if ($null -eq $listener) {
    try {
        $candidate = New-Object System.Net.Sockets.TcpListener($loopback, 0)
        $candidate.Start()
        $listener = $candidate
        $port = ([System.Net.IPEndPoint]$candidate.LocalEndpoint).Port
    } catch {
        Write-LauncherLogSafe "ERROR: could not bind a local port — $($_.Exception.Message)"
        Write-Host "ERROR: could not bind a local port. $_" -ForegroundColor Red
        Read-Host "Press Enter to close"
        exit 1
    }
}

$url = "http://127.0.0.1:$port/"
Write-LauncherLogSafe "Step: listening at $url"

# --- Friendly banner --------------------------------------------------------
Write-Host ""
Write-Host "  ACC District Nursing Admin Suite" -ForegroundColor Cyan
Write-Host "  --------------------------------" -ForegroundColor Cyan
Write-Host "  Serving locally at: $url" -ForegroundColor Green
Write-Host "  URL=$url"   # machine-readable line for tests/automation
Write-Host ""
Write-Host "  This is LOCAL ONLY (loopback 127.0.0.1) - nothing is exposed to the network." -ForegroundColor Gray
Write-Host "  Keep this window open while you use the app; close it (or press Ctrl+C) to stop." -ForegroundColor Yellow
Write-Host ""

# --- Open the browser (Edge preferred, default browser as fallback) ---------
Write-LauncherLogSafe 'Step: open browser'
try {
    Start-Process "msedge.exe" $url -ErrorAction Stop | Out-Null
    Write-LauncherLogSafe 'Step: opened Microsoft Edge'
} catch {
    try {
        Start-Process $url -ErrorAction Stop | Out-Null
        Write-LauncherLogSafe 'Step: opened default browser'
    } catch {
        Write-LauncherLogSafe "WARN: could not auto-open browser — open manually: $url"
        Write-Host "  Could not auto-open a browser. Open this URL manually: $url" -ForegroundColor Yellow
    }
}

# --- Helper: send one HTTP response, then close the connection --------------
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

$notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")

# --- Serve loop: resilient, one bad connection never kills the server -------
Write-LauncherLogSafe 'Step: enter serve loop'
try {
    while ($true) {
        $client = $null
        try {
            $client = $listener.AcceptTcpClient()   # blocks until a connection arrives
            $client.ReceiveTimeout = 5000
            $client.SendTimeout = 5000

            $stream = $client.GetStream()

            # Read the request line tolerantly (may arrive in pieces).
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
                    if ($sb.Length -gt 65536) { break }   # absurdly long - bail
                } else {
                    Start-Sleep -Milliseconds 10
                }
            }

            # Parse the method; default to a 404 for anything that isn't a clean GET.
            $method = ''
            if ($requestLine) {
                $parts = $requestLine.Split(' ')
                if ($parts.Length -ge 1) { $method = $parts[0].ToUpperInvariant() }
            }

            if ($method -eq 'GET') {
                Send-Response -Client $client -StatusCode 200 -StatusText 'OK' -Body $htmlBytes
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
