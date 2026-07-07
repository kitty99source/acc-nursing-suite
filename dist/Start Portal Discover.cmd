@echo off
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Portal Discover.cmd started >> "%USERPROFILE%\ACC-Suite\logs\bootstrap.log"
cd /d "%~dp0"
echo.
echo   Starting ACC Portal Discovery...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0portal-discover.ps1"
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%USERPROFILE%\ACC-Suite\logs\bootstrap.log"
  pause
)
