@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\folder-watch-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Folder Watch.cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
echo.
echo   Starting ACC Folder Watch...
echo   Drop PDF or Word letters in %%USERPROFILE%%\ACC-Inbox
echo   Leave this window open while you work.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0folder-watch.ps1"
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%BOOTLOG%"
  pause
)
