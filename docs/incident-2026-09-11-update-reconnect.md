# Update rollback and stranded reconnect execution

## Evidence

The affected Linux device ran the npm launcher and Supervisor from the same NVM
prefix. At inspection, npm, the PATH launcher, and `/healthz.runningVersion` all
reported `0.12.32`, and health reported `relayConnected: true`. An older independent
worker retained a `rolled-back` record targeting `0.12.32`, with previous runtime
`0.12.31` and `Supervisor started, but relay reconnection failed`.

That copied worker still used the pre-0.12.32 log-based verification and package
rollback. Installing a fixed package does not replace a worker already executing
outside that package. The new readiness/rollback protection already included in
0.12.32 therefore cannot protect an upgrade initiated by the old helper. This
explains a briefly running new version followed by a previous npm version.
The incident worker's `previous-package/package.json` specifically reports
`0.12.30`, although its job reports the previous running binary as `0.12.31`.
Its rollback therefore restored an npm launcher version different from the
binary version, directly accounting for the user's later `.30` version check.

The affected thread retained its native session and a durable `continuation`
containing the user's follow-up, but startup reconciliation had marked the
unfinished turn `recovering`. Supervisor restart alone intentionally does not
replay arbitrary unconfirmed tasks.

The resume handler had a separate lifecycle bug: it awaited `drain_steers`, which
awaited the entire queued model turn. A long reconnect therefore exceeded the
request lifetime. Dropping that future could discard the ACP prompt receiver
without clearing Supervisor and adapter ownership, while the native backend kept
working. The UI stopped receiving output, Stop could not settle the orphaned
ownership, and management restart rejected the residual active turn. A local
request reproduced the long wait; its client timed out after 60 seconds. Native
rollout output continued after the Supervisor's last persisted output.

## Source changes

- Reconnect is owned by a detached Supervisor task, including connection setup.
  Its response reports connection state without waiting for queued work to finish.
  Durable queue delivery runs independently; reconnect or receipt retries cannot
  deliver the same prompt twice.
- A verified idle backend settles the old uncertain turn as interrupted and clears
  the thread's current reconnect error, broadcasting that change. Historical turns
  are not relabelled as successfully completed.
- Maintenance recovery reconnects a journaled turn left uncertain by a crash
  between journaling and cancellation settlement. Failed connection attempts retain
  the marker for retry. Explicit reconnect retries that thread's maintenance intent
  before its ordinary queue. Obsolete markers cannot settle a newer uncertain turn,
  and explicit Stop still removes automatic recovery intent.
- Update eligibility compares latest, installed npm, and running versions in the
  helper, management API, and Settings. A new running binary with an old npm package
  can now be repaired. Settings describes the mismatch without assuming which side
  is newer.

## Validation and distribution boundary

`cargo test --workspace --quiet`: 273 passed, one existing opt-in real Gemini test
ignored. The new regressions cover a dropped reconnect caller, a long queued turn,
receipt/reconnect retry deduplication, and maintenance intent surviving both a
crash and a failed backend reconnect. Existing cancellation, user-stop, ordinary
crash, provider, and update recovery tests also pass.

Launcher/updater tests: 18 passed, the macOS-only launchd test skipped on Linux.
RuntimeManagement component tests: 9 passed. Web typecheck and production build
passed, with existing dependency/chunk-size build warnings.

No new package version, release, or deployment is part of this change. No candidate
Supervisor was installed on the host. The Treer Apple container used by the
repository's live restart tests is not available in this Linux session, so those
machine-level candidate tests were not run. Production recovery is incident repair,
not evidence that a candidate build passed a live restart test.

## Production recovery

The old `.32` Stop request could not clear its orphaned live record. Its management
Restart was attempted and failed with `A turn started during preparation`, despite
there being only the stranded task. With other threads idle, recovery saved the
thread snapshot and a consistent SQLite backup, stopped the exact old Supervisor
and affected ACP process, and restarted the already-installed `.32` launcher.
The Supervisor changed from PID 95492 to 152602 and registered with Relay.

The original thread was then explicitly reconnected with an empty ordinary queue.
Its old uncertain turn was settled as interrupted. A durable, idempotent recovery
continuation was submitted through the normal prompt API, telling it to inspect
partial work before continuing the user's existing task. This avoids the old
synchronous resume-and-drain route. No thread, native session, or workspace was
deleted. The incident backup is at
`~/.remote-codex/recovery/thread-a14e7ae9-a9eAnH/` on the affected device. The last
failed maintenance record was marked recovered with its prior phase/error retained.
The resumed turn started at `21:23:58 UTC`. After native context compaction, new
text and tool output were still being persisted at `21:27:19 UTC`, more than three
minutes later and beyond the old 60-second request timeout. Health and thread
snapshots confirmed the same native session, a connected Relay, and no current
thread error. Before/after snapshots are included in the incident backup.
