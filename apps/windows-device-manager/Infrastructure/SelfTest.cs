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
            var redacted = AppLogger.Redact("TOKEN=secret rcd_self_test Authorization bearer-value");
            var passed = errors.Count == 0
                && !redacted.Contains("secret", StringComparison.Ordinal)
                && !redacted.Contains("rcd_self_test", StringComparison.Ordinal)
                && !redacted.Contains("bearer-value", StringComparison.Ordinal)
                && Path.IsPathFullyQualified(AppPaths.InstalledExecutablePath);
            if (!passed)
            {
                return 1;
            }

            Directory.CreateDirectory(testDirectory);
            var shimPath = Path.Combine(testDirectory, "fake command.cmd");
            await File.WriteAllTextAsync(shimPath, "@echo off\r\nsetlocal\r\necho shim:%~1\r\n");
            var logger = new AppLogger();
            var runner = new ProcessRunner(logger);
            var shim = await runner.RunAsync(
                shimPath,
                ["value with spaces"],
                TimeSpan.FromSeconds(10));
            var where = await runner.RunAsync(
                "where.exe",
                ["cmd.exe"],
                TimeSpan.FromSeconds(10));
            return shim.Success
                && shim.StandardOutput.Contains("shim:value with spaces", StringComparison.Ordinal)
                && where.Success
                ? 0
                : 1;
        }
        catch
        {
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
            form.CreateControl();
            using var bitmap = new Bitmap(form.Width, form.Height);
            form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, form.Size));
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outputPath))!);
            bitmap.Save(outputPath, System.Drawing.Imaging.ImageFormat.Png);
            return 0;
        }
        catch
        {
            return 1;
        }
    }
}
