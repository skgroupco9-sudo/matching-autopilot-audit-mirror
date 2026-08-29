param()

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()
$localApplicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localApplicationData)) { throw 'Windows LocalApplicationData is unavailable.' }
$runtimeRoot = Join-Path $localApplicationData 'MatchPilot'
$secureEnvironmentFile = Join-Path $runtimeRoot 'worker.env'
$legacyEnvironmentFile = Join-Path $PSScriptRoot '.env'
$environmentFile = if (Test-Path -LiteralPath $secureEnvironmentFile -PathType Leaf) { $secureEnvironmentFile } else { $legacyEnvironmentFile }

if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
  throw 'MatchPilot worker settings are missing. Run migrate-private-runtime.ps1.'
}

if ($environmentFile -like '*\OneDrive\*') {
  $warnings.Add('Worker settings are still under OneDrive. Run migrate-private-runtime.ps1.')
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath $environmentFile) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $name, $value = $line -split '=', 2
  $settings[$name.Trim()] = $value.Trim()
}

foreach ($requiredName in @('CONTROL_PLANE_URL', 'WORKER_SHARED_SECRET', 'WORKER_BINDING_TOKEN', 'WORKER_USER_ID', 'CHROME_EXECUTABLE_PATH')) {
  if ([string]::IsNullOrWhiteSpace($settings[$requiredName])) {
    $failures.Add("$requiredName is missing.")
  }
}

if ([string]::IsNullOrWhiteSpace($settings['OPENAI_API_KEY'])) {
  $warnings.Add('No local OPENAI_API_KEY. The worker will use the encrypted Web setting when configured.')
}

if (-not [string]::IsNullOrWhiteSpace($settings['CHROME_EXECUTABLE_PATH']) -and -not (Test-Path -LiteralPath $settings['CHROME_EXECUTABLE_PATH'] -PathType Leaf)) {
  $failures.Add('CHROME_EXECUTABLE_PATH does not point to Chrome.')
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
  $failures.Add('Node.js was not found.')
} else {
  $nodeVersion = (& $nodeExecutable --version).Trim()
  $nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
  if ($nodeMajor -lt 22) { $failures.Add("Node.js 22 or later is required. Current: $nodeVersion") }
}

$task = Get-ScheduledTask -TaskName 'MatchPilot Personal Worker' -ErrorAction SilentlyContinue
if (-not $task) {
  $failures.Add('The Windows autostart task is missing. Run install-autostart.ps1.')
} elseif ($task.State -eq 'Disabled') {
  $failures.Add('The Windows autostart task is disabled.')
} elseif ($task.State -ne 'Running') {
  $failures.Add('The Windows autostart task is not running. Start it and run doctor.ps1 again.')
} elseif (@($task.Triggers).Count -lt 2) {
  $failures.Add('The one-minute recovery trigger is missing. Run install-autostart.ps1 again.')
}

if ($failures.Count -eq 0) {
  try {
    $healthUri = ([Uri]::new([Uri]$settings['CONTROL_PLANE_URL'], '/api/health')).AbsoluteUri
    $health = Invoke-RestMethod -Uri $healthUri -Method Get -TimeoutSec 15
    if ($health.ok -ne $true) { $failures.Add('The production health check did not return ok.') }
  } catch {
    $failures.Add("The production health check failed: $($_.Exception.Message)")
  }
}

Write-Host 'MatchPilot worker doctor'
Write-Host "Node: $(if (Test-Path -LiteralPath $nodeExecutable -PathType Leaf) { & $nodeExecutable --version } else { 'not found' })"
Write-Host "Scheduled task: $(if ($task) { $task.State } else { 'not found' })"
Write-Host "Private runtime: $runtimeRoot"
foreach ($warning in $warnings) { Write-Warning $warning }
foreach ($failure in $failures) { Write-Error $failure -ErrorAction Continue }

if ($failures.Count -gt 0) { exit 1 }
Write-Host 'No critical configuration errors found.'
exit 0
