@echo off
cd /d "%~dp0"
set "ACC_LAUNCHER_DIR=%~dp0"
set "LAST_RUN=%~dp0last-run.log"
set "USER_LOG_DIR=%USERPROFILE%\ACC-Suite\logs\"

echo.
echo   Starting the ACC District Nursing Admin Suite (local, offline)...
echo   Microsoft Edge will open shortly. Keep this window open while you work.
echo.
echo   Log folders (if anything goes wrong):
echo     %USER_LOG_DIR%
echo     %LAST_RUN%
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" >> "%LAST_RUN%" 2>&1
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% NEQ 0 (
    echo.
    echo   *** LAUNCH FAILED (exit code %EXITCODE%) ***
    echo   Open these log files and send to Prakriti:
    echo     %USER_LOG_DIR%
    echo     %LAST_RUN%
    echo.
    msg.exe %USERNAME% /time:120 "ACC Suite failed. Logs: %USER_LOG_DIR% or %LAST_RUN%"
    pause
    exit /b %EXITCODE%
)
