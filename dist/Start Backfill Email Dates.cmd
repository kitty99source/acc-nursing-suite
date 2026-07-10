@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\email-sync-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Backfill Email Dates.cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
echo.
echo   ACC email date backfill (one-off repair)
echo   -----------------------------------------
echo   Fills in the email received date for letters that were synced BEFORE
echo   this field existed, so they show "Email received" in Review Queue.
echo.
echo   Prefers an exact Outlook lookup (open Outlook first for best results).
echo   Falls back to the saved file's timestamp when Outlook can't be reached
echo   or the item has moved/been deleted.
echo.
echo   Safe to run more than once - only touches letters still missing a date.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Backfill-EmailDates.ps1"
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%BOOTLOG%"
  pause
) else (
  pause
)
