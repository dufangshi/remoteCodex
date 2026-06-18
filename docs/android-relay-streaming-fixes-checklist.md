# Android Relay Streaming Fixes Checklist

Observed during the Android relay E2E run on 2026-06-13.

## Issues

- [x] Streaming scroll anchoring: while a turn streams, transcript updates can pull the viewport back to the top of the active turn. Expected behavior is to follow the bottom only when the user is already at the bottom, and otherwise preserve the user's current reading position.
- [x] Steering placement: when a steer message is accepted during an active turn, it can render directly under the initial user prompt instead of at the point where the user sent it.
- [x] Broken streaming bubbles: partial streaming deltas can appear as incomplete assistant bubbles containing only a few characters. These broken bubbles can appear between normal bubbles instead of staying as one coherent in-progress response at the bottom of the active turn.
- [x] Relay-supervisor setup UX: `remote-codex relay-supervisor` currently depends on required environment variables. If relay URL or device token are missing, the CLI should prompt interactively, persist the answers in a config file, and support a reset command to clear that file.

## Fix Order

- [x] Document the observed bugs and expected behavior.
- [x] Fix Android streaming scroll anchoring.
- [x] Fix steer message ordering in the transcript projection.
- [x] Coalesce provisional streaming deltas so partial assistant output does not render as scattered broken bubbles.
- [x] Add interactive persisted relay-supervisor config and a reset command.
- [x] Rebuild/install the Android APK and rerun relay E2E through the Android UI with a slow multi-step prompt and steering.
