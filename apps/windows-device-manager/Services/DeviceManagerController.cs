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
