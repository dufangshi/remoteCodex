using System.IO.Pipes;
using System.Text;

namespace RemoteCodex.DeviceManager.Infrastructure;

internal sealed class SingleInstanceCoordinator : IDisposable
{
    private const string MutexName = "Local\\RemoteCodex.DeviceManager.Instance";
    private const string PipeName = "RemoteCodex.DeviceManager.Control";
    private readonly Mutex _mutex;
    private readonly CancellationTokenSource _cancellation = new();
    private Task? _listenerTask;

    public SingleInstanceCoordinator()
    {
        _mutex = new Mutex(initiallyOwned: true, MutexName, out var createdNew);
        IsPrimary = createdNew;
    }

    public bool IsPrimary { get; }

    public void StartListening(Action showWindow)
    {
        if (!IsPrimary)
        {
            return;
        }

        _listenerTask = Task.Run(async () =>
        {
            while (!_cancellation.IsCancellationRequested)
            {
                try
                {
                    await using var server = new NamedPipeServerStream(
                        PipeName,
                        PipeDirection.In,
                        1,
                        PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    await server.WaitForConnectionAsync(_cancellation.Token);
                    using var reader = new StreamReader(server, Encoding.UTF8);
                    var command = await reader.ReadLineAsync(_cancellation.Token);
                    if (string.Equals(command, "show", StringComparison.Ordinal))
                    {
                        showWindow();
                    }
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch
                {
                    await Task.Delay(250, _cancellation.Token).ConfigureAwait(false);
                }
            }
        });
    }

    public async Task NotifyPrimaryAsync()
    {
        try
        {
            await using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out, PipeOptions.Asynchronous);
            await client.ConnectAsync(2_000);
            await using var writer = new StreamWriter(client, Encoding.UTF8) { AutoFlush = true };
            await writer.WriteLineAsync("show");
        }
        catch
        {
            // The primary instance may still be initializing.
        }
    }

    public void Dispose()
    {
        _cancellation.Cancel();
        try
        {
            _listenerTask?.Wait(TimeSpan.FromSeconds(1));
        }
        catch
        {
            // Application shutdown should not wait on IPC cleanup.
        }
        _cancellation.Dispose();
        if (IsPrimary)
        {
            _mutex.ReleaseMutex();
        }
        _mutex.Dispose();
    }
}
