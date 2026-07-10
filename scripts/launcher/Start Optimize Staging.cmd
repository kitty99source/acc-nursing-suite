@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\wfh-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Optimize Staging.cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
echo.
echo   ACC staging sidecar optimiser (one-off repair)
echo   ----------------------------------------------
echo   Strips embedded file bytes out of .staging sidecars so the Review
echo   Queue list loads fast and the "Local staging bridge is down" banner
echo   clears. Letter files stay available (resolved on demand by hash).
echo.
echo   Close the Folder Watch window before running for best results.
echo   Safe to run more than once.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Optimize-StagingSidecars.ps1"
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%BOOTLOG%"
  pause
) else (
  pause
)
