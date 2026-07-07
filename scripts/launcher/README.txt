ACC District Nursing Admin Suite — launchers

Logs are in %USERPROFILE%\ACC-Suite\logs — NOT in this dist folder.

  bootstrap.log          = always written (even if launch fails immediately)
  acc-suite-*.log        = main app run log (needs launcher-log.ps1)
  portal-discover-*.log  = portal discovery run log

Start ACC Suite.cmd        = main app (no extra software)
Start Portal Discover.cmd  = map the ACC portal (PowerShell only — built into Windows)

If a launcher closes instantly or something goes wrong, check:
  %USERPROFILE%\ACC-Suite\logs\bootstrap.log   (first place to look)
  %USERPROFILE%\ACC-Suite\logs\

Each successful run also writes a timestamped log file there. Send those files to support if asked.

Folder watch (optional)    = still needs Node.js on dev machine; not included in work-laptop dist yet
