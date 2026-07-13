@echo off
REM Force-stop ACC District Nursing Admin Suite helpers (coworker-safe).
REM If the app acts weird or you can't delete the folder, run this.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-AccSuiteForce.ps1"
echo.
pause
