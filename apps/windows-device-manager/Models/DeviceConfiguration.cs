namespace RemoteCodex.DeviceManager.Models;

internal sealed record DeviceConfiguration(
    string RelayUrl,
    string DeviceToken,
    string WorkspaceRoot,
    int SupervisorPort)
{
    public IReadOnlyList<string> Validate(bool hasSavedToken)
    {
        var errors = new List<string>();
        if (!Uri.TryCreate(RelayUrl.Trim(), UriKind.Absolute, out var relayUri)
            || (relayUri.Scheme != Uri.UriSchemeWs && relayUri.Scheme != Uri.UriSchemeWss))
        {
            errors.Add("Relay URL must begin with ws:// or wss://.");
        }

        if (string.IsNullOrWhiteSpace(DeviceToken) && !hasSavedToken)
        {
            errors.Add("Enter the device token from the Relay portal.");
        }
        else if (!string.IsNullOrWhiteSpace(DeviceToken)
                 && !DeviceToken.Trim().StartsWith("rcd_", StringComparison.Ordinal))
        {
            errors.Add("The device token must begin with rcd_.");
        }

        if (string.IsNullOrWhiteSpace(WorkspaceRoot) || !Path.IsPathFullyQualified(WorkspaceRoot.Trim()))
        {
            errors.Add("Workspace root must be an absolute local path.");
        }
        else
        {
            try
            {
                var fullPath = Path.GetFullPath(WorkspaceRoot.Trim());
                if (fullPath.StartsWith("\\\\", StringComparison.Ordinal))
                {
                    errors.Add("UNC workspace roots are not supported in the first Windows release.");
                }
                else if (string.Equals(
                             fullPath.TrimEnd(Path.DirectorySeparatorChar),
                             Path.GetPathRoot(fullPath)?.TrimEnd(Path.DirectorySeparatorChar),
                             StringComparison.OrdinalIgnoreCase))
                {
                    errors.Add("Choose a project folder instead of an entire drive.");
                }
            }
            catch (Exception exception) when (exception is ArgumentException or NotSupportedException or PathTooLongException)
            {
                errors.Add("Workspace root is not a valid Windows path.");
            }
        }

        if (SupervisorPort is < 1024 or > 65535)
        {
            errors.Add("Local port must be between 1024 and 65535.");
        }

        return errors;
    }
}
