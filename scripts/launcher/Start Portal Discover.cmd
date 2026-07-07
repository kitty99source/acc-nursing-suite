@echo off
cd /d "%~dp0"
echo.
echo   Starting ACC Portal Discovery...
echo   A log file is saved to %%USERPROFILE%%\ACC-Suite\logs\
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0portal-discover.ps1"
exit /b %ERRORLEVEL%
