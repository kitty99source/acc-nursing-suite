ACC District Nursing Admin Suite - launchers

Logs are in %USERPROFILE%\ACC-Suite\logs - NOT in this dist folder.

  acc-bootstrap.log        = ACC Suite .cmd + launch.ps1 (always written)
  portal-bootstrap.log     = Portal Discover .cmd + portal-discover.ps1
  folder-watch-bootstrap.log = Folder Watch .cmd + folder-watch.ps1
  email-probe-bootstrap.log  = Email Probe .cmd + outlook-probe.ps1
  acc-suite-*.log          = main app run log (needs launcher-log.ps1)
  portal-discover-*.log    = portal discovery run log
  folder-watch-*.log       = folder watch run log

Start ACC Suite.cmd        = main app (no extra software)
Start Portal Discover.cmd  = map the ACC portal (PowerShell only - built into Windows)
Start Folder Watch.cmd     = watch ACC-Inbox for letter drops (PowerShell only - built into Windows)
Start Email Probe.cmd      = test Outlook COM read on work laptop (read-only, no attachments saved)

If a launcher closes instantly or something goes wrong, check:
  %USERPROFILE%\ACC-Suite\logs\acc-bootstrap.log or portal-bootstrap.log (first place to look)
  %USERPROFILE%\ACC-Suite\logs\

Each successful run also writes a timestamped log file there. Send those files to support if asked.

Folder watch (optional)    = double-click Start Folder Watch.cmd on work laptop.
                             Drop PDF or Word letters in %USERPROFILE%\ACC-Inbox
                             Sidecars land in ACC-Inbox\.staging\ — import in Review Queue.
                             Dev Mac: npm run wfh:folder-watch (Node, for testing only).
