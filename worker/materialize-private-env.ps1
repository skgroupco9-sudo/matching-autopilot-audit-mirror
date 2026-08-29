param(
  [Parameter(Mandatory = $true)]
  [string]$ProtectedPayload
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$localApplicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localApplicationData)) { throw 'Windows LocalApplicationData is unavailable.' }
$runtimeRoot = Join-Path $localApplicationData 'MatchPilot'
$environmentFile = Join-Path $runtimeRoot 'worker.env'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$logDirectory = Join-Path $runtimeRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$migrationLog = Join-Path $logDirectory 'private-env-migration.log'
trap {
  Add-Content -LiteralPath $migrationLog -Value "$((Get-Date).ToUniversalTime().ToString('o')) failed: $($_.Exception.Message)"
  exit 1
}
Add-Content -LiteralPath $migrationLog -Value "$((Get-Date).ToUniversalTime().ToString('o')) started"

$protectedBytes = [Convert]::FromBase64String($ProtectedPayload)
$plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $protectedBytes,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[System.IO.File]::WriteAllBytes($environmentFile, $plainBytes)
[Array]::Clear($plainBytes, 0, $plainBytes.Length)

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($currentIdentity)
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($currentIdentity, 'FullControl', $allow)))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM', 'FullControl', $allow)))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators', 'FullControl', $allow)))
Set-Acl -LiteralPath $environmentFile -AclObject $acl
Add-Content -LiteralPath $migrationLog -Value "$((Get-Date).ToUniversalTime().ToString('o')) completed"

Write-Host 'MatchPilot private worker settings were materialized for the Windows task.'
