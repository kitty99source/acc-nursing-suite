@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\wfh-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Reindex Inbox.cmd started >> "%BOOTLOG%"
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
echo   ACC inbox hash reindex (one-off repair)
echo   ---------------------------------------
echo   Rebuilds the hash -^> file map used by the app to load letter previews.
echo   Run this if letter previews are blank / show "not found" in Review Queue.
echo   Safe to run more than once.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Reindex-InboxHashes.ps1"
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%BOOTLOG%"
  pause
) else (
  pause
)
