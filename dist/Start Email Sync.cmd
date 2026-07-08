@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\email-sync-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Email Sync.cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
echo.
echo   ACC Outlook COM email sync
echo   --------------------------
echo   Requires Outlook desktop open and logged in.
echo   Default: backlog mode - oldest unactioned ACC letters first (batch per run).
echo   Work hours only (7am-6pm NZ). Skips Outlook category "actioned".
echo   Saves PDF/DOCX attachments to %%USERPROFILE%%\ACC-Inbox
echo   Does NOT delete, move mail, or auto-import into the app.
echo.
echo   Switches (pass to outlook-sync.ps1):
echo     -Recent          recent mail only (last 14 days, newest first)
echo     -BatchSize 25    attachments per run (default 50)
echo     -IgnoreWorkHours run outside 7am-6pm NZ
echo.
echo   Tip: run Start Folder Watch.cmd next so letters stage for Review Queue.
echo.
set "SYNC_ARGS="
if /I "%~1"=="-Recent" set "SYNC_ARGS=-Recent"
if /I "%~1"=="-Backlog" set "SYNC_ARGS="
if not "%~2"=="" set "SYNC_ARGS=%SYNC_ARGS% %~2 %~3 %~4 %~5"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0outlook-sync.ps1" %SYNC_ARGS%
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%BOOTLOG%"
  pause
) else (
  pause
)
