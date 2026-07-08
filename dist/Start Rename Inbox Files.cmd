@echo off
set "BOOTLOG=%USERPROFILE%\ACC-Suite\logs\inbox-rename-bootstrap.log"
mkdir "%USERPROFILE%\ACC-Suite\logs" 2>nul
echo [%date% %time%] Start Rename Inbox Files.cmd started >> "%BOOTLOG%"
cd /d "%~dp0"
echo.
echo   ACC Inbox attachment rename
echo   ---------------------------
echo   Makes older ACC-Inbox / processed filenames match the patient+claim
echo   naming used by Email Sync (e.g. Woods-Diane_Claim1005..._vendor.docx).
echo.
echo   SAFETY:
echo     1. STOP Start Folder Watch.cmd first (leave it closed during rename).
echo     2. Default is DRY-RUN - prints old -^> new names, changes nothing.
echo     3. Pass -Apply to actually rename (writes a reversible log under
echo        %%USERPROFILE%%\ACC-Suite\logs\inbox-rename-YYYYMMDD.log).
echo.
echo   Uses subjects from email-sync-status.json. Files without subject
echo   metadata are listed and left unchanged.
echo.
set "RENAME_ARGS="
if /I "%~1"=="-Apply" set "RENAME_ARGS=-Apply"
if /I "%~1"=="apply" set "RENAME_ARGS=-Apply"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Rename-AccInboxAttachments.ps1" %RENAME_ARGS%
if errorlevel 1 (
  echo [%date% %time%] PowerShell failed errorlevel %ERRORLEVEL% >> "%BOOTLOG%"
  pause
) else (
  pause
)
