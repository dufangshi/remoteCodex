[CmdletBinding()]
param(
  [string]$TaskName = 'Remote Codex Relay Supervisor',
  [switch]$PurgeData,
  [string]$PackageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$entry = Join-Path $PackageRoot 'bin\remote-codex.mjs'

if (Test-Path -LiteralPath $entry -PathType Leaf) {
  & $node $entry relay-supervisor stop
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed scheduled task: $TaskName"

if ($PurgeData) {
  $dataDirectory = Join-Path $env:USERPROFILE '.remote-codex'
  if (Test-Path -LiteralPath $dataDirectory -PathType Container) {
    Remove-Item -LiteralPath $dataDirectory -Recurse -Force
    Write-Host "Removed data directory: $dataDirectory"
  }
} else {
  Write-Host 'Configuration, logs, and databases were preserved under %USERPROFILE%\.remote-codex.'
}
