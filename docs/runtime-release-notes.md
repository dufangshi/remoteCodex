Native Supervisors find agents installed from your shell, and Harness settings are easier to read.

- Native service units used to start the Supervisor with the service manager's minimal PATH. Agent CLIs installed through nvm, `~/.local/bin`, `~/.grok/bin` and similar directories were then reported as "Not installed" in Settings, and their ACP adapters refused to install. The Supervisor now merges your login shell's PATH at startup and records it in its systemd or launchd unit. If the shell PATH cannot be read, it also searches nvm's default Node, Volta and Bun.
- Settings → Harnesses shows each harness's overall status, also as a dot on its picker button. The command-line tool and ACP adapter are listed side by side with their command, version, install source and path. A missing command now explains where the Supervisor looked. The adapter action waits until the command-line tool is installed.
- Devices still on npm: update once to the final npm release (0.12.77), then press Update again to move to the native GitHub runtime.

This release does not change the independently released Windows Device Manager.
