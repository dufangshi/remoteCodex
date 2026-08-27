using Microsoft.Win32;
using RemoteCodex.DeviceManager.Infrastructure;

namespace RemoteCodex.DeviceManager.Services;

internal sealed class StartupRegistrationService
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "RemoteCodexDeviceManager";

    public bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        return key?.GetValue(ValueName) is string value
            && value.Contains(AppPaths.InstalledExecutablePath, StringComparison.OrdinalIgnoreCase);
    }

    public void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
            ?? throw new InvalidOperationException("The current-user startup registry key could not be opened.");
        if (enabled)
        {
            key.SetValue(ValueName, $"\"{AppPaths.InstalledExecutablePath}\" --installed --background", RegistryValueKind.String);
        }
        else
        {
            key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
    }
}
