param()

$ErrorActionPreference = 'Stop'
$localApplicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localApplicationData)) { throw 'Windows LocalApplicationData is unavailable.' }
$runtimeRoot = Join-Path $localApplicationData 'MatchPilot'
$secureEnvironmentFile = Join-Path $runtimeRoot 'worker.env'
$legacyEnvironmentFile = Join-Path $PSScriptRoot '.env'
$legacyDataRoot = Join-Path $PSScriptRoot 'data'

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

if (Test-Path -LiteralPath $legacyEnvironmentFile -PathType Leaf) {
  Copy-Item -LiteralPath $legacyEnvironmentFile -Destination $secureEnvironmentFile -Force
  if ((Get-FileHash -LiteralPath $legacyEnvironmentFile -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $secureEnvironmentFile -Algorithm SHA256).Hash) {
    throw 'Worker settings copy verification failed.'
  }
  Remove-Item -LiteralPath $legacyEnvironmentFile -Force
}

$moves = @(
  @{ Source = Join-Path $legacyDataRoot 'chrome-profile'; Destination = Join-Path $runtimeRoot 'chrome-profile' },
  @{ Source = Join-Path $legacyDataRoot 'completed-jobs.json'; Destination = Join-Path $runtimeRoot 'completed-jobs.json' },
  @{ Source = Join-Path $legacyDataRoot 'worker.log'; Destination = Join-Path (Join-Path $runtimeRoot 'logs') 'worker.log' },
  @{ Source = Join-Path $legacyDataRoot 'logs'; Destination = Join-Path (Join-Path $runtimeRoot 'logs') 'legacy' }
)

foreach ($move in $moves) {
  if (-not (Test-Path -LiteralPath $move.Source)) { continue }
  $destinationParent = Split-Path -Parent $move.Destination
  New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
  if (Test-Path -LiteralPath $move.Destination) {
    Write-Warning "Skipped existing private runtime destination: $($move.Destination)"
    continue
  }
  Move-Item -LiteralPath $move.Source -Destination $move.Destination
}

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($currentIdentity)
$inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagation = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($currentIdentity, 'FullControl', $inheritance, $propagation, $allow)))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM', 'FullControl', $inheritance, $propagation, $allow)))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators', 'FullControl', $inheritance, $propagation, $allow)))
Set-Acl -LiteralPath $runtimeRoot -AclObject $acl

if (-not (Test-Path -LiteralPath $secureEnvironmentFile -PathType Leaf)) {
  throw 'Private worker settings were not found after migration.'
}

Write-Host "MatchPilot private runtime is ready: $runtimeRoot"
