# Codex Full access across resume and goal continuation

The reported session kept `approvalMode=yolo` and `sandboxMode=danger-full-access` in Remote Codex, but its native rollout switched from `danger-full-access` to `workspace-write` with `network_access=false` during a goal continuation. The UI was displaying saved preferences, not the effective native environment.

Two gaps allowed those states to diverge:

- Session resume did not receive the saved policy. The ACP adapter resumes native threads without sandbox overrides, letting native configuration defaults take effect before the next prompt.
- ACP mode changes only configure subsequent adapter prompts. Native goal continuations do not pass through that prompt path, so they also need native session defaults.

The runtime now supplies the persisted policy on every resume entry point, including capability discovery, goal submission, and forks. The existing single-writer Codex bridge supplies native start/resume/fork defaults and synchronizes `thread/settings/update` before prompts and permission changes. Successful updates are tracked per native thread; explicitly restricted audit forks and named permission profiles remain intact. Permission application failures propagate rather than returning success.

Legacy imported `yolo` records without a sandbox field resolve to Full, while an explicit restricted sandbox still wins. New threads already default to Full.

Validation covers default inheritance, fork/load inheritance, preservation of explicit restrictions, legacy imported policies, and native permission synchronization before goal prompts through both Codex and ACP provider paths. The native bundled app-server accepts `dangerFullAccess` and `approvalPolicy=never` for the session settings API. Full workspace Rust tests are required for this change.

This does not modify the user's global Codex config or disable administrator-enforced restrictions. It applies the permission choice made in Remote Codex to its own native sessions.
