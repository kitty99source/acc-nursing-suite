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
echo   ACC District Nursing Admin Suite - RECOMMENDED (Work From Home Mode)
echo   -------------------------------------------------------------------
echo   This is the normal way to open the suite. One double-click starts:
echo     - ACC Suite app (minimized, local browser)
echo     - Folder Watch (separate window, stays open)
echo     - Email Sync (runs once here, then you are done)
echo.
echo   Why this one: it also starts folder-watch + email-sync, so ACC
echo   letters actually flow into the Review Queue. Use "Start ACC Suite.cmd"
echo   only if you want the app alone with no sync (minimal fallback).
echo.
echo   Requires Outlook desktop open for email sync.
echo   Individual Start *.cmd files still work for debugging.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wfh-mode.ps1"
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%BOOTLOG%"
  pause
) else (
  pause
)
