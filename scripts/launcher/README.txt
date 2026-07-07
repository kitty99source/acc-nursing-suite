ACC District Nursing Admin Suite — launchers

Logs are in %USERPROFILE%\ACC-Suite\logs — NOT in this dist folder. launcher-log.ps1 here is the script, not your log file.

Start ACC Suite.cmd        = main app (no extra software)
Start Portal Discover.cmd  = map the ACC portal (PowerShell only — built into Windows)

If a launcher closes instantly or something goes wrong, check:
  %USERPROFILE%\ACC-Suite\logs\

Each run writes a timestamped log file there. Send that file to support if asked.

Folder watch (optional)    = still needs Node.js on dev machine; not included in work-laptop dist yet
