using System.Text.Json;
using System.Text.Json.Serialization;
using RemoteCodex.DeviceManager.Infrastructure;

namespace RemoteCodex.DeviceManager.Models;

internal sealed record RuntimeState(
    string NodePath,
    string RemoteCodexEntryPath,
    string CodexCommandPath,
    DateTimeOffset UpdatedAt)
{
    public bool IsUsable => File.Exists(NodePath)
        && File.Exists(RemoteCodexEntryPath)
        && File.Exists(CodexCommandPath);

    public void Save()
    {
        AppPaths.EnsureDirectories();
        var temporaryPath = $"{AppPaths.RuntimeStatePath}.{Environment.ProcessId}.tmp";
        File.WriteAllText(temporaryPath, JsonSerializer.Serialize(this, JsonOptions));
        File.Move(temporaryPath, AppPaths.RuntimeStatePath, overwrite: true);
    }

    public static RuntimeState? Load(AppLogger logger)
    {
        try
        {
            if (!File.Exists(AppPaths.RuntimeStatePath))
            {
                return null;
            }

            return JsonSerializer.Deserialize<RuntimeState>(File.ReadAllText(AppPaths.RuntimeStatePath), JsonOptions);
        }
        catch (Exception exception)
        {
            logger.Warning($"Ignoring invalid runtime state: {exception.Message}");
            return null;
        }
    }

    private static JsonSerializerOptions JsonOptions { get; } = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip,
    };
}
