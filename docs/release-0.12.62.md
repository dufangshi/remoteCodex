# Remote Codex 0.12.62

Account settings now offer two message shortcut modes. The default keeps Ctrl+Enter
for sending and adds Ctrl+Shift+Enter for immediate steer. Enter-to-send mode uses
Shift+Enter for a newline and Ctrl+Enter for steer. macOS Command works as well.
The preference is authenticated and persisted on the Relay per account, shared
across devices and browsers. Composition and repeat safeguards remain in place.
Direct steer uses the saved message's own receipt; failed confirmation retains the
durable message without encouraging a duplicate submission.

A running turn's top summary shows its cumulative average output speed; its footer
continues to show the latest confirmed speed. Both use reported output tokens and
model response intervals, including response latency and excluding tool/user waits.

Watch cards show creation time, recorded trigger counts and accumulated turn costs.
Long prompts and raw scheduling details expand on demand. Past watches are grouped
under a collapsed section. Costs sum the existing per-turn estimates across all
persisted scheduled turns, including older chat pages, and share the turn's token
breakdown component. Missing usage and ambiguous overlapping watch lifetimes are
reported explicitly. Ordinary manual messages cannot increase watch statistics.
Opening the dialog does not automatically open the price tooltip; touch toggling
now accounts for focus arriving between pointer-up and click.

Deploy the Relay Web with the pinned shared UI revision for account shortcuts,
speed display and compact watches. Upgrade each device's running Supervisor to
0.12.62 for watch counts and costs. Older devices show unavailable statistics,
while creation time and compact details continue to work. Recorded scheduled turns
with final results are counted; still-running native turns are not included early.

Validation: 13 targeted Rust regressions (account preferences, watch aggregation and
scheduled history recovery), 8 Web tests, 40 shared UI tests, account synchronization
and direct steer in desktop Chromium, and watch summaries and real touch behavior
in mobile Chromium. Rust formatting/compilation, UI type checks and production
builds passed. The release gate validates workspace tests and all four supported
native assets.

Shared UI: `dufangshi/remote-codex-thread-ui-rust@ffbe09deb36f568db7824843913add3cd465b241`.
