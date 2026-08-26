using System.Diagnostics;
using System.Text;

namespace RemoteCodex.DeviceManager.Infrastructure;

internal sealed record ProcessResult(int ExitCode, string StandardOutput, string StandardError)
{
    public bool Success => ExitCode == 0;
    public string CombinedOutput => string.Join(
        Environment.NewLine,
        new[] { StandardOutput.Trim(), StandardError.Trim() }.Where(value => value.Length > 0));
}

internal sealed class ProcessRunner(AppLogger logger)
{
    private const int MaximumCapturedCharacters = 1_000_000;

    public async Task<ProcessResult> RunAsync(
        string command,
        IReadOnlyList<string> arguments,
        TimeSpan timeout,
        IReadOnlyDictionary<string, string?>? environment = null,
        string? workingDirectory = null,
        CancellationToken cancellationToken = default)
    {
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);

        var startInfo = BuildStartInfo(command, arguments, environment, workingDirectory);
        using var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();

        process.OutputDataReceived += (_, eventArgs) => Append(stdout, eventArgs.Data);
        process.ErrorDataReceived += (_, eventArgs) => Append(stderr, eventArgs.Data);

        logger.Info($"Running {Path.GetFileName(command)} {string.Join(' ', arguments.Select(_ => "[arg]"))}");
        try
        {
            if (!process.Start())
            {
                throw new InvalidOperationException($"Unable to start {Path.GetFileName(command)}.");
            }

            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            await process.WaitForExitAsync(timeoutSource.Token);
            process.WaitForExit();
            return new ProcessResult(process.ExitCode, stdout.ToString(), stderr.ToString());
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            TryTerminate(process);
            throw new TimeoutException($"{Path.GetFileName(command)} did not finish within {timeout.TotalSeconds:0} seconds.");
        }
        catch
        {
            TryTerminate(process);
            throw;
        }
    }

    public async Task<int> RunInteractiveAsync(
        string command,
        IReadOnlyList<string> arguments,
        CancellationToken cancellationToken)
    {
        var commandLine = BuildCmdCommandLine(command, arguments);
        var startInfo = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/d /s /c \"{commandLine}\"",
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Normal,
            WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        };

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException($"Unable to start {Path.GetFileName(command)}.");
        await process.WaitForExitAsync(cancellationToken);
        return process.ExitCode;
    }

    private static ProcessStartInfo BuildStartInfo(
        string command,
        IReadOnlyList<string> arguments,
        IReadOnlyDictionary<string, string?>? environment,
        string? workingDirectory)
    {
        var isScriptShim = command.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase)
            || command.EndsWith(".bat", StringComparison.OrdinalIgnoreCase);
        var startInfo = new ProcessStartInfo
        {
            FileName = isScriptShim ? "cmd.exe" : command,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = workingDirectory ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        };

        if (isScriptShim)
        {
            startInfo.Arguments = $"/d /s /c \"{BuildCmdCommandLine(command, arguments)}\"";
        }
        else
        {
            foreach (var argument in arguments)
            {
                startInfo.ArgumentList.Add(argument);
            }
        }

        if (environment is not null)
        {
            foreach (var (name, value) in environment)
            {
                if (value is null)
                {
                    startInfo.Environment.Remove(name);
                }
                else
                {
                    startInfo.Environment[name] = value;
                }
            }
        }

        return startInfo;
    }

    private static string BuildCmdCommandLine(string command, IReadOnlyList<string> arguments)
    {
        return string.Join(' ', new[] { command }.Concat(arguments).Select(QuoteCmdArgument));
    }

    private static string QuoteCmdArgument(string value)
    {
        if (value.Length > 0 && value.All(character => char.IsLetterOrDigit(character) || "_-.:/\\".Contains(character)))
        {
            return value;
        }

        return $"\"{value.Replace("\"", "\"\"")}\"";
    }

    private static void Append(StringBuilder builder, string? value)
    {
        if (value is null || builder.Length >= MaximumCapturedCharacters)
        {
            return;
        }

        var remaining = MaximumCapturedCharacters - builder.Length;
        builder.AppendLine(value.Length <= remaining ? value : value[..remaining]);
    }

    private static void TryTerminate(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // Preserve the original timeout or process failure.
        }
    }
}
