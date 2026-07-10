@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\wfh-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Reindex Inbox.cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
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
