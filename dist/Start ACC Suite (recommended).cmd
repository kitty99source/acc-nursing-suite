@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\wfh-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start ACC Suite (recommended).cmd started >> "%BOOTLOG%"
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
echo   ACC District Nursing Admin Suite - RECOMMENDED (supervised session)
echo   -------------------------------------------------------------------
echo   This is the normal visible way to open the suite. One double-click
echo   starts a supervisor that keeps helpers alive:
echo     - ACC Suite app (minimized, local browser)
echo     - Folder Watch (kept alive; restarts if it dies mid-session)
echo     - Email Sync (runs once at session start)
echo   Closing the last app browser tab ends the session.
echo.
echo   Why this one: folder-watch + email-sync so ACC letters flow into the
echo   Review Queue. Prefer the quiet .vbs Desktop shortcut for no windows.
echo   Use "Start ACC Suite.cmd" only if you want the app alone with no sync.
echo.
echo   Requires Outlook desktop open for email sync.
echo   Individual Start *.cmd files still work for debugging.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0supervisor.ps1"
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%BOOTLOG%"
  pause
) else (
  pause
)
