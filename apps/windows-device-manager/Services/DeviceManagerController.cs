using RemoteCodex.DeviceManager.Infrastructure;
using RemoteCodex.DeviceManager.Models;

namespace RemoteCodex.DeviceManager.Services;

internal sealed class DeviceManagerController
{
    private readonly AppLogger _logger;
    private readonly RuntimeProvisioner _provisioner;
    private readonly RelaySupervisorService _supervisor;
    private readonly StartupRegistrationService _startup;
    private readonly SemaphoreSlim _operationLock = new(1, 1);

    public DeviceManagerController(
        AppLogger logger,
        RuntimeProvisioner provisioner,
        RelaySupervisorService supervisor,
        StartupRegistrationService startup)
    {
        _logger = logger;
        _provisioner = provisioner;
        _supervisor = supervisor;
        _startup = startup;
        Settings = LoadSettings();
        RelayConfiguration = RelayConfigurationSnapshot.Load(logger);
        Runtime = RuntimeState.Load(logger);
        Progress = new ProvisioningProgress("Ready", "Waiting for configuration.", ProvisioningStepState.Pending, 0);
    }

    public event EventHandler? Changed;

    public AppSettings Settings { get; private set; }
    public RelayConfigurationSnapshot RelayConfiguration { get; private set; }
    public RuntimeState? Runtime { get; private set; }
    public ProvisioningProgress Progress { get; private set; }
    public SupervisorState State { get; private set; } = SupervisorState.Unknown;
    public string? LastError { get; private set; }
    public bool IsBusy { get; private set; }
    public bool HasSavedToken => RelayConfiguration.HasToken;
    public string? AvailableRemoteCodexVersion { get; private set; }
    public string RuntimeUpdateMessage { get; private set; } = "Check npm for a newer Remote Codex release.";
    public string CurrentRemoteCodexVersion => Runtime?.RemoteCodexVersion
        ?? ProductManifest.RemoteCodexVersion;

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (Runtime?.IsUsable == true)
        {
            State = await _supervisor.GetStateAsync(Runtime, cancellationToken);
        }
        else
        {
            State = SupervisorState.Stopped;
        }
        Progress = State == SupervisorState.Running
            ? new ProvisioningProgress(
                "Running",
                "Relay Supervisor is running and maintaining the outbound tunnel.",
                ProvisioningStepState.Complete,
                100)
            : new ProvisioningProgress(
                "Ready",
                "Waiting for a device setup command.",
                ProvisioningStepState.Pending,
                0);
        OnChanged();

        if (Settings.KeepOnline && HasSavedToken && Runtime?.IsUsable == true && State != SupervisorState.Running)
        {
            await MaintainConnectionAsync(cancellationToken);
        }
    }

    public async Task ConnectAsync(
        DeviceConfiguration configuration,
        bool startWithWindows,
        Func<Task<bool>> confirmCodexLogin,
        CancellationToken cancellationToken = default)
    {
        var errors = configuration.Validate(HasSavedToken);
        if (errors.Count > 0)
        {
            throw new ArgumentException(string.Join(Environment.NewLine, errors));
        }
        EnsureWorkspaceIsWritable(configuration.WorkspaceRoot);

        await _operationLock.WaitAsync(cancellationToken);
        try
        {
            SetBusy(true);
            LastError = null;
            State = SupervisorState.Starting;
            Report(new("Setup", "Preparing this Windows device...", ProvisioningStepState.Running, 2));

            Runtime = await _provisioner.EnsureAsync(
                new Progress<ProvisioningProgress>(Report),
                confirmCodexLogin,
                cancellationToken);

            var currentState = await _supervisor.GetStateAsync(Runtime, cancellationToken);
            if (currentState == SupervisorState.Running)
            {
                Report(new("Relay Supervisor", "Applying the device configuration...", ProvisioningStepState.Running, 82));
                await _supervisor.StopAsync(Runtime, cancellationToken);
            }

            Report(new("Relay Supervisor", "Starting the background device connection...", ProvisioningStepState.Running, 88));
            await _supervisor.StartAsync(Runtime, configuration, cancellationToken);

            Settings = Settings with
            {
                RelayUrl = configuration.RelayUrl.Trim(),
                WorkspaceRoot = Path.GetFullPath(configuration.WorkspaceRoot.Trim()),
                SupervisorPort = configuration.SupervisorPort,
                StartWithWindows = startWithWindows,
                KeepOnline = true,
            };
            Settings.Save();
            _startup.SetEnabled(startWithWindows);
            RelayConfiguration = RelayConfigurationSnapshot.Load(_logger);
            State = SupervisorState.Running;
            Report(new("Running", "Relay Supervisor is running and maintaining the outbound tunnel.", ProvisioningStepState.Complete, 100));
            _logger.Info("Device connected successfully.");
        }
        catch (OperationCanceledException)
        {
            State = SupervisorState.Stopped;
            Report(new("Cancelled", "Setup was cancelled.", ProvisioningStepState.Pending, 0));
            throw;
        }
        catch (Exception exception)
        {
            LastError = AppLogger.Redact(exception.Message);
            State = SupervisorState.Error;
            Report(new("Failed", LastError, ProvisioningStepState.Failed, Progress.Percent));
            _logger.Error("Device connection failed", exception);
            throw;
        }
        finally
        {
            SetBusy(false);
            _operationLock.Release();
        }
    }

    public async Task DisconnectAsync(CancellationToken cancellationToken = default)
    {
        await _operationLock.WaitAsync(cancellationToken);
        try
        {
            SetBusy(true);
            LastError = null;
            if (Runtime?.IsUsable == true)
            {
                await _supervisor.StopAsync(Runtime, cancellationToken);
            }
            Settings = Settings with { KeepOnline = false };
            Settings.Save();
            State = SupervisorState.Stopped;
            Report(new("Offline", "This device is disconnected.", ProvisioningStepState.Pending, 0));
            _logger.Info("Device disconnected by the user.");
        }
        catch (Exception exception)
        {
            LastError = AppLogger.Redact(exception.Message);
            State = SupervisorState.Error;
            _logger.Error("Device disconnect failed", exception);
            throw;
        }
        finally
        {
            SetBusy(false);
            _operationLock.Release();
        }
    }

    public async Task CheckRemoteCodexUpdateAsync(CancellationToken cancellationToken = default)
    {
        await _operationLock.WaitAsync(cancellationToken);
        try
        {
            SetBusy(true);
            AvailableRemoteCodexVersion = null;
            RuntimeUpdateMessage = "Checking npm for updates...";
            OnChanged();

            var latestVersion = await _provisioner.GetLatestRemoteCodexVersionAsync(cancellationToken);
            if (RuntimeProvisioner.IsNewerVersion(latestVersion, CurrentRemoteCodexVersion))
            {
                AvailableRemoteCodexVersion = latestVersion;
                RuntimeUpdateMessage = $"Remote Codex {latestVersion} is available.";
            }
            else
            {
                RuntimeUpdateMessage = $"Remote Codex {CurrentRemoteCodexVersion} is up to date.";
            }
            _logger.Info("Remote Codex update check completed.");
            OnChanged();
        }
        catch (Exception exception)
        {
            RuntimeUpdateMessage = $"Update check failed: {AppLogger.Redact(exception.Message)}";
            _logger.Error("Remote Codex update check failed", exception);
            OnChanged();
            throw;
        }
        finally
        {
            SetBusy(false);
            _operationLock.Release();
        }
    }

    public async Task UpdateRemoteCodexAsync(CancellationToken cancellationToken = default)
    {
        if (Runtime?.IsUsable != true || string.IsNullOrWhiteSpace(AvailableRemoteCodexVersion))
        {
            throw new InvalidOperationException("Check for an available Remote Codex update first.");
        }

        await _operationLock.WaitAsync(cancellationToken);
        var originalRuntime = Runtime;
        var wasRunning = false;
        try
        {
            SetBusy(true);
            LastError = null;
            wasRunning = await _supervisor.GetStateAsync(originalRuntime, cancellationToken) == SupervisorState.Running;
            if (wasRunning)
            {
                State = SupervisorState.Starting;
                Report(new("Remote Codex", "Stopping the Supervisor before updating...", ProvisioningStepState.Running, 10));
                await _supervisor.StopAsync(originalRuntime, cancellationToken);
            }

            var targetVersion = AvailableRemoteCodexVersion;
            Runtime = await _provisioner.UpdateRemoteCodexAsync(
                originalRuntime,
                targetVersion,
                new Progress<ProvisioningProgress>(Report),
                cancellationToken);

            if (wasRunning)
            {
                Report(new("Remote Codex", "Restarting the Supervisor with the updated runtime...", ProvisioningStepState.Running, 90));
                await _supervisor.StartAsync(Runtime, ConfigurationFromSettings(), cancellationToken);
                State = SupervisorState.Running;
            }
            else
            {
                State = SupervisorState.Stopped;
            }

            AvailableRemoteCodexVersion = null;
            RuntimeUpdateMessage = $"Remote Codex {Runtime.RemoteCodexVersion} is installed.";
            Report(new("Ready", RuntimeUpdateMessage, ProvisioningStepState.Complete, 100));
            _logger.Info("Remote Codex update completed successfully.");
        }
        catch (Exception exception)
        {
            Runtime = originalRuntime;
            RuntimeUpdateMessage = $"Update failed: {AppLogger.Redact(exception.Message)}";
            LastError = AppLogger.Redact(exception.Message);
            if (wasRunning)
            {
                try
                {
                    await _supervisor.StartAsync(originalRuntime, ConfigurationFromSettings(), cancellationToken);
                    State = SupervisorState.Running;
                }
                catch (Exception restartException)
                {
                    State = SupervisorState.Error;
                    _logger.Error("Unable to restore the previous Supervisor after an update failure", restartException);
                }
            }
            _logger.Error("Remote Codex update failed", exception);
            OnChanged();
            throw;
        }
        finally
        {
            SetBusy(false);
            _operationLock.Release();
        }
    }

    public async Task MaintainConnectionAsync(CancellationToken cancellationToken = default)
    {
        if (IsBusy || !Settings.KeepOnline || !HasSavedToken || Runtime?.IsUsable != true)
        {
            return;
        }

        if (!await _operationLock.WaitAsync(0, cancellationToken))
        {
            return;
        }

        try
        {
            var state = await _supervisor.GetStateAsync(Runtime, cancellationToken);
            if (state == SupervisorState.Running)
            {
                if (State != SupervisorState.Running)
                {
                    State = SupervisorState.Running;
                    LastError = null;
                    OnChanged();
                }
                return;
            }

            State = SupervisorState.Starting;
            Report(new("Reconnect", "The Supervisor stopped; reconnecting...", ProvisioningStepState.Running, 90));
            var configuration = new DeviceConfiguration(
                Settings.RelayUrl,
                string.Empty,
                Settings.WorkspaceRoot,
                Settings.SupervisorPort);
            await _supervisor.StartAsync(Runtime, configuration, cancellationToken);
            State = SupervisorState.Running;
            LastError = null;
            Report(new("Running", "Relay Supervisor is running and maintaining the outbound tunnel.", ProvisioningStepState.Complete, 100));
            _logger.Info("Device connection was restored automatically.");
        }
        catch (Exception exception)
        {
            State = SupervisorState.Error;
            LastError = AppLogger.Redact(exception.Message);
            _logger.Error("Automatic reconnect failed", exception);
            OnChanged();
        }
        finally
        {
            _operationLock.Release();
        }
    }

    public void SetStartWithWindows(bool enabled)
    {
        _startup.SetEnabled(enabled);
        Settings = Settings with { StartWithWindows = enabled };
        Settings.Save();
        OnChanged();
    }

    public async Task StopForExitAsync(CancellationToken cancellationToken = default)
    {
        await _operationLock.WaitAsync(cancellationToken);
        try
        {
            if (Runtime?.IsUsable == true)
            {
                await _supervisor.StopAsync(Runtime, cancellationToken);
            }
            State = SupervisorState.Stopped;
            OnChanged();
        }
        finally
        {
            _operationLock.Release();
        }
    }

    private AppSettings LoadSettings()
    {
        var hasSettings = File.Exists(AppPaths.SettingsPath);
        var settings = AppSettings.Load(_logger);
        if (hasSettings)
        {
            return settings with { StartWithWindows = _startup.IsEnabled() };
        }

        var relay = RelayConfigurationSnapshot.Load(_logger);
        return settings with
        {
            RelayUrl = relay.RelayUrl ?? settings.RelayUrl,
            WorkspaceRoot = relay.WorkspaceRoot ?? settings.WorkspaceRoot,
            SupervisorPort = relay.SupervisorPort ?? settings.SupervisorPort,
            StartWithWindows = _startup.IsEnabled() || settings.StartWithWindows,
            KeepOnline = relay.HasToken,
        };
    }

    private DeviceConfiguration ConfigurationFromSettings() => new(
        Settings.RelayUrl,
        string.Empty,
        Settings.WorkspaceRoot,
        Settings.SupervisorPort);

    private static void EnsureWorkspaceIsWritable(string workspaceRoot)
    {
        var fullPath = Path.GetFullPath(workspaceRoot.Trim());
        Directory.CreateDirectory(fullPath);
        var probePath = Path.Combine(fullPath, $".remote-codex-write-test-{Environment.ProcessId}");
        try
        {
            File.WriteAllText(probePath, string.Empty);
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException($"Workspace root is not writable: {fullPath}", exception);
        }
        finally
        {
            File.Delete(probePath);
        }
    }

    private void Report(ProvisioningProgress progress)
    {
        Progress = progress;
        OnChanged();
    }

    private void SetBusy(bool busy)
    {
        IsBusy = busy;
        OnChanged();
    }

    private void OnChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
