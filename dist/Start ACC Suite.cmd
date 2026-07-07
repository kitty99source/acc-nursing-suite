@echo off
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start ACC Suite.cmd started >> "%USERPROFILE%\ACC-Suite\logs\bootstrap.log"
cd /d "%~dp0"
echo.
echo   Starting the ACC District Nursing Admin Suite (local, offline)...
echo   Microsoft Edge will open shortly. Keep this window open while you work.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%USERPROFILE%\ACC-Suite\logs\bootstrap.log"
  pause
)
