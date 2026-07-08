@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\email-sync-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Email Sync.cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
echo.
echo   ACC Outlook COM email sync
echo   --------------------------
echo   Requires Outlook desktop open and logged in.
echo   Saves ACC letter PDF/DOCX attachments to %%USERPROFILE%%\ACC-Inbox
echo   Does NOT delete or move mail.
echo.
echo   Tip: run Start Folder Watch.cmd next so letters stage for Review Queue.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0outlook-sync.ps1"
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%BOOTLOG%"
  pause
) else (
  pause
)
