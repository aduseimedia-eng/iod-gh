$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$LogPath = Join-Path $ProjectRoot "sync-railway-to-local.log"

Set-Location $ProjectRoot

"[$(Get-Date -Format o)] Starting Railway to local Postgres sync" | Out-File -FilePath $LogPath -Append
npm.cmd run sync:railway-to-local:full *>> $LogPath
$ExitCode = $LASTEXITCODE

if ($ExitCode -eq 0) {
    "[$(Get-Date -Format o)] Sync completed successfully" | Out-File -FilePath $LogPath -Append
} else {
    "[$(Get-Date -Format o)] Sync failed with exit code $ExitCode" | Out-File -FilePath $LogPath -Append
}

exit $ExitCode
