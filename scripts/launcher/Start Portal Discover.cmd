@echo off
cd /d "%~dp0"
set "ACC_LAUNCHER_DIR=%~dp0"
set "LAST_RUN=%~dp0last-run.log"
set "USER_LOG_DIR=%USERPROFILE%\ACC-Suite\logs\"

echo.
echo   Starting ACC Portal Discovery...
echo.
echo   Log folders (if anything goes wrong):
echo     %USER_LOG_DIR%
echo     %LAST_RUN%
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0portal-discover.ps1" >> "%LAST_RUN%" 2>&1
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% NEQ 0 (
    echo.
    echo   *** PORTAL DISCOVERY FAILED (exit code %EXITCODE%) ***
    echo   Open these log files and send to Prakriti:
    echo     %USER_LOG_DIR%
    echo     %LAST_RUN%
    echo.
    msg.exe %USERNAME% /time:120 "Portal Discover failed. Logs: %USER_LOG_DIR% or %LAST_RUN%"
    pause
    exit /b %EXITCODE%
)
