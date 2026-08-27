using System.Text.RegularExpressions;

namespace RemoteCodex.DeviceManager.Services;

internal sealed record ParsedRelayConfiguration(string RelayUrl, string DeviceToken, int? SupervisorPort);

internal static partial class RelayConfigurationParser
{
    private const string RelayUrlKey = "REMOTE_CODEX_RELAY_SERVER_URL";
    private const string AgentTokenKey = "REMOTE_CODEX_RELAY_AGENT_TOKEN";
    private const string SupervisorPortKey = "REMOTE_CODEX_RELAY_SUPERVISOR_PORT";

    public static bool TryParse(
        string text,
        out ParsedRelayConfiguration? configuration,
        out string error)
    {
        configuration = null;
        error = string.Empty;
        if (string.IsNullOrWhiteSpace(text))
        {
            error = "Paste the device setup command from the Relay portal.";
            return false;
        }

        var normalized = NormalizeEscapedText(text);
        var relayUrl = ExtractValue(normalized, RelayUrlKey);
        var token = ExtractValue(normalized, AgentTokenKey);
        var portText = ExtractValue(normalized, SupervisorPortKey);

        if (!Uri.TryCreate(relayUrl, UriKind.Absolute, out var relayUri)
            || (relayUri.Scheme != Uri.UriSchemeWs && relayUri.Scheme != Uri.UriSchemeWss))
        {
            error = $"The pasted configuration does not contain a valid {RelayUrlKey}.";
            return false;
        }
        if (string.IsNullOrWhiteSpace(token) || !token.StartsWith("rcd_", StringComparison.Ordinal))
        {
            error = $"The pasted configuration does not contain a valid {AgentTokenKey}.";
            return false;
        }

        int? port = null;
        if (!string.IsNullOrWhiteSpace(portText))
        {
            if (!int.TryParse(portText, out var parsedPort) || parsedPort is < 1024 or > 65535)
            {
                error = $"{SupervisorPortKey} must be between 1024 and 65535.";
                return false;
            }
            port = parsedPort;
        }

        configuration = new ParsedRelayConfiguration(relayUri.AbsoluteUri.TrimEnd('/'), token, port);
        return true;
    }

    private static string? ExtractValue(string text, string key)
    {
        var match = AssignmentRegex(key).Match(text);
        if (!match.Success)
        {
            return null;
        }

        foreach (var groupName in new[] { "single", "double", "bare" })
        {
            var value = match.Groups[groupName];
            if (value.Success)
            {
                return value.Value.Trim();
            }
        }
        return null;
    }

    private static Regex AssignmentRegex(string key) => new(
        $"""{Regex.Escape(key)}\s*=\s*(?:'(?<single>[^']*)'|"(?<double>[^"]*)"|(?<bare>[^\s\\;]+))""",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static string NormalizeEscapedText(string text)
    {
        return MarkdownEscapeRegex().Replace(text, "$1");
    }

    [GeneratedRegex(@"\\([_:/])", RegexOptions.CultureInvariant)]
    private static partial Regex MarkdownEscapeRegex();
}
