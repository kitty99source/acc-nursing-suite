@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\email-diagnose-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Email Diagnose.cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
echo.
echo   ACC Outlook email diagnose (read-only)
echo   --------------------------------------
echo   Requires Outlook desktop open and logged in.
echo   Shows inbox resolution, first 5 messages, and filter match tests.
echo   Does NOT save attachments or change mail.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0outlook-diagnose.ps1"
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%BOOTLOG%"
  pause
) else (
  pause
)
