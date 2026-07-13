' Quiet one-click launcher: NO visible PowerShell/cmd windows on the taskbar.
' Starts supervisor.ps1 with -Quiet via a Hidden PowerShell host. The supervisor:
'   - starts the app server Hidden (browser still opens)
'   - starts Folder Watch Hidden (direct powershell, not cmd /k)
'   - checks mail in Outlook once at session start
'   - checks mail again when you press Refresh in ACC Inbox
'   - silently restarts app server / Folder Watch if they die mid-session
'   - refuses to start a second supervisor (opens the app instead)
' Closing the last app browser tab ends the session (supervisor + helpers stop).
' If leftovers block folder delete: run "Stop ACC District Nursing Suite (force).vbs".
' Pin a Desktop shortcut to THIS .vbs (not quiet.cmd, not recommended.cmd).
' Logs still go to %USERPROFILE%\ACC-Suite\logs\
Option Explicit
Dim shell, fso, dir, ps1, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = dir & "\supervisor.ps1"
If Not fso.FileExists(ps1) Then
  MsgBox "Missing supervisor.ps1 next to this launcher." & vbCrLf & ps1, vbCritical, "ACC District Nursing Admin Suite"
  WScript.Quit 1
End If
' 0 = hidden window; False = do not wait
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """ -Quiet"
shell.Run cmd, 0, False
