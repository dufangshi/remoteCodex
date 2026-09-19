# Matter workbench preview

This implementation moves thread navigation, account shortcuts, notifications,
and workspace tools into a Matter-inspired conversation shell. The composer
floats over the full-height transcript; a measured end spacer keeps the final
reply readable when scrolling to the bottom.

## Repository pairing

- Remote Codex branch: `feat/matter-workbench`, based on main
  `a5d27bc8df420f8c63bc16bbe0334320a18b3104`.
- Shared UI repository: `dufangshi/remote-codex-thread-ui-rust`, checked out at
  `remote-codex-thread-ui/` (not the similarly named sibling repository).
- Shared UI branch: `feat/matter-workbench`, based on main `db97668`.
- Required shared UI commit: `54367117497f07b03714558a99b1e21a4e2ee6d3`.
- Visual reference: [Matter Design System](https://github.com/the-matter-lab/matter-design-system),
  commit `08ff4d786c75a44e9ac5d223e7e9bfaf89233e99`, `app-ui.html`.
  The requester confirmed permission to reuse its styles. The implementation
  adopts its restrained colors, DM Sans, thin icons, navigation proportions,
  rounded composer, and execution timeline, adapted to Remote Codex controls.
- DM Sans is self-hosted under `apps/supervisor-web/public/fonts/`; its OFL
  license is included alongside the font.

## Local preview

The preview started for this review uses Web port `4327` and API port `8827`.
Open `/threads/db12c8ed-35d9-49d4-878e-6a338a59435f` for the seeded long-reply
and expandable execution timeline example.

- Local URL: <http://localhost:4327>.
- Tailscale URL for a connected device: <http://100.77.247.48:4327>.
- Isolated database: `.local/matter-preview.sqlite`.
- Isolated workspaces: `.local/matter-preview-workspaces/`.
- The test supervisor uses the fake runtime with inherited `REMOTE_CODEX_*`
  environment variables removed. Demo commands and replies are fixtures, not
  real model runs. The active host supervisor was not restarted or updated.

The local preview has no Relay account: shortcuts persist in that browser's
local storage. All three action buttons remain visible; Relay share-link and
permission dialogs explain why an account connection is needed. In Relay
mode, shortcuts and recents persist per account through
`/relay/account/workbench`, keyed by both device ID and thread ID. Access is
checked again when loading saved references. Remote status refresh uses
explicit device URLs, bounded concurrency, and timeouts.

The refinement uses 34 px desktop thread tabs, compact command rows with check
icons and actual event timestamps, and responsive middle-truncated paths with
conventional home prefixes replaced by `~`. Link, permissions, and HTML export
open separate dialogs using the workbench's light/dark palette. Opening the
link action creates one snapshot and copies its URL, retaining a manual copy
fallback when clipboard access is unavailable.

Thread indicators distinguish running (blue spinner), completed/unread (green
dot), idle/read (gray ring), failed (red diamond), interrupted (amber square),
and unavailable (dotted ring). Read markers identify the last viewed completion,
not a browser clock timestamp. Only viewing a focused, visible thread writes
the marker; favorites and background refreshes preserve unread status. Relay
stores markers per account/device/thread and prevents older acknowledgements
from moving them backwards. Local previews use browser storage.

The bell reuses retained Relay completion/failure events. Server-side events
require a verifiable device/thread grant; a browser-supplied workspace label
or ID cannot authorize reading an event. Workspace-only grantees can save
shortcuts, but their event feed awaits a trusted thread-to-workspace binding.
Existing Relay retention is 24 hours. Search loads conversation history and
shows matching message excerpts; it does not currently jump to a turn.

## Verification

Completed checks:

- Shared UI package build and main Web typecheck/production build.
- `cargo test -p remote-codex-relay workbench --lib`: two passing tests for
  account/device isolation, preserved favorites, sharing revocation,
  workspace grants, disabled accounts, and event authorization.
- Relay formatting and compilation checks.
- `useWorkbenchNavigation.test.tsx`: three passing tests covering identical
  thread IDs on different devices, explicit remote status polling, favorite
  writes, status mapping, and focus-dependent read acknowledgement.
- `ThreadPublicLinks.test.tsx`: two passing tests covering exactly one
  snapshot creation under StrictMode, automatic copy, a late list response,
  and clipboard failure with manual URL recovery.
- Shared `ExportTranscriptDialog.test.tsx`: nine passing existing regressions.
- `e2e/matter-workbench.spec.ts`: two desktop Chromium tests and the focused
  core-flow test in mobile Chromium. These cover composer overlay geometry,
  the visible end of a long reply, favorites after reload, search,
  notifications, Explorer, download, Terminal plugin gating and actual
  terminal switching, rename, Home navigation, and expandable command steps.
  The refinement additionally verifies an actual HTML download, all three
  action entry points, compact row/tab heights, step times/check icons, and
  home-relative middle truncation. Dialog light/dark screenshots were also
  inspected in the browser.

With the isolated services running, reproduce the desktop checks using:

```sh
E2E_API_PORT=8827 E2E_WEB_PORT=4327 \
E2E_DATABASE_URL=.local/matter-preview.sqlite \
E2E_WORKSPACE_ROOT=.local/matter-preview-workspaces \
pnpm exec playwright test e2e/matter-workbench.spec.ts --project=desktop-chromium
```

For the mobile flow, use the same environment with
`--project=mobile-chromium --grep 'Matter workbench floats'`.
Run these only against the isolated fake runtime: the tests create fixture
threads, toggle that instance's Terminal setting, and seed its database.

Screenshots are generated under `output/playwright/` as
`matter-preview-light.png`, `matter-preview-dark.png`, and
`matter-workbench-mobile-chromium.png`.

This branch is a local review build. No production deployment or runtime
release has been performed. A later Relay deployment must include the paired
shared UI commit above as `thread_ui_sha`.
