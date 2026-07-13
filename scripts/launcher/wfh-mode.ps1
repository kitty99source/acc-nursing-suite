param(
    [switch]$Quiet,
    [switch]$SkipEmailSync
)

# Back-compat entry: recommended.cmd / Start WFH Mode.cmd / older docs called
# wfh-mode.ps1. Session ownership now lives in supervisor.ps1.

$bootstrapRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($bootstrapRoot)) { $bootstrapRoot = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent }
$supervisor = Join-Path $bootstrapRoot 'supervisor.ps1'
if (-not (Test-Path -LiteralPath $supervisor)) {
    Write-Host "FAIL - missing supervisor.ps1 next to wfh-mode.ps1: $supervisor"
    exit 1
}
$forward = @{ Quiet = $Quiet; SkipEmailSync = $SkipEmailSync }
& $supervisor @forward
exit $LASTEXITCODE
