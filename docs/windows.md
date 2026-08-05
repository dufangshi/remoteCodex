# Native Windows support

Remote Codex Relay Supervisor contains a native Windows implementation with the following initial contract. Until the Windows CI and Windows 11 release checklist pass, treat it as a release candidate rather than a verified production support claim:

- Windows 11 x64;
- Node.js 22 LTS;
- native Codex provider (`codex.exe` or the npm `codex.cmd` shim);
- local workspaces under the current user's home directory or another local drive;
- Relay mode over the existing WebSocket protocol.

The built-in Terminal plugin is intentionally unavailable on native Windows. Windows does not need tmux, WSL, Git Bash, ConPTY, or C++ Build Tools to start the Relay Supervisor. Claude Code, OpenCode, UNC workspaces, Windows ARM64, and unattended system services are not part of the first supported release.

## Install prerequisites

Install Node.js 22 LTS and native Codex. The official Codex installer is:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
```

Verify the runtime:

```powershell
node --version
codex --version
```

## Foreground mode

Set the Relay connection values, then run the Supervisor in the foreground:

```powershell
$env:REMOTE_CODEX_RELAY_SERVER_URL = 'wss://relay.example.com'
$env:REMOTE_CODEX_RELAY_AGENT_TOKEN = '<device-token>'
remote-codex relay-supervisor run
```

The interactive setup can save these values in `%USERPROFILE%\.remote-codex\relay-supervisor.json`. The file contains secrets and must not be copied into a repository or attached to bug reports.

## Managed background mode

On Windows, `start`, `status`, and `stop` use a detached process with an authenticated local named-pipe control channel:

```powershell
remote-codex relay-supervisor start
remote-codex relay-supervisor status
remote-codex relay-supervisor stop
```

Logs are written to `%USERPROFILE%\.remote-codex\logs\relay-supervisor.log`. Shutdown first asks Fastify, Relay, Codex app-server, and SQLite to close cleanly; forced process-tree termination is only a timeout fallback after instance identity verification.

## Start automatically after logon

Run the bundled PowerShell installer as the same user who owns the Codex login and workspaces:

```powershell
& '<remote-codex-package>\scripts\windows\install-relay-supervisor-task.ps1'
```

The scheduled task uses the current user's interactive token. It does not run as `LocalSystem`, and secrets are not included in task arguments.

To remove the task while preserving configuration and databases:

```powershell
& '<remote-codex-package>\scripts\windows\uninstall-relay-supervisor-task.ps1'
```

Pass `-PurgeData` only when the data under `%USERPROFILE%\.remote-codex` should also be permanently removed.

## Diagnostics

Useful non-secret diagnostics:

```powershell
Get-Command node,npm,codex,git | Format-List Name,Source,Version
remote-codex --version
remote-codex relay-supervisor status
Get-Content "$env:USERPROFILE\.remote-codex\logs\relay-supervisor.log" -Tail 100
```

Redact tokens, passwords, session secrets, authorization headers, and the `controlToken` in `relay-supervisor-state.json` before sharing diagnostics.
