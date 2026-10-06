# Remote Codex 0.12.59

Work summaries now count individual recorded work items rather than grouped rows or the number of deferred items. Expanding, collapsing, or hiding reasoning keeps the step count consistent.

Completed turns retain their final status when an earlier running detail is cached or live items remain buffered. The work summary and running footer stop indicating work when the turn completes.

Mobile work summaries wrap within the viewport, preventing horizontal conversation scrolling. Price tooltips use a small triangle matching the panel background instead of a rotated dark block.

Shared UI: `dufangshi/remote-codex-thread-ui-rust@c365cc474ba66c0efff626f2b980f394e4a32365`.

Validation: targeted component regressions, mobile Chromium at 393px and 320px, desktop Chromium completion and price-hover regression, shared UI typecheck and build. The release workflow verifies Rust tests, builds all four supported native platforms, and verifies the packaged launcher before publishing.

The Claude ACP `incomplete_tool_call` issue diagnosed during steering is not changed by this release.
