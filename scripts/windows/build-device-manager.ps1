[CmdletBinding()]
param(
  [string]$Configuration = 'Release',
  [string]$Runtime = 'win-x64',
  [string]$OutputPath = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path 'artifacts\windows-device-manager\win-x64')
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$projectPath = Join-Path $repositoryRoot 'apps\windows-device-manager\RemoteCodex.DeviceManager.csproj'
$productManifestPath = Join-Path $repositoryRoot 'apps\windows-device-manager\ProductManifest.cs'
$dotnet = (Get-Command dotnet.exe -ErrorAction SilentlyContinue)
if (-not $dotnet) {
  $dotnet = (Get-Command dotnet -ErrorAction Stop)
}

$packageVersion = (Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json).version
$productManifest = Get-Content -LiteralPath $productManifestPath -Raw
if ($productManifest -notmatch ('RemoteCodexVersion\s*=\s*"{0}"' -f [Regex]::Escape($packageVersion))) {
  throw "ProductManifest.RemoteCodexVersion must match package.json version $packageVersion."
}

& $dotnet.Source publish $projectPath `
  --configuration $Configuration `
  --runtime $Runtime `
  --self-contained true `
  -p:PublishSingleFile=true `
  --output $OutputPath
if ($LASTEXITCODE -ne 0) {
  throw "dotnet publish failed with exit code $LASTEXITCODE."
}

$executable = Join-Path $OutputPath 'RemoteCodex.DeviceManager.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "Published executable was not found: $executable"
}

$selfTest = Start-Process -FilePath $executable -ArgumentList '--self-test' -Wait -PassThru
if ($selfTest.ExitCode -ne 0) {
  $selfTestLog = Join-Path $env:LOCALAPPDATA 'RemoteCodex\logs\device-manager.log'
  if (Test-Path -LiteralPath $selfTestLog -PathType Leaf) {
    Write-Host 'Self-test diagnostics:'
    Get-Content -LiteralPath $selfTestLog -Tail 50
  }
  throw "Remote Codex Device self-test failed with exit code $($selfTest.ExitCode)."
}

$previewPath = Join-Path $OutputPath 'RemoteCodex.DeviceManager.preview.png'
$previewTest = Start-Process `
  -FilePath $executable `
  -ArgumentList @('--render-preview', ('"{0}"' -f $previewPath)) `
  -Wait `
  -PassThru
if ($previewTest.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $previewPath -PathType Leaf)) {
  throw "Remote Codex Device preview render failed with exit code $($previewTest.ExitCode)."
}

$hash = Get-FileHash -LiteralPath $executable -Algorithm SHA256
$hashLine = '{0}  {1}' -f $hash.Hash.ToLowerInvariant(), (Split-Path -Leaf $executable)
$hashPath = Join-Path $OutputPath 'RemoteCodex.DeviceManager.exe.sha256'
[IO.File]::WriteAllText($hashPath, "$hashLine`n", [Text.UTF8Encoding]::new($false))

Write-Host "Built: $executable"
Write-Host "SHA-256: $($hash.Hash.ToLowerInvariant())"
