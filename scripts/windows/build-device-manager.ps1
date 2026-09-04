[CmdletBinding()]
param(
  [string]$Configuration = 'Release',
  [string]$Runtime = 'win-x64',
  [string]$OutputPath = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path 'artifacts\windows-device-manager\win-x64'),
  [string]$BundledRemoteCodexBinary = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path 'target\release\remote-codex.exe')
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$projectPath = Join-Path $repositoryRoot 'apps\windows-device-manager\RemoteCodex.DeviceManager.csproj'
$BundledRemoteCodexBinary = [IO.Path]::GetFullPath($BundledRemoteCodexBinary)
if (-not $PSBoundParameters.ContainsKey('BundledRemoteCodexBinary')) {
  & cargo build --locked --release --package remote-codex --bin remote-codex
  if ($LASTEXITCODE -ne 0) {
    throw "The bundled Remote Codex CLI build failed with exit code $LASTEXITCODE."
  }
}
if (-not (Test-Path -LiteralPath $BundledRemoteCodexBinary -PathType Leaf)) {
  throw "The bundled Remote Codex CLI was not found: $BundledRemoteCodexBinary"
}
$expectedRuntimeVersion = (Get-Content (Join-Path $repositoryRoot 'package.json') | ConvertFrom-Json).version
$actualRuntimeVersion = (& $BundledRemoteCodexBinary version).Trim()
if ($LASTEXITCODE -ne 0 -or $actualRuntimeVersion -ne $expectedRuntimeVersion) {
  throw "Bundled Remote Codex CLI version mismatch: expected $expectedRuntimeVersion, got $actualRuntimeVersion"
}
$dotnet = (Get-Command dotnet.exe -ErrorAction SilentlyContinue)
if (-not $dotnet) {
  $dotnet = (Get-Command dotnet -ErrorAction Stop)
}

& $dotnet.Source publish $projectPath `
  --configuration $Configuration `
  --runtime $Runtime `
  --self-contained true `
  -p:PublishSingleFile=true `
  "-p:BundledRemoteCodexBinary=$BundledRemoteCodexBinary" `
  --output $OutputPath
if ($LASTEXITCODE -ne 0) {
  throw "dotnet publish failed with exit code $LASTEXITCODE."
}

$executable = Join-Path $OutputPath 'RemoteCodex.DeviceManager.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "Published executable was not found: $executable"
}

$validationProfile = Join-Path $OutputPath '.validation-profile'
$originalTestRoot = $env:REMOTE_CODEX_DEVICE_MANAGER_TEST_ROOT
try {
  New-Item -ItemType Directory -Force -Path $validationProfile | Out-Null
  $env:REMOTE_CODEX_DEVICE_MANAGER_TEST_ROOT = $validationProfile

  $selfTest = Start-Process -FilePath $executable -ArgumentList '--self-test' -Wait -PassThru
  if ($selfTest.ExitCode -ne 0) {
    $selfTestLog = Join-Path $validationProfile 'local-app-data\RemoteCodex\logs\device-manager.log'
    if (Test-Path -LiteralPath $selfTestLog -PathType Leaf) {
      Write-Host 'Self-test diagnostics:'
      Get-Content -LiteralPath $selfTestLog -Tail 50
    }
    throw "Remote Codex Device self-test failed with exit code $($selfTest.ExitCode)."
  }

  $nodeTest = Start-Process -FilePath $executable -ArgumentList '--node-self-test' -Wait -PassThru
  if ($nodeTest.ExitCode -ne 0) {
    $nodeTestLog = Join-Path $validationProfile 'local-app-data\RemoteCodex\logs\device-manager.log'
    if (Test-Path -LiteralPath $nodeTestLog -PathType Leaf) {
      Write-Host 'Node.js self-test diagnostics:'
      Get-Content -LiteralPath $nodeTestLog -Tail 80
    }
    throw "Remote Codex Node.js self-test failed with exit code $($nodeTest.ExitCode)."
  }

  $managedNode = Join-Path $validationProfile 'local-app-data\RemoteCodex\runtime\node-v22.23.2-win-x64\node.exe'
  if (-not (Test-Path -LiteralPath $managedNode -PathType Leaf)) {
    throw "Managed Node.js self-test output was not found: $managedNode"
  }
  $runtimeTest = Start-Process `
    -FilePath $executable `
    -ArgumentList @('--runtime-self-test', ('"{0}"' -f $managedNode)) `
    -Wait `
    -PassThru
  if ($runtimeTest.ExitCode -ne 0) {
    $runtimeTestLog = Join-Path $validationProfile 'local-app-data\RemoteCodex\logs\device-manager.log'
    if (Test-Path -LiteralPath $runtimeTestLog -PathType Leaf) {
      Write-Host 'Runtime self-test diagnostics:'
      Get-Content -LiteralPath $runtimeTestLog -Tail 80
    }
    throw "Remote Codex runtime self-test failed with exit code $($runtimeTest.ExitCode)."
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
}
finally {
  $env:REMOTE_CODEX_DEVICE_MANAGER_TEST_ROOT = $originalTestRoot
  if (Test-Path -LiteralPath $validationProfile) {
    Remove-Item -LiteralPath $validationProfile -Recurse -Force
  }
}

$hash = Get-FileHash -LiteralPath $executable -Algorithm SHA256
$hashLine = '{0}  {1}' -f $hash.Hash.ToLowerInvariant(), (Split-Path -Leaf $executable)
$hashPath = Join-Path $OutputPath 'RemoteCodex.DeviceManager.exe.sha256'
[IO.File]::WriteAllText($hashPath, "$hashLine`n", [Text.UTF8Encoding]::new($false))

Write-Host "Built: $executable"
Write-Host "SHA-256: $($hash.Hash.ToLowerInvariant())"
