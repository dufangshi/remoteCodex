namespace RemoteCodex.DeviceManager.Infrastructure;

internal static class AppPaths
{
    public static string LocalRoot { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "RemoteCodex");

    public static string DeviceManagerRoot { get; } = Path.Combine(LocalRoot, "DeviceManager");
    public static string InstalledExecutablePath { get; } = Path.Combine(DeviceManagerRoot, "RemoteCodex.DeviceManager.exe");
    public static string RuntimeRoot { get; } = Path.Combine(LocalRoot, "runtime");
    public static string AppRoot { get; } = Path.Combine(LocalRoot, "app");
    public static string DownloadsRoot { get; } = Path.Combine(LocalRoot, "downloads");
    public static string LogsRoot { get; } = Path.Combine(LocalRoot, "logs");
    public static string LogPath { get; } = Path.Combine(LogsRoot, "device-manager.log");
    public static string SettingsPath { get; } = Path.Combine(DeviceManagerRoot, "settings.json");
    public static string RuntimeStatePath { get; } = Path.Combine(DeviceManagerRoot, "runtime-state.json");

    public static string RelayDataRoot { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".remote-codex");

    public static string RelayConfigPath { get; } = Path.Combine(RelayDataRoot, "relay-supervisor.json");
    public static string RelayLogPath { get; } = Path.Combine(RelayDataRoot, "logs", "relay-supervisor.log");

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(DeviceManagerRoot);
        Directory.CreateDirectory(RuntimeRoot);
        Directory.CreateDirectory(AppRoot);
        Directory.CreateDirectory(DownloadsRoot);
        Directory.CreateDirectory(LogsRoot);
    }
}
