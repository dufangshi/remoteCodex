using System.IO.Compression;
using System.Security.Cryptography;
using RemoteCodex.DeviceManager.Infrastructure;
using RemoteCodex.DeviceManager.Models;

namespace RemoteCodex.DeviceManager.Services;

internal sealed class RuntimeProvisioner
{
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
        var codexPath = await EnsureCodexAsync(progress, cancellationToken);
        await EnsureCodexLoginAsync(codexPath, progress, confirmCodexLogin, cancellationToken);
        var remoteCodexEntry = await EnsureRemoteCodexAsync(nodePath, progress, cancellationToken);

        var state = new RuntimeState(nodePath, remoteCodexEntry, codexPath, DateTimeOffset.UtcNow);
        state.Save();
        progress.Report(new("Ready", "All runtime checks passed.", ProvisioningStepState.Complete, 100));
        return state;
    }

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

    private async Task<string> EnsureCodexAsync(
        IProgress<ProvisioningProgress> progress,
        CancellationToken cancellationToken)
    {
        progress.Report(new("Codex", "Checking the Codex CLI...", ProvisioningStepState.Running, 24));
        var existing = await FindWorkingCodexAsync(cancellationToken);
        if (existing is not null)
        {
            progress.Report(new("Codex", $"Using Codex from {existing}", ProvisioningStepState.Complete, 34));
            return existing;
        }

        progress.Report(new("Codex", "Installing Codex with the official OpenAI installer...", ProvisioningStepState.Running, 28));
        var installerPath = Path.Combine(AppPaths.DownloadsRoot, "install-codex.ps1");
        var partialPath = $"{installerPath}.partial";
        File.Delete(partialPath);
        await DownloadAsync(ProductManifest.CodexInstallerUri, partialPath, progress, 28, 32, cancellationToken);
        File.Move(partialPath, installerPath, overwrite: true);

        var install = await _runner.RunAsync(
            "powershell.exe",
            ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installerPath],
            TimeSpan.FromMinutes(10),
            cancellationToken: cancellationToken);
        if (!install.Success)
        {
            throw new InvalidOperationException($"The official Codex installer failed. {install.CombinedOutput}".Trim());
        }

        RefreshProcessPath();
        var installed = await FindWorkingCodexAsync(cancellationToken);
        if (installed is null)
        {
            throw new InvalidOperationException("Codex was installed, but codex --version could not be executed.");
        }

        progress.Report(new("Codex", "Codex installed and verified.", ProvisioningStepState.Complete, 34));
        return installed;
    }

    private async Task<string?> FindWorkingCodexAsync(CancellationToken cancellationToken)
    {
        var candidates = new List<string>();
        candidates.AddRange(await LocateCommandsAsync("codex.exe", cancellationToken));
        candidates.AddRange(await LocateCommandsAsync("codex.cmd", cancellationToken));
        candidates.Add(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "OpenAI", "Codex", "bin", "codex.exe"));

        foreach (var candidate in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!File.Exists(candidate))
            {
                continue;
            }

            try
            {
                var version = await _runner.RunAsync(
                    candidate,
                    ["--version"],
                    TimeSpan.FromSeconds(10),
                    cancellationToken: cancellationToken);
                if (version.Success)
                {
                    return candidate;
                }
            }
            catch (Exception exception)
            {
                _logger.Warning($"Codex candidate failed validation: {exception.Message}");
            }
        }

        return null;
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

    private async Task<string> EnsureRemoteCodexAsync(
        string nodePath,
        IProgress<ProvisioningProgress> progress,
        CancellationToken cancellationToken)
    {
        progress.Report(new("Remote Codex", "Checking the managed Remote Codex runtime...", ProvisioningStepState.Running, 56));
        var prefix = Path.Combine(AppPaths.AppRoot, $"remote-codex-{ProductManifest.RemoteCodexVersion}");
        var entryPath = Path.Combine(prefix, "node_modules", "remote-codex", "bin", "remote-codex.mjs");
        if (await IsExpectedRemoteCodexAsync(nodePath, entryPath, cancellationToken))
        {
            progress.Report(new("Remote Codex", $"Remote Codex {ProductManifest.RemoteCodexVersion} is ready.", ProvisioningStepState.Complete, 76));
            return entryPath;
        }

        progress.Report(new("Remote Codex", $"Installing Remote Codex {ProductManifest.RemoteCodexVersion} privately...", ProvisioningStepState.Running, 62));
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
            var install = await _runner.RunAsync(
                nodePath,
                [
                    npmCliPath,
                    "install",
                    "--global",
                    "--prefix",
                    stagingPrefix,
                    $"remote-codex@{ProductManifest.RemoteCodexVersion}",
                    "--no-audit",
                    "--no-fund",
                    "--loglevel=error",
                ],
                TimeSpan.FromMinutes(15),
                cancellationToken: cancellationToken);
            var stagedEntry = Path.Combine(stagingPrefix, "node_modules", "remote-codex", "bin", "remote-codex.mjs");
            if (!install.Success || !await IsExpectedRemoteCodexAsync(nodePath, stagedEntry, cancellationToken))
            {
                throw new InvalidOperationException($"Remote Codex installation failed. {install.CombinedOutput}".Trim());
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

        if (!await IsExpectedRemoteCodexAsync(nodePath, entryPath, cancellationToken))
        {
            throw new InvalidOperationException("Remote Codex failed verification after installation.");
        }

        progress.Report(new("Remote Codex", $"Remote Codex {ProductManifest.RemoteCodexVersion} installed.", ProvisioningStepState.Complete, 76));
        return entryPath;
    }

    private async Task<bool> IsExpectedRemoteCodexAsync(
        string nodePath,
        string entryPath,
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
            return version.Success && version.StandardOutput.Trim().Equals(ProductManifest.RemoteCodexVersion, StringComparison.Ordinal);
        }
        catch
        {
            return false;
        }
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

    private static void RefreshProcessPath()
    {
        var segments = new[]
        {
            Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.Process),
            Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User),
            Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.Machine),
        };
        Environment.SetEnvironmentVariable("Path", string.Join(';', segments.Where(value => !string.IsNullOrWhiteSpace(value))));
    }
}
