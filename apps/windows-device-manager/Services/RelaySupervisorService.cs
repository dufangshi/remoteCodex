using RemoteCodex.DeviceManager.Infrastructure;
using RemoteCodex.DeviceManager.Models;

namespace RemoteCodex.DeviceManager.Services;

internal sealed class RelaySupervisorService(ProcessRunner runner, AppLogger logger)
{
    public async Task<SupervisorState> GetStateAsync(RuntimeState runtime, CancellationToken cancellationToken)
    {
        try
        {
            var result = await InvokeAsync(runtime, "status", null, TimeSpan.FromSeconds(10), cancellationToken);
            return result.Success ? SupervisorState.Running : SupervisorState.Stopped;
        }
        catch (Exception exception)
        {
            logger.Warning($"Unable to read supervisor state: {exception.Message}");
            return SupervisorState.Unknown;
        }
    }

    public async Task StartAsync(
        RuntimeState runtime,
        DeviceConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var environment = new Dictionary<string, string?>
        {
            ["REMOTE_CODEX_RELAY_SERVER_URL"] = configuration.RelayUrl.Trim(),
            ["REMOTE_CODEX_RELAY_AGENT_TOKEN"] = string.IsNullOrWhiteSpace(configuration.DeviceToken)
                ? null
                : configuration.DeviceToken.Trim(),
            ["REMOTE_CODEX_RELAY_SUPERVISOR_HOST"] = "127.0.0.1",
            ["REMOTE_CODEX_RELAY_SUPERVISOR_PORT"] = configuration.SupervisorPort.ToString(),
            ["REMOTE_CODEX_ENABLED_AGENT_PROVIDERS"] = "codex,acp",
            ["CODEX_COMMAND"] = runtime.CodexCommandPath,
            ["WORKSPACE_ROOT"] = Path.GetFullPath(configuration.WorkspaceRoot.Trim()),
        };

        var result = await InvokeAsync(runtime, "start", environment, TimeSpan.FromSeconds(45), cancellationToken);
        if (!result.Success)
        {
            throw new InvalidOperationException($"Relay Supervisor failed to start. {result.CombinedOutput}".Trim());
        }

        var state = await GetStateAsync(runtime, cancellationToken);
        if (state != SupervisorState.Running)
        {
            throw new InvalidOperationException($"Relay Supervisor did not reach the running state. See {AppPaths.RelayLogPath}.");
        }
    }

    public async Task StopAsync(RuntimeState runtime, CancellationToken cancellationToken)
    {
        var result = await InvokeAsync(runtime, "stop", null, TimeSpan.FromSeconds(30), cancellationToken);
        if (!result.Success)
        {
            throw new InvalidOperationException($"Relay Supervisor failed to stop. {result.CombinedOutput}".Trim());
        }
    }

    private Task<ProcessResult> InvokeAsync(
        RuntimeState runtime,
        string action,
        IReadOnlyDictionary<string, string?>? environment,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        return runner.RunAsync(
            runtime.NodePath,
            [runtime.RemoteCodexEntryPath, "relay-supervisor", action],
            timeout,
            environment,
            Path.GetDirectoryName(runtime.RemoteCodexEntryPath),
            cancellationToken);
    }
}
