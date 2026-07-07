@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0portal-discover.ps1"
exit /b %ERRORLEVEL%
