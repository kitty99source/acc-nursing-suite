@echo off
cd /d "%~dp0"
echo.
echo   Opening ACC-Inbox folder in File Explorer...
echo   Drop PDF or Word (.docx) letters here for Folder Watch.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-inbox-folder.ps1"
if errorlevel 1 pause
