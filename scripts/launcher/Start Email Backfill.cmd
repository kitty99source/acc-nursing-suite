@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\email-sync-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Email Backfill.cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
echo.
echo   ACC Outlook COM email BACKFILL (one-time)
echo   -----------------------------------------
echo   Requires Outlook desktop open and logged in.
echo   Mailbox: ACCDistrictNursing (override via office-config.json or ACC_SHARED_MAILBOX).
echo   ONE-TIME full backfill: INCLUDES already-actioned/flagged letters that the normal
echo   Start Email Sync.cmd skips, so historical ACC letters land in the Review Queue.
echo   Run this ONCE for the pilot; use Start Email Sync.cmd for day-to-day incremental sync.
echo   Saves PDF/DOCX attachments to %%USERPROFILE%%\ACC-Inbox
echo   Does NOT delete, move mail, or auto-import into the app.
echo.
echo   Switches (pass to outlook-sync.ps1):
echo     -Recent          recent mail only (last 14 days, newest first)
echo     -BatchSize 25    attachments per run (default 50)
echo     -Scheduled       future daemon mode - obeys accWorkHours window if enabled
echo     -IgnoreWorkHours force a scheduled run outside its work-hours window
echo.
echo   Tip: run Start Folder Watch.cmd next so letters stage for Review Queue.
echo.
set "SYNC_ARGS=-IncludeActioned"
if /I "%~1"=="-Recent" set "SYNC_ARGS=-IncludeActioned -Recent"
if /I "%~1"=="-Backlog" set "SYNC_ARGS=-IncludeActioned"
if not "%~2"=="" set "SYNC_ARGS=%SYNC_ARGS% %~2 %~3 %~4 %~5"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0outlook-sync.ps1" %SYNC_ARGS%
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%BOOTLOG%"
  pause
) else (
  pause
)
