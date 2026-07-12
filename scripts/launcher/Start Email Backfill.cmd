@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\email-sync-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Email Backfill.cmd started (historical backfill alias) >> "%BOOTLOG%"
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
echo   ACC Outlook COM email BACKFILL (historical alias)
echo   -------------------------------------------------
echo   Requires Outlook desktop open and logged in.
echo   Mailbox: ACCDistrictNursing (override via office-config.json or ACC_SHARED_MAILBOX).
echo   Same sync as Start Email Sync.cmd - runs the full backlog including actioned mail.
echo   Use this launcher when you want a clearly labelled historical backfill run.
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
