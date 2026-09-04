namespace RemoteCodex.DeviceManager.Models;

internal enum ProvisioningStepState
{
    Pending,
    Running,
    Complete,
    NeedsAction,
    Failed,
}

internal sealed record ProvisioningProgress(
    string Step,
    string Message,
    ProvisioningStepState State,
    int Percent);

internal enum SupervisorState
{
    Unknown,
    Starting,
    Running,
    Stopped,
    Error,
}
