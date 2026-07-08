@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\email-probe-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Email Probe.cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
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
