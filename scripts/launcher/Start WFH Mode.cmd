@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\wfh-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start WFH Mode.cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
echo.
echo   ACC Work From Home Mode
echo   -----------------------
echo   One double-click starts everything you need:
echo     - ACC Suite app (minimized, local browser)
echo     - Folder Watch (separate window, stays open)
echo     - Email Sync (runs once here, then you are done)
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
