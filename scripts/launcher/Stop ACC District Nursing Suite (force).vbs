' Force-stop ACC District Nursing Admin Suite helpers (no console flash).
' If the app acts weird or you can't delete the folder, double-click this.
Option Explicit
Dim shell, fso, dir, ps1, cmd, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = dir & "\Stop-AccSuiteForce.ps1"
If Not fso.FileExists(ps1) Then
  MsgBox "Missing Stop-AccSuiteForce.ps1 next to this file." & vbCrLf & ps1, vbCritical, "ACC District Nursing Admin Suite"
  WScript.Quit 1
End If
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """"
rc = shell.Run(cmd, 1, True)
MsgBox "Force stop finished." & vbCrLf & vbCrLf & "You can delete the suite folder now if you need to." & vbCrLf & "To start again: use Start ACC Suite (quiet).vbs", vbInformation, "ACC District Nursing Admin Suite"
WScript.Quit rc
