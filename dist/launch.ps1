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

$script:LauncherHadError = $false
$script:LauncherLogPath = $null

try {
    $logHelper = Join-Path $PSScriptRoot 'launcher-log.ps1'
    if (-not (Test-Path -LiteralPath $logHelper)) {
        $logHelper = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'launcher-log.ps1'
    }
    . $logHelper
    Initialize-LauncherLog -Prefix 'acc-suite' -ShowSuccessOnExit:$false | Out-Null

    $ErrorActionPreference = 'Stop'
    Write-LauncherLog 'Step: resolve index.html path'

    $root = $PSScriptRoot
    if ([string]::IsNullOrEmpty($root)) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
    $indexPath = Join-Path $root 'index.html'

    if (-not (Test-Path -LiteralPath $indexPath)) {
        throw "index.html was not found next to this script: $indexPath"
    }

    Write-LauncherLog "Step: read index.html ($indexPath)"
    $htmlBytes = [System.IO.File]::ReadAllBytes($indexPath)

    Write-LauncherLog 'Step: bind TcpListener to loopback'
    $loopback = [System.Net.IPAddress]::Loopback
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
            if ($candidate) { try { $candidate.Stop() } catch {} }
        }
    }

    if ($null -eq $listener) {
        try {
            $candidate = New-Object System.Net.Sockets.TcpListener($loopback, 0)
            $candidate.Start()
            $listener = $candidate
            $port = ([System.Net.IPEndPoint]$candidate.LocalEndpoint).Port
        } catch {
            throw "Could not bind a local port: $($_.Exception.Message)"
        }
    }

    $url = "http://127.0.0.1:$port/"
    Write-LauncherLog "Step: listening at $url"

    Write-Host ""
    Write-Host "  ACC District Nursing Admin Suite" -ForegroundColor Cyan
    Write-Host "  --------------------------------" -ForegroundColor Cyan
    Write-Host "  Serving locally at: $url" -ForegroundColor Green
    Write-Host "  URL=$url"
    Write-Host ""
    Write-Host "  This is LOCAL ONLY (loopback 127.0.0.1) - nothing is exposed to the network." -ForegroundColor Gray
    Write-Host "  Keep this window open while you use the app; close it (or press Ctrl+C) to stop." -ForegroundColor Yellow
    Write-Host ""

    Write-LauncherLog 'Step: open browser'
    try {
        Start-Process "msedge.exe" $url -ErrorAction Stop | Out-Null
        Write-LauncherLog 'Step: opened Microsoft Edge'
    } catch {
        try {
            Start-Process $url -ErrorAction Stop | Out-Null
            Write-LauncherLog 'Step: opened default browser'
        } catch {
            Write-LauncherLog "WARN: could not auto-open browser — open manually: $url"
            Write-Host "  Could not auto-open a browser. Open this URL manually: $url" -ForegroundColor Yellow
        }
    }

    Show-LauncherStartupSuccess -Title 'ACC Suite'

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
        } catch {}
    }

    $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
    Write-LauncherLog 'Step: enter serve loop'

    try {
        while ($true) {
            $client = $null
            try {
                $client = $listener.AcceptTcpClient()
                $client.ReceiveTimeout = 5000
                $client.SendTimeout = 5000

                $stream = $client.GetStream()
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
                        if ($sb.Length -gt 65536) { break }
                    } else {
                        Start-Sleep -Milliseconds 10
                    }
                }

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
            } finally {
                if ($client) { try { $client.Close() } catch {} }
            }
        }
    } finally {
        if ($listener) { try { $listener.Stop() } catch {} }
        Write-LauncherLog 'Step: server stopped'
        Write-Host ""
        Write-Host "  Server stopped. You can close this window." -ForegroundColor Gray
    }
} catch {
    $script:LauncherHadError = $true
    if (Get-Command Write-LauncherLogException -ErrorAction SilentlyContinue) {
        Write-LauncherLogException $_
    } else {
        try {
            $fallbackDir = Join-Path $env:USERPROFILE 'ACC-Suite\logs'
            [void][System.IO.Directory]::CreateDirectory($fallbackDir)
            $fallbackLog = Join-Path $fallbackDir "acc-suite-$(Get-Date -Format 'yyyy-MM-dd-HHmmss').log"
            Add-Content -LiteralPath $fallbackLog -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] FATAL: $($_.Exception.Message)"
            $script:LauncherLogPath = $fallbackLog
        } catch {}
        Write-Host $_.Exception.Message -ForegroundColor Red
    }
} finally {
    if (Get-Command Complete-LauncherLog -ErrorAction SilentlyContinue) {
        if ($script:LauncherHadError) {
            Complete-LauncherLog -Title 'ACC Suite'
        }
    } elseif ($script:LauncherHadError -and $script:LauncherLogPath) {
        try {
            Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
            [System.Windows.Forms.MessageBox]::Show(
                "Error — log saved to:`n$($script:LauncherLogPath)`n`nSend this file to support.",
                'ACC Suite',
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            ) | Out-Null
        } catch {
            Read-Host 'Press Enter to close'
        }
    }
}
