$ErrorActionPreference = 'Stop'

$PackageRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$SmokeScript = Join-Path $PackageRoot 'scripts\verify-relay-supervisor-smoke.mjs'
$Node = (Get-Command node.exe -ErrorAction Stop).Source

Push-Location $PackageRoot
try {
  & $Node $SmokeScript
  if ($LASTEXITCODE -ne 0) {
    throw "Relay smoke test exited with code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}
