Remote Codex is now **Pockymoe**.

- New name and icon across the Web app, CLI and docs. The `pockymoe` command is the new name; `remote-codex` keeps working, and existing `REMOTE_CODEX_*` settings, devices, sign-ins, encryption keys, history and harness configuration are unchanged.
- Devices still on npm (0.12.74 or older) can finally reach GitHub releases. This version is also published as the final `remote-codex` npm package: update once in Settings to install it, then press Update again to move the device to the native GitHub runtime. Later updates come from GitHub. Windows Device Manager devices run the Windows setup command from the Devices page instead.
- Native devices update from Settings as usual; release asset names are unchanged.

Verified with targeted Rust, Web and shared UI regressions, the native bootstrap tests, and an npm-launched Supervisor migrating itself to the native GitHub runtime end to end.

This release does not change the independently released Windows Device Manager.
