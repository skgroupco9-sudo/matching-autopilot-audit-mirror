param(
  [switch]$LogToFile
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$localApplicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localApplicationData)) { throw 'Windows LocalApplicationData is unavailable.' }
$runtimeRoot = Join-Path $localApplicationData 'MatchPilot'
$launcherLogDirectory = Join-Path $runtimeRoot 'logs'
New-Item -ItemType Directory -Path $launcherLogDirectory -Force | Out-Null
$launcherLog = Join-Path $launcherLogDirectory 'launcher.log'
$runtimeEntries = @(Get-ChildItem -LiteralPath $runtimeRoot -Force -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ','
$identitySid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
Add-Content -LiteralPath $launcherLog -Value "$((Get-Date).ToUniversalTime().ToString('o')) launcher started for $([Environment]::UserName) ($identitySid) at $runtimeRoot; entries=$runtimeEntries"
trap {
  Add-Content -LiteralPath $launcherLog -Value "$((Get-Date).ToUniversalTime().ToString('o')) launcher failed: $($_.Exception.Message)"
  exit 1
}
$secureEnvironmentFile = Join-Path $runtimeRoot 'worker.env'
$legacyEnvironmentFile = Join-Path $PSScriptRoot '.env'
$environmentFile = if (Test-Path -LiteralPath $secureEnvironmentFile -PathType Leaf) { $secureEnvironmentFile } else { $legacyEnvironmentFile }
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
  throw "MatchPilot worker settings are missing. Checked $secureEnvironmentFile and $legacyEnvironmentFile."
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath $environmentFile) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $name, $value = $line -split '=', 2
  $settings[$name.Trim()] = $value.Trim()
}

foreach ($requiredName in @('CONTROL_PLANE_URL', 'WORKER_SHARED_SECRET', 'WORKER_BINDING_TOKEN', 'WORKER_USER_ID', 'CHROME_EXECUTABLE_PATH')) {
  if ([string]::IsNullOrWhiteSpace($settings[$requiredName])) {
    throw "Set $requiredName in worker/.env."
  }
}

if ([string]::IsNullOrWhiteSpace($settings['OPENAI_API_KEY'])) {
  Write-Warning 'No local OPENAI_API_KEY. The worker will use the encrypted Web setting when configured.'
}

if (-not [Uri]::IsWellFormedUriString($settings['CONTROL_PLANE_URL'], [UriKind]::Absolute)) {
  throw 'CONTROL_PLANE_URL must be an absolute production URL.'
}
if (-not (Test-Path -LiteralPath $settings['CHROME_EXECUTABLE_PATH'] -PathType Leaf)) {
  throw 'CHROME_EXECUTABLE_PATH does not point to a Chrome executable.'
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) { throw 'Install Node.js 22 or later.' }
$nodeMajor = [int]((& $nodeExecutable --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'Node.js 22 or later is required.' }

$dataDirectory = Join-Path $runtimeRoot 'chrome-profile'
$logDirectory = Join-Path $runtimeRoot 'logs'
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$env:WORKER_DATA_DIR = $dataDirectory

if ($LogToFile) {
  $logFile = Join-Path $logDirectory 'worker.log'
  while ($true) {
    & $nodeExecutable "--env-file=$environmentFile" src/index.mjs *>> $logFile
    $workerExitCode = $LASTEXITCODE
    $timestamp = (Get-Date).ToUniversalTime().ToString('o')
    Add-Content -LiteralPath $logFile -Value "$timestamp worker exited with code $workerExitCode; restarting in 10 seconds"
    Start-Sleep -Seconds 10
  }
} else {
  & $nodeExecutable "--env-file=$environmentFile" src/index.mjs
}
exit $LASTEXITCODE
