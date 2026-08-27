namespace RemoteCodex.DeviceManager;

internal static class ProductManifest
{
    public const string ProductName = "Remote Codex Device";
    public const string DefaultRelayUrl = "wss://remote-codex.lnz-study.com";
    public const int DefaultSupervisorPort = 45680;

    public const string NodeVersion = "22.23.2";
    public const string NodeArchiveName = "node-v22.23.2-win-x64.zip";
    public const string NodeArchiveSha256 = "1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97";
    public static readonly Uri NodeArchiveUri = new($"https://nodejs.org/dist/v{NodeVersion}/{NodeArchiveName}");

    public const string RemoteCodexVersion = "0.11.49";
    public static readonly Uri RemoteCodexLatestMetadataUri = new("https://registry.npmjs.org/remote-codex/latest");
    public static readonly Uri CodexInstallerUri = new("https://chatgpt.com/codex/install.ps1");
    public static readonly Uri RelayPortalUri = new("https://remote-codex.lnz-study.com/relay-portal");
}
