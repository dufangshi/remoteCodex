using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using RemoteCodex.DeviceManager.Infrastructure;
using RemoteCodex.DeviceManager.Models;

namespace RemoteCodex.DeviceManager.Services;

internal sealed class RuntimeProvisioner
{
    private sealed record RemoteCodexRuntime(
        string EntryPath,
        string Version,
        string CodexCommandPath,
        string? NativeBinaryPath);

    private const string BundledLauncherResource =
        "RemoteCodex.DeviceManager.BundledRuntime.remote-codex.mjs";
    private const string BundledPackageResource =
        "RemoteCodex.DeviceManager.BundledRuntime.package.json";
    private const string BundledNativeResource =
        "RemoteCodex.DeviceManager.BundledRuntime.remote-codex.exe";

    private readonly AppLogger _logger;
    private readonly ProcessRunner _runner;
    private readonly HttpClient _httpClient;

    public RuntimeProvisioner(AppLogger logger, ProcessRunner runner)
    {
        _logger = logger;
        _runner = runner;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("RemoteCodex-DeviceManager/0.1");
    }

    public async Task<RuntimeState> EnsureAsync(
        IProgress<ProvisioningProgress> progress,
        Func<Task<bool>> confirmCodexLogin,
        CancellationToken cancellationToken)
    {
        AppPaths.EnsureDirectories();
        var nodePath = await EnsureNodeAsync(progress, cancellationToken);
        var remoteCodex = await EnsureRemoteCodexAsync(nodePath, progress, cancellationToken);
        await EnsureCodexLoginAsync(
            remoteCodex.CodexCommandPath,
            progress,
            confirmCodexLogin,
            cancellationToken);

        var state = new RuntimeState(
            nodePath,
            remoteCodex.EntryPath,
            remoteCodex.CodexCommandPath,
            DateTimeOffset.UtcNow,
            remoteCodex.Version,
            remoteCodex.NativeBinaryPath);
        state.Save();
        progress.Report(new("Ready", "All runtime checks passed.", ProvisioningStepState.Complete, 100));
        return state;
    }

    public async Task<string> GetLatestRemoteCodexVersionAsync(CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(ProductManifest.RemoteCodexLatestMetadataUri, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var content = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var metadata = await JsonDocument.ParseAsync(content, cancellationToken: cancellationToken);
        if (!metadata.RootElement.TryGetProperty("version", out var versionElement)
            || versionElement.GetString() is not { Length: > 0 } version
            || !TryParseVersion(version, out _))
        {
            throw new InvalidOperationException("The npm registry returned an invalid Remote Codex version.");
        }
        return version;
    }

    public async Task<RuntimeState?> TryRecoverBundledRuntimeAsync(
        CancellationToken cancellationToken)
    {
        var nodePath = Path.Combine(
            AppPaths.RuntimeRoot,
            $"node-v{ProductManifest.NodeVersion}-win-x64",
            "node.exe");
        if (!await IsCompatibleNodeAsync(nodePath, cancellationToken))
        {
            return null;
        }
        var prefix = Path.Combine(
            AppPaths.AppRoot,
            $"remote-codex-{ProductManifest.RemoteCodexVersion}");
        var entryPath = Path.Combine(
            prefix,
            "node_modules",
            "remote-codex",
            "bin",
            "remote-codex.mjs");
        var nativeBinaryPath = Path.Combine(prefix, "remote-codex-native.exe");
        var codexCommandPath = Path.Combine(prefix, "codex.cmd");
        if (!await BundledNativeMatchesAsync(nativeBinaryPath, cancellationToken)
            || !await IsExpectedRemoteCodexAsync(
                nodePath,
                entryPath,
                ProductManifest.RemoteCodexVersion,
                cancellationToken))
        {
            return null;
        }
        var recovered = new RuntimeState(
            nodePath,
            entryPath,
            codexCommandPath,
            DateTimeOffset.UtcNow,
            ProductManifest.RemoteCodexVersion,
            nativeBinaryPath);
        recovered.Save();
        return recovered;
    }

    public async Task<RuntimeState> UpdateRemoteCodexAsync(
        RuntimeState runtime,
        string version,
        IProgress<ProvisioningProgress> progress,
        CancellationToken cancellationToken)
    {
        if (!TryParseVersion(version, out _))
        {
            throw new ArgumentException("The requested Remote Codex version is invalid.", nameof(version));
        }

        var remoteCodex = await EnsureRemoteCodexVersionAsync(
            runtime.NodePath,
            version,
            progress,
            cancellationToken);
        var updated = runtime with
        {
            RemoteCodexEntryPath = remoteCodex.EntryPath,
            RemoteCodexVersion = remoteCodex.Version,
            CodexCommandPath = remoteCodex.CodexCommandPath,
            NativeBinaryPath = remoteCodex.NativeBinaryPath,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        updated.Save();
        return updated;
    }

    public static bool IsNewerVersion(string candidate, string current)
    {
        return TryParseVersion(candidate, out var candidateVersion)
            && TryParseVersion(current, out var currentVersion)
            && candidateVersion > currentVersion;
    }

    internal static IReadOnlyList<string> ManagedPackageSpecs(string remoteCodexVersion) =>
    [
        $"remote-codex@{remoteCodexVersion}",
        $"@agentclientprotocol/codex-acp@{ProductManifest.CodexAcpVersion}",
        $"@openai/codex@{ProductManifest.CodexVersion}",
    ];

    internal async Task<RuntimeState> ProvisionBundledRuntimeForTestAsync(
        string nodePath,
        CancellationToken cancellationToken)
    {
        var remoteCodex = await EnsureRemoteCodexVersionAsync(
            nodePath,
            ProductManifest.RemoteCodexVersion,
            new Progress<ProvisioningProgress>(),
            cancellationToken);
        return new RuntimeState(
            nodePath,
            remoteCodex.EntryPath,
            remoteCodex.CodexCommandPath,
            DateTimeOffset.UtcNow,
            remoteCodex.Version,
            remoteCodex.NativeBinaryPath);
    }

    internal Task<string> ProvisionNodeForTestAsync(CancellationToken cancellationToken) =>
        EnsureNodeAsync(new Progress<ProvisioningProgress>(), cancellationToken);

    private async Task<string> EnsureNodeAsync(
        IProgress<ProvisioningProgress> progress,
        CancellationToken cancellationToken)
    {
        progress.Report(new("Node.js", "Checking for a compatible Node.js 22 runtime...", ProvisioningStepState.Running, 8));

        var privateNodePath = Path.Combine(
            AppPaths.RuntimeRoot,
            $"node-v{ProductManifest.NodeVersion}-win-x64",
            "node.exe");
        var candidates = new List<string>();
        if (File.Exists(privateNodePath))
        {
            candidates.Add(privateNodePath);
        }
        candidates.AddRange(await LocateCommandsAsync("node.exe", cancellationToken));

        foreach (var candidate in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (await IsCompatibleNodeAsync(candidate, cancellationToken))
            {
                progress.Report(new("Node.js", $"Using Node.js 22 from {candidate}", ProvisioningStepState.Complete, 18));
                return candidate;
            }
        }

        progress.Report(new("Node.js", $"Installing a private Node.js {ProductManifest.NodeVersion} runtime...", ProvisioningStepState.Running, 12));
        await InstallPrivateNodeAsync(privateNodePath, progress, cancellationToken);
        if (!await IsCompatibleNodeAsync(privateNodePath, cancellationToken))
        {
            throw new InvalidOperationException("The private Node.js runtime failed verification after installation.");
        }

        progress.Report(new("Node.js", $"Installed private Node.js {ProductManifest.NodeVersion}.", ProvisioningStepState.Complete, 18));
        return privateNodePath;
    }

    private async Task<bool> IsCompatibleNodeAsync(string nodePath, CancellationToken cancellationToken)
    {
        if (!File.Exists(nodePath))
        {
            return false;
        }

        try
        {
            var version = await _runner.RunAsync(
                nodePath,
                ["--version"],
                TimeSpan.FromSeconds(5),
                cancellationToken: cancellationToken);
            var architecture = await _runner.RunAsync(
                nodePath,
                ["-p", "process.arch"],
                TimeSpan.FromSeconds(5),
                cancellationToken: cancellationToken);
            var npmCliPath = NpmCliPathFor(nodePath);
            return version.Success
                && version.StandardOutput.TrimStart().StartsWith("v22.", StringComparison.Ordinal)
                && architecture.Success
                && architecture.StandardOutput.Trim().Equals("x64", StringComparison.OrdinalIgnoreCase)
                && File.Exists(npmCliPath);
        }
        catch (Exception exception)
        {
            _logger.Warning($"Node.js candidate failed validation: {exception.Message}");
            return false;
        }
    }

    private async Task InstallPrivateNodeAsync(
        string expectedNodePath,
        IProgress<ProvisioningProgress> progress,
        CancellationToken cancellationToken)
    {
        var archivePath = Path.Combine(AppPaths.DownloadsRoot, ProductManifest.NodeArchiveName);
        if (!File.Exists(archivePath) || !await HasExpectedSha256Async(archivePath, ProductManifest.NodeArchiveSha256, cancellationToken))
        {
            var partialPath = $"{archivePath}.partial";
            File.Delete(partialPath);
            await DownloadAsync(ProductManifest.NodeArchiveUri, partialPath, progress, 12, 16, cancellationToken);
            if (!await HasExpectedSha256Async(partialPath, ProductManifest.NodeArchiveSha256, cancellationToken))
            {
                File.Delete(partialPath);
                throw new InvalidDataException("The Node.js download failed SHA-256 verification.");
            }
            File.Move(partialPath, archivePath, overwrite: true);
        }

        var archiveDirectoryName = Path.GetFileNameWithoutExtension(ProductManifest.NodeArchiveName);
        var destinationDirectory = Path.GetDirectoryName(expectedNodePath)!;
        var stagingRoot = Path.Combine(AppPaths.RuntimeRoot, $".node-staging-{Environment.ProcessId}");
        if (Directory.Exists(stagingRoot))
        {
            Directory.Delete(stagingRoot, recursive: true);
        }

        try
        {
            ZipFile.ExtractToDirectory(archivePath, stagingRoot);
            var extractedDirectory = Path.Combine(stagingRoot, archiveDirectoryName);
            if (!File.Exists(Path.Combine(extractedDirectory, "node.exe")))
            {
                throw new InvalidDataException("The Node.js archive did not contain node.exe.");
            }

            if (Directory.Exists(destinationDirectory))
            {
                Directory.Delete(destinationDirectory, recursive: true);
            }
            Directory.Move(extractedDirectory, destinationDirectory);
        }
        finally
        {
            if (Directory.Exists(stagingRoot))
            {
                Directory.Delete(stagingRoot, recursive: true);
            }
        }
    }

    private async Task EnsureCodexLoginAsync(
        string codexPath,
        IProgress<ProvisioningProgress> progress,
        Func<Task<bool>> confirmCodexLogin,
        CancellationToken cancellationToken)
    {
        progress.Report(new("Codex account", "Checking Codex sign-in status...", ProvisioningStepState.Running, 40));
        var status = await _runner.RunAsync(
            codexPath,
            ["login", "status"],
            TimeSpan.FromSeconds(20),
            cancellationToken: cancellationToken);
        if (status.Success)
        {
            progress.Report(new("Codex account", "Codex is signed in.", ProvisioningStepState.Complete, 48));
            return;
        }

        progress.Report(new("Codex account", "Sign in is required in a temporary terminal window.", ProvisioningStepState.NeedsAction, 42));
        if (!await confirmCodexLogin())
        {
            throw new OperationCanceledException("Codex sign-in was cancelled.", cancellationToken);
        }

        var exitCode = await _runner.RunInteractiveAsync(codexPath, ["login"], cancellationToken);
        if (exitCode != 0)
        {
            throw new InvalidOperationException("Codex sign-in did not complete successfully.");
        }

        status = await _runner.RunAsync(
            codexPath,
            ["login", "status"],
            TimeSpan.FromSeconds(20),
            cancellationToken: cancellationToken);
        if (!status.Success)
        {
            throw new InvalidOperationException("Codex still reports that this Windows user is signed out.");
        }

        progress.Report(new("Codex account", "Codex sign-in completed.", ProvisioningStepState.Complete, 48));
    }

    private async Task<RemoteCodexRuntime> EnsureRemoteCodexAsync(
        string nodePath,
        IProgress<ProvisioningProgress> progress,
        CancellationToken cancellationToken)
    {
        progress.Report(new("Remote Codex", "Checking the managed Remote Codex runtime...", ProvisioningStepState.Running, 56));
        var savedState = RuntimeState.Load(_logger);
        if (savedState?.IsUsable == true
            && !string.IsNullOrWhiteSpace(savedState.RemoteCodexVersion)
            && !IsNewerVersion(ProductManifest.RemoteCodexVersion, savedState.RemoteCodexVersion)
            && await IsExpectedRemoteCodexAsync(
                nodePath,
                savedState.RemoteCodexEntryPath,
                savedState.RemoteCodexVersion,
                cancellationToken))
        {
            progress.Report(new(
                "Remote Codex",
                $"Remote Codex {savedState.RemoteCodexVersion} is ready.",
                ProvisioningStepState.Complete,
                76));
            return new RemoteCodexRuntime(
                savedState.RemoteCodexEntryPath,
                savedState.RemoteCodexVersion,
                savedState.CodexCommandPath,
                savedState.NativeBinaryPath);
        }

        return await EnsureRemoteCodexVersionAsync(
            nodePath,
            ProductManifest.RemoteCodexVersion,
            progress,
            cancellationToken);
    }

    private async Task<RemoteCodexRuntime> EnsureRemoteCodexVersionAsync(
        string nodePath,
        string version,
        IProgress<ProvisioningProgress> progress,
        CancellationToken cancellationToken)
    {
        var prefix = Path.Combine(AppPaths.AppRoot, $"remote-codex-{version}");
        var entryPath = Path.Combine(prefix, "node_modules", "remote-codex", "bin", "remote-codex.mjs");
        var codexCommandPath = Path.Combine(prefix, "codex.cmd");
        var bundled = string.Equals(version, ProductManifest.RemoteCodexVersion, StringComparison.Ordinal);
        var nativeBinaryPath = bundled
            ? Path.Combine(prefix, "remote-codex-native.exe")
            : null;
        if (File.Exists(codexCommandPath)
            && (!bundled || await BundledNativeMatchesAsync(nativeBinaryPath!, cancellationToken))
            && await IsExpectedRemoteCodexAsync(nodePath, entryPath, version, cancellationToken))
        {
            progress.Report(new("Remote Codex", $"Remote Codex {version} is ready.", ProvisioningStepState.Complete, 76));
            return new RemoteCodexRuntime(entryPath, version, codexCommandPath, nativeBinaryPath);
        }

        progress.Report(new("Remote Codex", $"Installing Remote Codex {version} privately...", ProvisioningStepState.Running, 62));
        var npmCliPath = NpmCliPathFor(nodePath);
        if (!File.Exists(npmCliPath))
        {
            throw new FileNotFoundException("npm-cli.js was not found beside the selected Node.js runtime.", npmCliPath);
        }

        var stagingPrefix = Path.Combine(AppPaths.AppRoot, $".remote-codex-staging-{Environment.ProcessId}");
        if (Directory.Exists(stagingPrefix))
        {
            Directory.Delete(stagingPrefix, recursive: true);
        }

        try
        {
            Directory.CreateDirectory(stagingPrefix);
            if (bundled)
            {
                await ExtractBundledRemoteCodexAsync(stagingPrefix, cancellationToken);
            }
            var packageSpecs = bundled
                ? [
                    $"@agentclientprotocol/codex-acp@{ProductManifest.CodexAcpVersion}",
                    $"@openai/codex@{ProductManifest.CodexVersion}",
                ]
                : ManagedPackageSpecs(version);
            var install = await _runner.RunAsync(
                nodePath,
                [
                    npmCliPath,
                    "install",
                    "--global",
                    "--prefix",
                    stagingPrefix,
                    .. packageSpecs,
                    "--no-audit",
                    "--no-fund",
                    "--loglevel=error",
                ],
                TimeSpan.FromMinutes(15),
                environment: BuildNodeEnvironment(nodePath),
                cancellationToken: cancellationToken);
            var stagedEntry = Path.Combine(stagingPrefix, "node_modules", "remote-codex", "bin", "remote-codex.mjs");
            var stagedNative = bundled
                ? Path.Combine(stagingPrefix, "remote-codex-native.exe")
                : null;
            var nativeReady = !bundled
                || await BundledNativeMatchesAsync(stagedNative!, cancellationToken);
            var runtimeReady = await IsExpectedRemoteCodexAsync(
                nodePath,
                stagedEntry,
                version,
                cancellationToken);
            if (!install.Success || !nativeReady || !runtimeReady)
            {
                throw new InvalidOperationException(
                    $"Remote Codex installation failed (npm={install.Success}, native={nativeReady}, runtime={runtimeReady}). {install.CombinedOutput}".Trim());
            }

            if (Directory.Exists(prefix))
            {
                Directory.Delete(prefix, recursive: true);
            }
            Directory.Move(stagingPrefix, prefix);
        }
        finally
        {
            if (Directory.Exists(stagingPrefix))
            {
                Directory.Delete(stagingPrefix, recursive: true);
            }
        }

        if (!await IsExpectedRemoteCodexAsync(nodePath, entryPath, version, cancellationToken))
        {
            throw new InvalidOperationException("Remote Codex failed verification after installation.");
        }

        progress.Report(new("Remote Codex", $"Remote Codex {version} installed.", ProvisioningStepState.Complete, 76));
        return new RemoteCodexRuntime(entryPath, version, codexCommandPath, nativeBinaryPath);
    }

    private static async Task ExtractBundledRemoteCodexAsync(
        string prefix,
        CancellationToken cancellationToken)
    {
        var packageRoot = Path.Combine(prefix, "node_modules", "remote-codex");
        await ExtractResourceAsync(
            BundledLauncherResource,
            Path.Combine(packageRoot, "bin", "remote-codex.mjs"),
            cancellationToken);
        await ExtractResourceAsync(
            BundledPackageResource,
            Path.Combine(packageRoot, "package.json"),
            cancellationToken);
        await ExtractResourceAsync(
            BundledNativeResource,
            Path.Combine(prefix, "remote-codex-native.exe"),
            cancellationToken);
    }

    private static async Task<bool> BundledNativeMatchesAsync(
        string path,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
        {
            return false;
        }
        await using var expected = Assembly.GetExecutingAssembly().GetManifestResourceStream(
            BundledNativeResource);
        if (expected is null)
        {
            return false;
        }
        await using var actual = File.OpenRead(path);
        var expectedHash = await SHA256.HashDataAsync(expected, cancellationToken);
        var actualHash = await SHA256.HashDataAsync(actual, cancellationToken);
        return CryptographicOperations.FixedTimeEquals(expectedHash, actualHash);
    }

    private static async Task ExtractResourceAsync(
        string resourceName,
        string destination,
        CancellationToken cancellationToken)
    {
        await using var source = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Bundled runtime resource is missing: {resourceName}");
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        await using var output = new FileStream(
            destination,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            128 * 1024,
            useAsync: true);
        await source.CopyToAsync(output, cancellationToken);
        await output.FlushAsync(cancellationToken);
    }

    private async Task<bool> IsExpectedRemoteCodexAsync(
        string nodePath,
        string entryPath,
        string expectedVersion,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(entryPath))
        {
            return false;
        }

        try
        {
            var version = await _runner.RunAsync(
                nodePath,
                [entryPath, "--version"],
                TimeSpan.FromSeconds(30),
                cancellationToken: cancellationToken);
            if (!version.Success || !version.StandardOutput.Trim().Equals(expectedVersion, StringComparison.Ordinal))
            {
                return false;
            }

            var prefix = new FileInfo(entryPath)
                .Directory?
                .Parent?
                .Parent?
                .Parent?
                .FullName;
            if (prefix is null)
            {
                return false;
            }

            var acpCommandPath = Path.Combine(prefix, "codex-acp.cmd");
            var codexCommandPath = Path.Combine(prefix, "codex.cmd");
            if (!File.Exists(acpCommandPath) || !File.Exists(codexCommandPath))
            {
                _logger.Warning(
                    $"Managed command shims are incomplete. codex-acp={File.Exists(acpCommandPath)}, codex={File.Exists(codexCommandPath)}, prefix={prefix}");
                return false;
            }
            var adapter = await _runner.RunAsync(
                acpCommandPath,
                ["--version"],
                TimeSpan.FromSeconds(30),
                environment: BuildNodeEnvironment(nodePath),
                cancellationToken: cancellationToken);
            var codex = await _runner.RunAsync(
                codexCommandPath,
                ["--version"],
                TimeSpan.FromSeconds(30),
                environment: BuildNodeEnvironment(nodePath),
                cancellationToken: cancellationToken);
            return adapter.Success
                && adapter.StandardOutput.Contains(
                    ProductManifest.CodexAcpVersion,
                    StringComparison.Ordinal)
                && codex.Success
                && codex.StandardOutput.Contains("codex", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static bool TryParseVersion(string value, out Version version)
    {
        var coreVersion = value.Split('-', 2, StringSplitOptions.TrimEntries)[0];
        return Version.TryParse(coreVersion, out version!);
    }

    private static IReadOnlyDictionary<string, string?> BuildNodeEnvironment(string nodePath)
    {
        var nodeDirectory = Path.GetDirectoryName(nodePath)
            ?? throw new InvalidOperationException("The selected Node.js path has no parent directory.");
        var currentPath = Environment.GetEnvironmentVariable("PATH");
        return new Dictionary<string, string?>
        {
            ["PATH"] = string.IsNullOrWhiteSpace(currentPath)
                ? nodeDirectory
                : $"{nodeDirectory}{Path.PathSeparator}{currentPath}",
        };
    }

    private async Task<IReadOnlyList<string>> LocateCommandsAsync(
        string command,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await _runner.RunAsync(
                "where.exe",
                [command],
                TimeSpan.FromSeconds(5),
                cancellationToken: cancellationToken);
            return result.Success
                ? result.StandardOutput.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                : [];
        }
        catch
        {
            return [];
        }
    }

    private async Task DownloadAsync(
        Uri uri,
        string destinationPath,
        IProgress<ProvisioningProgress> progress,
        int progressStart,
        int progressEnd,
        CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        var totalBytes = response.Content.Headers.ContentLength;
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var destination = new FileStream(destinationPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 128 * 1024, useAsync: true);
        var buffer = new byte[128 * 1024];
        long receivedBytes = 0;
        while (true)
        {
            var bytesRead = await source.ReadAsync(buffer, cancellationToken);
            if (bytesRead == 0)
            {
                break;
            }
            await destination.WriteAsync(buffer.AsMemory(0, bytesRead), cancellationToken);
            receivedBytes += bytesRead;
            if (totalBytes is > 0)
            {
                var percent = Math.Clamp(
                    progressStart + (int)(receivedBytes * (progressEnd - progressStart) / totalBytes.Value),
                    progressStart,
                    progressEnd);
                progress.Report(new("Download", $"Downloading {Path.GetFileName(destinationPath).Replace(".partial", string.Empty)}...", ProvisioningStepState.Running, percent));
            }
        }
    }

    private static async Task<bool> HasExpectedSha256Async(
        string path,
        string expectedHash,
        CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).Equals(expectedHash, StringComparison.OrdinalIgnoreCase);
    }

    private static string NpmCliPathFor(string nodePath)
        => Path.Combine(Path.GetDirectoryName(nodePath)!, "node_modules", "npm", "bin", "npm-cli.js");

}
