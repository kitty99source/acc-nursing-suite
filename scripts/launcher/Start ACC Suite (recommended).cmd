@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\wfh-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start ACC Suite (recommended).cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
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
