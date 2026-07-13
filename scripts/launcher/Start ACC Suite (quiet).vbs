' Quiet one-click launcher: NO visible PowerShell/cmd windows on the taskbar.
' Starts wfh-mode.ps1 with -Quiet via a Hidden PowerShell host. Quiet mode:
'   - starts the app server Hidden (browser still opens)
'   - starts Folder Watch Hidden (direct powershell, not cmd /k)
'   - runs one Outlook email-sync in this same hidden process
' Closing the last app browser tab stops the hidden server + Folder Watch.
' Pin a Desktop shortcut to THIS .vbs (not quiet.cmd, not recommended.cmd).
' Logs still go to %USERPROFILE%\ACC-Suite\logs\
Option Explicit
Dim shell, fso, dir, ps1, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = dir & "\wfh-mode.ps1"
If Not fso.FileExists(ps1) Then
  MsgBox "Missing wfh-mode.ps1 next to this launcher." & vbCrLf & ps1, vbCritical, "ACC District Nursing Admin Suite"
  WScript.Quit 1
End If
' 0 = hidden window; False = do not wait
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """ -Quiet"
shell.Run cmd, 0, False
