# Installed update stranded behind the old tmux session

The affected device's update job installed 0.12.37. Its retained
`updates/supervisor-hyoWqG/launch.log` contains:

```
tmux session remote-codex-relay-supervisor is already running
```

The updater waits for the native Supervisor PID to disappear, then calls
`relay-supervisor start`. That PID's exit does not establish that its parent
launcher, shell and `tee` pipeline have released the tmux session. A retained
pane or an inherited pipe can keep it present. The launcher correctly refuses
a duplicate named session, leaving the installed package updated but the device
offline. The job later reported completion after manual restart; that is not
evidence that the original automatic launch succeeded.

The worker now captures the original tmux socket, immutable session/pane IDs and
pane PID before installation. It verifies that the Supervisor descends from that
pane and that the configured managed session contains no additional panes. After
the native PID exits, it retires that same session only if the pane identity still
matches, then starts the new launcher without stale tmux parent variables. Other
tmux sessions and user-added panes are not removed. Normal non-tmux startup is
unchanged. HTTP version/PID and Relay registration must still pass verification
before paused tasks can resume.

Settings now distinguishes a lost connection from ongoing installation. After
30 seconds without a response it explains that restart is unverified and points
to device logs while continuing automatic polling.

Verification: targeted updater tests cover a retained old session, changed pane
identity, extra panes, missing ancestry and the ordering of stop, retire and
replacement launch. The Treer live relay test has an opt-in `--tmux` mode with a
unique test session and `remain-on-exit` to reproduce the failure deterministically.
It was not run in this session: the available Mac endpoint rejected SSH
authentication, and the MacBook endpoint was offline. No active host Supervisor
was restarted. This limits the current evidence to regression tests and the
observed incident log, not a machine-level candidate restart.

An update initiated by an older installed helper still executes that older
helper, even after npm installs the fixed package. Such devices can require one
final manual restart when upgrading to the fixed version. Subsequent updates use
the corrected helper. Never overwrite an already running copied worker.
