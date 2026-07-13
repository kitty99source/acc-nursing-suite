@echo off
REM Quiet entry hands off to the .vbs so this .cmd does not keep a console open.
REM Prefer pinning the .vbs Desktop shortcut for true zero-flash launch.
cd /d "%~dp0"
start "" wscript //B "%~dp0Start ACC Suite (quiet).vbs"
exit /b 0
