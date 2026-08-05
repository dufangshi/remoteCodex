[CmdletBinding()]
param(
  [string]$TaskName = 'Remote Codex Relay Supervisor',
  [string]$PackageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$entry = Join-Path $PackageRoot 'bin\remote-codex.mjs'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
  throw "Remote Codex entrypoint was not found: $entry"
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument ('"{0}" relay-supervisor start' -f $entry) `
  -WorkingDirectory $PackageRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal `
  -UserId $identity `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 5 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Starts the current user Remote Codex Relay Supervisor after logon.' `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host 'Starting the relay supervisor now...'
& $node $entry relay-supervisor start
exit $LASTEXITCODE
