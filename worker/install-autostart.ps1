param(
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$taskName = 'MatchPilot Personal Worker'

if ($Uninstall) {
  $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existingTask) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host 'MatchPilot autostart was removed.'
  } else {
    Write-Host 'The autostart task is not registered.'
  }
  exit 0
}

$startScript = Join-Path $PSScriptRoot 'start-worker.ps1'
$localApplicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localApplicationData)) { throw 'Windows LocalApplicationData is unavailable.' }
$secureEnvironmentFile = Join-Path (Join-Path $localApplicationData 'MatchPilot') 'worker.env'
$legacyEnvironmentFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $secureEnvironmentFile -PathType Leaf) -and -not (Test-Path -LiteralPath $legacyEnvironmentFile -PathType Leaf)) {
  throw 'Create worker/.env or run migrate-private-runtime.ps1 before installing autostart.'
}

$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -LogToFile"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $PSScriptRoot
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$triggers = @($logonTrigger, $watchdogTrigger)
$settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'MatchPilot personal browser automation worker with one-minute watchdog' -Force | Out-Null
Write-Host 'MatchPilot will start at Windows logon and the one-minute watchdog will recover unexpected stops.'
Write-Host 'Run Start-ScheduledTask -TaskName "MatchPilot Personal Worker" to start it now.'
