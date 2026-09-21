# Device setup and upstream management

On the relay Devices page, create a device and copy its macOS/Linux setup command.
The command downloads `/setup.sh` from that relay and carries the device's
permanent token. The script uses
Node 22+ when available, otherwise installs a checksummed private Node 22 LTS
runtime. It installs the latest stable Remote Codex release, enrolls the
device and verifies the relay connection. No global npm prefix or shell profile
is changed. Repeating the same command can recover a saved enrollment; it never
replaces a different existing device configuration.

Supported bootstrap platforms are Apple Silicon macOS and glibc Linux on ARM64/x64, with curl
or wget and tar. macOS uses a user LaunchAgent; Linux uses a systemd user service
when available. These start with the user session. Linux machines requiring
startup before login need user lingering configured by their administrator.
Without a user service manager (including some containers), setup starts a
detached process and reports that reboot startup is unavailable. Windows retains
the independently released Device Manager workflow.

Open a device's Settings to manage its Supervisor, harnesses and upstreams.
Only the device owner can change these settings. Install/Update jobs keep running
when the page closes; their progress is visible when reopening Settings. The
managed install catalog includes Codex, Claude Code, Gemini CLI, Grok Build,
Cursor Agent, GitHub Copilot and OpenCode. Codex and Claude also install the ACP
adapter. Updates preserve the detected installation owner. DeepSeek/custom
executables still need an externally managed installation.

Upstream profiles currently support Codex Responses, Claude Messages, Gemini
GenerateContent and Grok Responses/Chat Completions. Profiles, keys and exact
configuration backups are stored privately on the device. The browser receives
only a `hasApiKey` flag. Activation updates provider-owned fields while preserving
MCP, skills and other settings. It retires idle ACP processes; the next turn
reloads the configuration and resumes the session. A busy harness returns a
conflict; finish or stop its current tasks before switching. Restore recovers
the previous files. CLI configuration follows the Supervisor's OS user and
native config-home overrides; two Supervisors sharing those directories share
the live CLI configuration.

Connection tests make a small authenticated model request and may incur charges.
Claude profiles support both API-key and bearer-token authentication; imported
profiles preserve that choice and connection tests use the same header as the CLI.
They validate the API response shape, without returning upstream response bodies.
Import accepts native provider TOML/JSON or a CC Switch provider's `settingsConfig`
object, not its database or arbitrary commands. OAuth-only providers still require
their vendor login flow; an API key template does not replace OAuth authorization.

## Templates

Import first shows a preview. Apply installs missing harnesses/adapters, then
activates the profiles. A failed step stops the job and reports completed steps;
successful installations are retained and configuration backups remain available.
Jobs run within the Supervisor, so do not restart it during a template apply.
Exports omit API keys; fill these before importing on a new device.

```json
{
  "schemaVersion": 1,
  "harnesses": ["codex", "claude"],
  "profiles": [
    {
      "name": "Team Codex",
      "harness": "codex",
      "baseUrl": "https://api.example.com/v1",
      "apiKey": "REPLACE_WITH_DEVICE_KEY",
      "apiType": "responses"
    }
  ]
}
```

The model field is optional. When omitted, applying the template probes the
upstream model catalog and selects the first generative model returned. The
schema accepts one active profile per harness and fixed catalog IDs only.
It never installs imported shell commands, arbitrary package names or URLs.

## Isolated acceptance

`scripts/device-setup-live.mjs` runs on an isolated Linux machine with a supplied
candidate native binary. It creates its own HOME, relay, registry fixture and
database, fetches official Node and harness packages, exercises device-scoped
management, and stops only the processes it created. Evidence remains in its
printed temporary directory. Restart/configuration ACP tests use deterministic
fixtures; no host credentials or model quota are required.
