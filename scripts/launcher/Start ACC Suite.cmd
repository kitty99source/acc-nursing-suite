@echo off
cd /d "%~dp0"
echo.
echo   Starting the ACC District Nursing Admin Suite (local, offline)...
echo   Microsoft Edge will open shortly. Keep this window open while you work.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
if errorlevel 1 pause
