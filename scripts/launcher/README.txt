ACC District Nursing Admin Suite - launchers

Logs are in %USERPROFILE%\ACC-Suite\logs - NOT in this dist folder.

  acc-bootstrap.log        = ACC Suite .cmd + launch.ps1 (always written)
  portal-bootstrap.log     = Portal Discover .cmd + portal-discover.ps1
  folder-watch-bootstrap.log = Folder Watch .cmd + folder-watch.ps1
  email-probe-bootstrap.log  = Email Probe .cmd + outlook-probe.ps1
  email-sync-bootstrap.log   = Email Sync .cmd + outlook-sync.ps1
  wfh-bootstrap.log          = WFH Mode .cmd + wfh-mode.ps1
  acc-suite-*.log          = main app run log (needs launcher-log.ps1)
  portal-discover-*.log    = portal discovery run log
  folder-watch-*.log       = folder watch run log

HOW TO OPEN THE SUITE

  Start ACC Suite (quiet).vbs = BEST FOR DAY-TO-DAY / DESKTOP SHORTCUT.
                             Double-click (or pin a Desktop shortcut to this
                             file). Truly quiet: NO visible PowerShell or cmd
                             windows. Starts supervisor.ps1 -Quiet so the app
                             server and Folder Watch run Hidden, opens the
                             browser, checks mail once at session start, and
                             silently restarts helpers if they die mid-session.
                             Press Refresh in ACC Inbox to check mail again.
                             Prefer this for coworkers - pin the .vbs, not a
                             .cmd. Closing the last app browser tab ends the
                             session (supervisor + helpers stop). Only ONE
                             supervisor runs at a time.

  Stop ACC District Nursing Suite (force).cmd / .vbs
                             If the app acts weird or you can't delete the
                             folder, run Stop … (force). It closes leftover
                             helpers for this suite only and clears stale
                             PID files under %USERPROFILE%\ACC-Suite\.

  Start ACC Suite (quiet).cmd = hands off to the quiet .vbs (exits immediately).
                             A brief cmd flash is possible; use the .vbs for
                             zero flash.

  Start ACC Suite (recommended).cmd = START HERE if you want to SEE progress in
                             a console. Same supervised session as the quiet
                             .vbs: ACC Suite app + Folder Watch (kept alive) +
                             Email Sync at session start (and again on Refresh).
                             (Same as Start WFH Mode.cmd / wfh-mode.ps1.)

  Start ACC Suite.cmd        = MINIMAL FALLBACK: the app alone, no sync. Use only
                             when you do not want folder-watch/email-sync running.
                             ACC Inbox Refresh can still start a one-off mail
                             check if the helper is up.

Other launchers

Start Portal Discover.cmd  = map the ACC portal (PowerShell only - built into Windows)
Start Folder Watch.cmd     = watch ACC-Inbox for letter drops (PowerShell only - built into Windows)
Start Email Probe.cmd      = test Outlook COM read on work laptop (read-only, no attachments saved)
Start Email Sync.cmd       = sync ACC letter attachments from Outlook to ACC-Inbox (runs once)
Start WFH Mode.cmd         = thin forwarder to the same supervisor (kept for existing shortcuts)

If a launcher closes instantly or something goes wrong, check:
  %USERPROFILE%\ACC-Suite\logs\acc-bootstrap.log or portal-bootstrap.log (first place to look)
  %USERPROFILE%\ACC-Suite\logs\

Each successful run also writes a timestamped log file there. Send those files to support if asked.

Folder watch (optional)    = double-click Start Folder Watch.cmd on work laptop.
                             Drop PDF or Word letters in %USERPROFILE%\ACC-Inbox
                             Sidecars land in ACC-Inbox\.staging\ - import in Review Queue.
                             Dev Mac: npm run wfh:folder-watch (Node, for testing only).
                             Quiet/recommended mode starts Folder Watch for you; closing
                             the last app tab also stops it.
