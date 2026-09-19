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
- Required shared UI commit: `98bcf9405d9641694be7878ab28b682f7048e0d6`.
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
local storage, and Relay share-link/permission controls are hidden. In Relay
mode, shortcuts and recents persist per account through
`/relay/account/workbench`, keyed by both device ID and thread ID. Access is
checked again when loading saved references. Remote status refresh uses
explicit device URLs, bounded concurrency, and timeouts.

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
- `useWorkbenchNavigation.test.tsx`: one passing test covering identical
  thread IDs on different devices, explicit remote status polling, and
  device-scoped favorite writes.
- `e2e/matter-workbench.spec.ts`: two desktop Chromium tests and the focused
  core-flow test in mobile Chromium. These cover composer overlay geometry,
  the visible end of a long reply, favorites after reload, search,
  notifications, Explorer, download, Terminal plugin gating and actual
  terminal switching, rename, Home navigation, and expandable command steps.

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
