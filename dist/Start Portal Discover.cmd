@echo off
echo.
echo   ACC Portal Discovery
echo   --------------------
echo   A browser will open. Log into Citrix VPN and the ACC portal, then click OK.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0portal-discover.ps1"
