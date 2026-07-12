@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\email-probe-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Email Probe.cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
echo "%~dp0"| findstr /I /C:".zip" >nul
if not errorlevel 1 (
  echo.
  echo   ============================================================
  echo     STOP: This is running from INSIDE a .zip file, not a
  echo     real extracted folder.
  echo   ============================================================
  echo.
  echo   Windows let you run this straight out of the downloaded .zip
  echo   without extracting it first ^(Explorer's zip-preview view^).
  echo   That breaks this launcher: it needs its helper files sitting
  echo   right next to it as real files, which the zip preview does
  echo   not provide.
  echo.
  echo   Fix:
  echo     1. Close this window.
  echo     2. In File Explorer, right-click the downloaded .zip file
  echo        and choose "Extract All..." to a real folder ^(Desktop
  echo        or Documents work well^).
  echo     3. Open the EXTRACTED folder ^(NOT the zip^) and re-run this
  echo        file from there.
  echo.
  pause
  exit /b 1
)
echo.
echo   ACC Outlook COM probe (read-only test)
echo   --------------------------------------
echo   Requires Outlook desktop open and logged in.
echo   Lists unread count + last 3 subjects only (no body).
echo   Does NOT save attachments or change mail.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0outlook-probe.ps1"
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%BOOTLOG%"
  pause
) else (
  pause
)
