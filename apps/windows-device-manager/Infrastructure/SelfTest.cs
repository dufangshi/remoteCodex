using RemoteCodex.DeviceManager.Models;
using RemoteCodex.DeviceManager.Services;
using RemoteCodex.DeviceManager.UI;

namespace RemoteCodex.DeviceManager.Infrastructure;

internal static class SelfTest
{
    public static async Task<int> RunAsync()
    {
        var testDirectory = Path.Combine(Path.GetTempPath(), $"remote-codex-device-manager-test-{Guid.NewGuid():N}");
        try
        {
            var errors = new DeviceConfiguration(
                ProductManifest.DefaultRelayUrl,
                "rcd_self_test",
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ProductManifest.DefaultSupervisorPort).Validate(hasSavedToken: false);
            var redacted = AppLogger.Redact("TOKEN=secret _authToken=npm-secret rcd_self_test Authorization bearer-value");
            var powershellConfiguration = """
                Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
                $env:REMOTE_CODEX_RELAY_SERVER_URL='wss://relay.example.test'
                $env:REMOTE_CODEX_RELAY_AGENT_TOKEN='rcd_self_test_token'
                $env:REMOTE_CODEX_RELAY_SUPERVISOR_PORT='45680'
                remote-codex relay-supervisor
                """;
            var bashConfiguration = """
                REMOTE\_CODEX\_RELAY\_SERVER\_URL=wss\://relay.example.test \
                REMOTE\_CODEX\_RELAY\_AGENT\_TOKEN=rcd\_self_test_token \
                REMOTE\_CODEX\_RELAY\_SUPERVISOR\_PORT=45679 \
                remote-codex relay-supervisor
                """;
            var parsedPowerShell = RelayConfigurationParser.TryParse(
                powershellConfiguration,
                out var powerShellResult,
                out _);
            var parsedBash = RelayConfigurationParser.TryParse(
                bashConfiguration,
                out var bashResult,
                out _);
            var passed = errors.Count == 0
                && !redacted.Contains("secret", StringComparison.Ordinal)
                && !redacted.Contains("npm-secret", StringComparison.Ordinal)
                && !redacted.Contains("rcd_self_test", StringComparison.Ordinal)
                && !redacted.Contains("bearer-value", StringComparison.Ordinal)
                && parsedPowerShell
                && powerShellResult is { RelayUrl: "wss://relay.example.test", DeviceToken: "rcd_self_test_token", SupervisorPort: 45680 }
                && parsedBash
                && bashResult is { RelayUrl: "wss://relay.example.test", DeviceToken: "rcd_self_test_token", SupervisorPort: 45679 }
                && Path.IsPathFullyQualified(AppPaths.InstalledExecutablePath);
            if (!passed)
            {
                return 1;
            }

            Directory.CreateDirectory(testDirectory);
            var shimPath = Path.Combine(testDirectory, "fake command.cmd");
            await File.WriteAllTextAsync(shimPath, "@echo off\r\nsetlocal\r\necho shim:%~1\r\n");
            var privateNodeDirectory = Path.Combine(testDirectory, "private-node");
            var otherNodeDirectory = Path.Combine(testDirectory, "other-node");
            Directory.CreateDirectory(privateNodeDirectory);
            Directory.CreateDirectory(otherNodeDirectory);
            await File.WriteAllTextAsync(Path.Combine(privateNodeDirectory, "node.cmd"), "@echo private-node\r\n");
            await File.WriteAllTextAsync(Path.Combine(otherNodeDirectory, "node.cmd"), "@echo other-node\r\n");
            var lifecycleShimPath = Path.Combine(testDirectory, "fake lifecycle.cmd");
            await File.WriteAllTextAsync(lifecycleShimPath, "@echo off\r\nnode\r\n");
            var originalPath = Environment.GetEnvironmentVariable("PATH");
            Environment.SetEnvironmentVariable(
                "PATH",
                string.IsNullOrWhiteSpace(originalPath)
                    ? otherNodeDirectory
                    : $"{otherNodeDirectory}{Path.PathSeparator}{originalPath}");
            var logger = new AppLogger();
            var runner = new ProcessRunner(logger);
            ProcessResult shim;
            ProcessResult lifecycleShim;
            ProcessResult where;
            IReadOnlyDictionary<string, string?> nodeEnvironment;
            try
            {
                shim = await runner.RunAsync(
                    shimPath,
                    ["value with spaces"],
                    TimeSpan.FromSeconds(10));
                nodeEnvironment = RuntimeProvisioner.BuildNodeEnvironment(
                    Path.Combine(privateNodeDirectory, "node.exe"));
                lifecycleShim = await runner.RunAsync(
                    lifecycleShimPath,
                    [],
                    TimeSpan.FromSeconds(10),
                    environment: nodeEnvironment);
                where = await runner.RunAsync(
                    "where.exe",
                    ["cmd.exe"],
                    TimeSpan.FromSeconds(10));
            }
            finally
            {
                Environment.SetEnvironmentVariable("PATH", originalPath);
            }
            var configuredPath = nodeEnvironment["PATH"];
            var processChecksPassed = shim.Success
                && shim.StandardOutput.Contains("shim:value with spaces", StringComparison.Ordinal)
                && lifecycleShim.Success
                && lifecycleShim.StandardOutput.Contains("private-node", StringComparison.Ordinal)
                && !lifecycleShim.StandardOutput.Contains("other-node", StringComparison.Ordinal)
                && configuredPath is not null
                && configuredPath.StartsWith($"{privateNodeDirectory}{Path.PathSeparator}", StringComparison.OrdinalIgnoreCase)
                && nodeEnvironment["npm_config_runtime"] == "node"
                && nodeEnvironment["npm_config_target"] == ProductManifest.NodeVersion
                && nodeEnvironment["npm_config_target_arch"] == "x64"
                && nodeEnvironment["npm_config_nodedir"] == privateNodeDirectory
                && where.Success;
            if (!processChecksPassed)
            {
                logger.Error(
                    $"Self-test process check failed. shim={shim.ExitCode}:{shim.CombinedOutput}; "
                    + $"lifecycle={lifecycleShim.ExitCode}:{lifecycleShim.CombinedOutput}; where={where.ExitCode}:{where.CombinedOutput}");
            }
            return processChecksPassed ? 0 : 1;
        }
        catch (Exception exception)
        {
            try
            {
                new AppLogger().Error("Self-test failed", exception);
            }
            catch
            {
                // Preserve the original self-test result when logging is unavailable.
            }
            return 1;
        }
        finally
        {
            if (Directory.Exists(testDirectory))
            {
                Directory.Delete(testDirectory, recursive: true);
            }
        }
    }

    public static int RenderPreview(string outputPath)
    {
        try
        {
            ApplicationConfiguration.Initialize();
            var logger = new AppLogger();
            var runner = new ProcessRunner(logger);
            var controller = new DeviceManagerController(
                logger,
                new RuntimeProvisioner(logger, runner),
                new RelaySupervisorService(runner, logger),
                new StartupRegistrationService());
            using var form = new MainForm(controller);
            form.StartPosition = FormStartPosition.Manual;
            form.Location = new Point(-20_000, -20_000);
            form.ShowInTaskbar = false;
            form.Show();
            Application.DoEvents();
            form.PerformLayout();
            form.Refresh();
            Application.DoEvents();
            using var bitmap = new Bitmap(form.Width, form.Height);
            form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, form.Size));
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outputPath))!);
            bitmap.Save(outputPath, System.Drawing.Imaging.ImageFormat.Png);
            form.Hide();

            var accentPixelCount = 0;
            for (var y = 30; y < bitmap.Height; y += 2)
            {
                for (var x = 0; x < bitmap.Width; x += 2)
                {
                    var pixel = bitmap.GetPixel(x, y);
                    if (pixel.R is >= 150 and <= 210 && pixel.G is >= 45 and <= 115 && pixel.B <= 45)
                    {
                        accentPixelCount += 1;
                    }
                }
            }
            return accentPixelCount >= 100 ? 0 : 1;
        }
        catch
        {
            return 1;
        }
    }
}
