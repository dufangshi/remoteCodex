using System.Diagnostics;

namespace RemoteCodex.DeviceManager.Infrastructure;

internal static class SelfInstaller
{
    public static void InstallAndRestart(string installedPath, IReadOnlyList<string> originalArguments)
    {
        var sourcePath = Environment.ProcessPath
            ?? throw new InvalidOperationException("The executable path is unavailable.");
        Directory.CreateDirectory(Path.GetDirectoryName(installedPath)!);

        var temporaryPath = $"{installedPath}.{Environment.ProcessId}.new";
        File.Copy(sourcePath, temporaryPath, overwrite: true);
        File.Move(temporaryPath, installedPath, overwrite: true);

        var startInfo = new ProcessStartInfo
        {
            FileName = installedPath,
            UseShellExecute = true,
            WorkingDirectory = Path.GetDirectoryName(installedPath)!,
        };
        startInfo.ArgumentList.Add("--installed");
        foreach (var argument in originalArguments.Where(value => !value.Equals("--installed", StringComparison.OrdinalIgnoreCase)))
        {
            startInfo.ArgumentList.Add(argument);
        }

        _ = Process.Start(startInfo)
            ?? throw new InvalidOperationException("The installed application could not be started.");
    }
}
