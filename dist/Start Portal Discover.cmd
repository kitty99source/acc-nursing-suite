@echo off
cd /d "%~dp0"
echo.
echo   Starting ACC Portal Discovery...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0portal-discover.ps1"
if errorlevel 1 pause
