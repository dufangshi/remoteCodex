# Control Plane Thread UI Integration Checklist

This checklist tracks the downstream integration of the main-branch
`@remote-codex/thread-ui` package into the `sandbox-worker-control-plane`
branch.

Use this document as the working board in goal mode. Check a task only after
the implementation, verification, and evidence note exist in this repository.

## Goal

Replace the custom control-plane session chat composition with the canonical
Remote Codex thread UI exported by `@remote-codex/thread-ui`.

After this integration, the control-plane session page should own only
control-plane-specific controller logic:

- auth and stored control-plane session token handling
- project, workspace, session, sandbox, and route-token loading
- worker-thread fetch and prompt submit through the sandbox router
- control-plane session to thread DTO mapping
- control-plane meta/settings slots
- router/session adapters passed into `ThreadDetailSurface`

The control-plane branch should not copy or manually recompose main thread UI
layout code.

## Non-Goals

- Do not redesign the thread UI.
- Do not fork `@remote-codex/thread-ui` into control-plane-local components.
- Do not implement remote shell transport unless the sandbox router worker shell
  API contract exists and is testable.
- Do not remove the project level in this task.
- Do not change the control-plane auth model or route-token security model.
- Do not publish `@remote-codex/thread-ui` to an external registry; this task
  uses the monorepo workspace package.

## Completion Rules

- Do not check a task because it is planned.
- Check a task only after code, tests, smoke checks, or a deliberately scoped
  documentation deliverable has landed.
- Add a short evidence note when checking a phase:

```text
Evidence:
- Files: <main files>
- Verification: <commands or smoke checks>
- Residual risk: <what remains unchecked>
```

- Keep deployment tasks unchecked until the GitHub workflow and staging UI have
  actually been exercised.

## Reference Commands

Run focused checks after each implementation slice and broader checks before
handoff.

```bash
git fetch origin
git merge origin/main
pnpm --filter @remote-codex/thread-ui typecheck
pnpm --filter @remote-codex/thread-ui build
pnpm --filter @remote-codex/supervisor-web typecheck
pnpm --filter @remote-codex/supervisor-web test -- ControlPlaneSessionPage
pnpm --filter @remote-codex/supervisor-web test -- ThreadDetailPage ControlPlaneSessionPage
pnpm --filter @remote-codex/supervisor-web test
```

If deployment is needed:

```bash
git push origin sandbox-worker-control-plane
gh workflow run staging-images.yml --ref sandbox-worker-control-plane
gh run list --workflow staging-images.yml --branch sandbox-worker-control-plane --limit 5
```

## Architecture Target

```text
ControlPlaneSessionPage
  -> control-plane auth/session/router-token controller
  -> ControlPlaneSession to ThreadDto sidebar mapper
  -> worker ThreadDetailDto fetched through sandbox router
  -> ControlPlaneThreadAdapter
  -> ThreadDetailSurface from @remote-codex/thread-ui
```

The target page imports the shared UI surface and public types from:

```ts
import {
  ThreadDetailSurface,
  usePlugins,
  type ThreadComposerProps,
  type ThreadDetailUiAdapter,
  type ThreadTimelineProps,
} from '@remote-codex/thread-ui';
```

The target page does not directly render these shared components:

```ts
ThreadWorkspaceLayout
ThreadTimeline
ThreadComposer
ThreadShellPanel
```

## Phase 1: Merge Main Thread UI Package

Goal: bring `@remote-codex/thread-ui` into `sandbox-worker-control-plane`
without losing control-plane changes.

### Tasks

- [x] Fetch latest origin refs.
  - Acceptance: `origin/main` points at or after the `Extract thread UI package`
    commit.
  - Verification: `git log --oneline -3 origin/main` shows the thread UI package
    extraction commit.

- [x] Merge `origin/main` into `sandbox-worker-control-plane`.
  - Acceptance: merge completes without unresolved conflicts.
  - Verification: `git status --short --branch` shows the current branch and no
    unmerged paths.

- [x] Preserve control-plane branch behavior during conflict resolution.
  - Acceptance: control-plane routes, auth pages, sandbox lifecycle UI, router
    direct calls, and staging CI/CD files remain present after the merge.
  - Verification: inspect conflict files and run focused typecheck.

- [x] Confirm `@remote-codex/thread-ui` package is available.
  - Acceptance: `packages/thread-ui/package.json` exists and
    `apps/supervisor-web/package.json` depends on
    `@remote-codex/thread-ui: workspace:*`.
  - Verification:
    ```bash
    test -f packages/thread-ui/package.json
    rg -n '"@remote-codex/thread-ui"' apps/supervisor-web/package.json pnpm-lock.yaml
    ```

- [x] Confirm Tailwind scans the package source.
  - Acceptance: `apps/supervisor-web/src/index.css` includes
    `@source "../../../packages/thread-ui/src/**/*.{ts,tsx}";`.
  - Verification:
    ```bash
    rg -n 'packages/thread-ui/src' apps/supervisor-web/src/index.css
    ```

### Evidence

- Files: `packages/thread-ui/**`,
  `apps/supervisor-web/package.json`,
  `apps/supervisor-web/src/index.css`,
  `pnpm-lock.yaml`.
- Verification:
  - `git log --oneline -5 origin/main` includes
    `90b7d2d Extract thread UI package` and
    `fcf6aa3 Optimize thread history loading`.
  - `pnpm --filter @remote-codex/thread-ui typecheck`
  - `pnpm --filter @remote-codex/thread-ui build`
  - `pnpm --filter @remote-codex/supervisor-web typecheck`
- Residual risk: merge commit and deployment are tracked in Phase 8.

## Phase 2: Define Control-Plane Adapter Boundary

Goal: isolate all control-plane-specific behavior behind adapter callbacks and
DTO mapping.

### Tasks

- [x] Keep `ControlPlaneSession.id` as the product navigation id.
  - Acceptance: sidebar rows and control-plane route navigation use
    `/control-plane/sessions/:sessionId`.
  - Verification: tests cover clicking or rendering a sidebar session link.

- [x] Keep `ControlPlaneSession.workerSessionId` as the worker thread id.
  - Acceptance: worker fetch, prompt submit, image assets, and thread detail
    refresh use `workerSessionId`.
  - Verification: tests assert router requests target the worker thread id.

- [x] Create a typed control-plane thread adapter.
  - Acceptance: adapter satisfies `ThreadDetailUiAdapter`.
  - Required operations:
    - `openThread(threadId)`
    - `getThreadHref(threadId)`
    - `getNewThreadHref()`
    - `sendPrompt(input)`
    - `getImageAssetUrl(path)` if remote image assets are supported
    - `shell: null` until remote shell transport exists
  - Verification: TypeScript catches missing or misspelled adapter methods.

- [x] Keep route-token API calls outside `@remote-codex/thread-ui`.
  - Acceptance: `createControlPlaneRouteToken`,
    `fetchControlPlaneWorkerThread`, and
    `sendControlPlaneWorkerThreadPrompt` are called only from the control-plane
    controller or adapter layer.
  - Verification:
    ```bash
    rg -n 'fetchControlPlaneWorkerThread|sendControlPlaneWorkerThreadPrompt|createControlPlaneRouteToken' apps/supervisor-web/src/pages apps/supervisor-web/src/lib
    rg -n 'ControlPlane|routeToken|sandbox router|api/sandboxes' packages/thread-ui/src || true
    ```

- [x] Preserve reconnect behavior for missing worker threads.
  - Acceptance: `404` or `409` from worker thread fetch/prompt still triggers
    session reconnect and retry where currently supported.
  - Verification: focused tests cover the reconnect path.

### Evidence

- Files: `apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx`,
  `apps/supervisor-web/src/pages/ControlPlaneSessionPage.test.tsx`,
  `packages/thread-ui/src/adapters.ts`.
- Verification:
  - `pnpm --filter @remote-codex/supervisor-web typecheck`
  - `pnpm --filter @remote-codex/supervisor-web test -- ControlPlaneSessionPage`
  - `rg -n 'fetchControlPlaneWorkerThread|sendControlPlaneWorkerThreadPrompt|createControlPlaneRouteToken' apps/supervisor-web/src/pages apps/supervisor-web/src/lib`
  - `rg -n 'ControlPlane|routeToken|sandbox router|api/sandboxes|control-plane' packages/thread-ui/src` produced no matches.
- Residual risk: none for the adapter boundary; real shell transport remains a
  Phase 9 follow-up.

## Phase 3: Replace Manual UI Composition

Goal: replace the custom session page layout/timeline/composer JSX with
`ThreadDetailSurface`.

### Tasks

- [x] Replace local component imports in `ControlPlaneSessionPage`.
  - Remove direct imports from:
    - `../components/ThreadComposer`
    - `../components/ThreadTimeline`
    - `../components/ThreadWorkspaceLayout`
    - `../components/ThreadShellPanel` unless only importing a public type
      re-exported by `@remote-codex/thread-ui`
  - Import shared surface and public types from `@remote-codex/thread-ui`.
  - Verification:
    ```bash
    rg -n 'ThreadWorkspaceLayout|ThreadTimeline|ThreadComposer|ThreadDetailSurface|@remote-codex/thread-ui' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
    ```

- [x] Convert current timeline props into `timelineProps`.
  - Acceptance: current values are preserved:
    - `scrollRequestKey`
    - `onTailVisibilityChange`
    - `answeredRequestNotes`
    - `activityNotes`
    - `pendingSteers`
    - `className` if still required
  - Verification: rendered timeline still shows existing worker turns and
    follows refresh updates.

- [x] Convert chat composer props into `composerProps`.
  - Acceptance: current values are preserved:
    - `busy`
    - `error`
    - `model`
    - `reasoningEffort`
    - `fastMode`
    - `collaborationMode`
    - `contextUsage`
    - `capabilities`
    - `followTail`
    - `threadConnected`
    - `shellAvailable`
    - `disabled` and `disabledPlaceholder`
    - `draftPrompt` and `draftAttachments`
    - `onDraftChange`
    - `onToggleView`
    - `onToggleFollow`
  - Verification: prompt submit still clears the draft and calls the router.

- [x] Convert shell composer props into `shellComposerProps`.
  - Acceptance: shell mode remains explicitly unavailable until a real
    `ControlPlaneShellAdapter` exists.
  - Verification: tests assert shell view shows the unavailable message and does
    not try to open a local `/ws` connection.

- [x] Pass control-plane meta and settings slots to `ThreadDetailSurface`.
  - Acceptance: current session metadata and plugin controls remain visible in
    the surface settings/meta areas.
  - Verification: tests assert Control Session, Worker Thread, Sandbox, Router,
    and plugin controls render after page load.

- [x] Pass `currentThreadId={session?.id}` into `ThreadDetailSurface`.
  - Acceptance: sidebar active state uses the control-plane session id, not the
    worker thread id.
  - Verification: active sidebar state remains correct when `session.id` and
    `workerSessionId` differ.

- [x] Remove manual `ThreadWorkspaceLayout` JSX from
  `ControlPlaneSessionPage`.
  - Acceptance: the page renders exactly one `<ThreadDetailSurface ... />`.
  - Verification:
    ```bash
    rg -n '<ThreadWorkspaceLayout|<ThreadTimeline|<ThreadComposer|<ThreadDetailSurface' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
    ```

### Evidence

- Files: `apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx`,
  `packages/thread-ui/src/ThreadDetailSurface.tsx`.
- Verification:
  - `pnpm --filter @remote-codex/supervisor-web test -- ControlPlaneSessionPage`
  - `pnpm --filter @remote-codex/supervisor-web test -- ThreadDetailPage ControlPlaneSessionPage`
  - `rg -n '<ThreadWorkspaceLayout|<ThreadTimeline|<ThreadComposer|ThreadDetailSurface|@remote-codex/thread-ui' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx` shows only the package import/type usage and one `<ThreadDetailSurface />`.
- Residual risk: none for manual composition removal.

## Phase 4: Preserve Plugins And XYZ Viewer

Goal: keep the plugin system shared with main and avoid hardcoded local plugin
settings.

### Tasks

- [x] Use `usePlugins` from `@remote-codex/thread-ui`.
  - Acceptance: control-plane session page no longer imports
    `../plugins/usePlugins` directly after the main package is available.
  - Verification:
    ```bash
    rg -n "from '../plugins/usePlugins'|from '@remote-codex/thread-ui'" apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
    ```

- [x] Show all registered plugins in settings.
  - Acceptance: Terminal and XYZ Molecule Viewer both appear when registered.
  - Verification: focused test asserts `XYZ Molecule Viewer` is visible in the
    control-plane session settings.

- [x] Keep Terminal plugin behavior honest.
  - Acceptance: enabling Terminal exposes shell mode controls, but the shell
    panel clearly says remote shell transport is unavailable while
    `adapter.shell` is null.
  - Verification: focused test covers terminal enabled plus unavailable remote
    shell copy.

- [x] Keep XYZ artifact and inline rendering package-owned.
  - Acceptance: control-plane does not implement a second XYZ renderer.
  - Verification:
    ```bash
    rg -n 'Xyz|XYZ|molecule' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
    ```
    Any match must be a test fixture, assertion, or plugin display text, not a
    local renderer implementation.

### Evidence

- Files: `apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx`,
  `apps/supervisor-web/src/pages/ControlPlaneSessionPage.test.tsx`,
  `packages/thread-ui/src/plugins/**`,
  `apps/supervisor-web/src/app.tsx`.
- Verification:
  - `pnpm --filter @remote-codex/supervisor-web test -- ControlPlaneSessionPage`
  - Focused test asserts Terminal and XYZ Molecule Viewer are visible.
  - Focused test wraps the page in `PluginProvider` and verifies plugin toggle
    calls the provider update path.
  - Focused test asserts shell mode shows the unavailable message and does not
    attempt `/ws`.
  - `rg -n 'Xyz|XYZ|molecule' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx apps/supervisor-web/src/pages/ControlPlaneSessionPage.test.tsx`
    only matches workspace/test fixture text and the XYZ plugin assertion.
- Residual risk: none for package-owned plugin display; real shell transport
  remains out of scope.

## Phase 5: Worker Assets And Router URLs

Goal: ensure shared thread UI can render remote worker assets without local API
assumptions.

### Tasks

- [x] Audit image and artifact URLs in worker thread detail.
  - Acceptance: determine whether worker turns include image attachment paths
    that require `getImageAssetUrl`.
  - Verification: inspect existing worker thread DTO fixtures and router API
    helpers.

- [x] Add or confirm a control-plane image asset URL builder.
  - Acceptance: if needed, the builder uses the route token router base URL and
    worker thread id.
  - Verification: test asserts asset URL goes through
    `/api/sandboxes/:sandboxId/...` on the sandbox router, not the control-plane
    API.

- [x] Pass `getImageAssetUrl` through `ThreadDetailUiAdapter`.
  - Acceptance: `ThreadTimeline` receives image URLs through the package
    adapter boundary.
  - Verification: focused test covers an image item if a fixture exists; if not,
    record the limitation in evidence.

### Evidence

- Files: `apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx`,
  `apps/supervisor-web/src/pages/ControlPlaneSessionPage.test.tsx`,
  `packages/thread-ui/src/ThreadDetailSurface.tsx`,
  `packages/thread-ui/src/components/ThreadTimeline.tsx`.
- Verification:
  - `pnpm --filter @remote-codex/supervisor-web test -- ControlPlaneSessionPage`
  - Focused test includes a worker image history item and asserts its `src`
    uses `${routerBaseUrl}/api/sandboxes/sandbox-1/api/threads/worker-session-1/assets/image?...`.
  - `rg -n 'getImageAssetUrl|assets/image' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx apps/supervisor-web/src/lib/api.ts packages/thread-ui/src`
    shows the adapter-owned URL builder and package adapter usage.
- Residual risk: artifact-specific remote asset shapes beyond image history
  items should be covered when new worker DTO fixtures are added.

## Phase 6: Tests

Goal: prove control-plane behavior survived the package integration.

### Tasks

- [x] Update `ControlPlaneSessionPage.test.tsx` imports and mocks.
  - Acceptance: tests use the real package where possible and only mock heavy
    browser-only behavior if required.
  - Verification: test file compiles.

- [x] Cover initial session open.
  - Acceptance: session page loads auth, sandbox, project, workspace, session,
    route token, worker thread, and renders the worker turn.
  - Verification: focused test passes.

- [x] Cover prompt submit through sandbox router.
  - Acceptance: sending a prompt posts to the router worker prompt endpoint and
    clears the draft after success.
  - Verification: focused test passes.

- [x] Cover reconnect after worker thread not found.
  - Acceptance: `404` or `409` from router fetch/prompt triggers session resume,
    new route token creation, and worker thread refetch.
  - Verification: focused test passes.

- [x] Cover plugin settings.
  - Acceptance: settings list all registered plugins and plugin toggle calls the
    plugin provider path.
  - Verification: focused test passes.

- [x] Cover remote shell unavailable state.
  - Acceptance: shell mode does not attempt local shell sockets and shows the
    remote shell unavailable state.
  - Verification: focused test passes.

- [x] Run package and supervisor-web checks.
  - Verification:
    ```bash
    pnpm --filter @remote-codex/thread-ui typecheck
    pnpm --filter @remote-codex/thread-ui build
    pnpm --filter @remote-codex/supervisor-web typecheck
    pnpm --filter @remote-codex/supervisor-web test -- ControlPlaneSessionPage
    pnpm --filter @remote-codex/supervisor-web test -- ThreadDetailPage ControlPlaneSessionPage
    ```

### Evidence

- Files: `apps/supervisor-web/src/pages/ControlPlaneSessionPage.test.tsx`,
  `apps/supervisor-web/src/pages/ThreadDetailPage.test.tsx`,
  `apps/supervisor-web/src/components/ThreadComposer.test.tsx`.
- Verification:
  - `pnpm --filter @remote-codex/thread-ui typecheck`
  - `pnpm --filter @remote-codex/thread-ui build`
  - `pnpm --filter @remote-codex/supervisor-web typecheck`
  - `pnpm --filter @remote-codex/supervisor-web test -- ControlPlaneSessionPage`
  - `pnpm --filter @remote-codex/supervisor-web test -- ThreadDetailPage ControlPlaneSessionPage`
  - `pnpm --filter @remote-codex/supervisor-web test`
  - `pnpm --filter @remote-codex/supervisor-api typecheck`
  - `pnpm --filter @remote-codex/supervisor-api test`
- Residual risk: staging browser smoke remains Phase 8.

## Phase 7: Static Guardrails

Goal: prevent future code drift back to copied main UI.

### Tasks

- [x] Add or document a static check for forbidden manual composition in
  `ControlPlaneSessionPage`.
  - Acceptance: future regressions are easy to catch with `rg` or a focused
    test.
  - Verification:
    ```bash
    rg -n '<ThreadWorkspaceLayout|<ThreadTimeline|<ThreadComposer|from "../components/Thread' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx
    ```
    Expected result: no matches, except intentionally documented type-only
    imports if unavoidable.

- [x] Add or document a static check that `packages/thread-ui` remains
  control-plane-agnostic.
  - Acceptance: the shared package does not import control-plane APIs, router
    helpers, or route-token types.
  - Verification:
    ```bash
    rg -n 'ControlPlane|routeToken|sandbox router|api/sandboxes|control-plane' packages/thread-ui/src || true
    ```
    Any match must be reviewed and justified.

- [x] Keep app wrappers thin.
  - Acceptance: app-local `ThreadComposer`, `ThreadTimeline`,
    `ThreadWorkspaceLayout`, plugin wrappers, and dialog wrappers remain simple
    re-exports from `@remote-codex/thread-ui` after merging main.
  - Verification:
    ```bash
    sed -n '1,40p' apps/supervisor-web/src/components/ThreadComposer.tsx
    sed -n '1,40p' apps/supervisor-web/src/components/ThreadTimeline.tsx
    sed -n '1,40p' apps/supervisor-web/src/components/ThreadWorkspaceLayout.tsx
    ```

### Evidence

- Files: `docs/thread-ui-control-plane-integration-checklist.md`,
  `apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx`,
  `apps/supervisor-web/src/components/ThreadComposer.tsx`,
  `apps/supervisor-web/src/components/ThreadTimeline.tsx`,
  `apps/supervisor-web/src/components/ThreadWorkspaceLayout.tsx`.
- Verification:
  - `rg -n '<ThreadWorkspaceLayout|<ThreadTimeline|<ThreadComposer|from "../components/Thread' apps/supervisor-web/src/pages/ControlPlaneSessionPage.tsx`
    produced no matches.
  - `rg -n 'ControlPlane|routeToken|sandbox router|api/sandboxes|control-plane' packages/thread-ui/src || true`
    produced no matches.
  - `sed -n '1,40p' apps/supervisor-web/src/components/ThreadComposer.tsx`
  - `sed -n '1,40p' apps/supervisor-web/src/components/ThreadTimeline.tsx`
  - `sed -n '1,40p' apps/supervisor-web/src/components/ThreadWorkspaceLayout.tsx`
- Residual risk: keep these `rg` checks in future review until an automated
  lint/test guard is added.

## Phase 8: Deployment And Staging Smoke

Goal: prove the integrated UI works in the deployed control-plane environment.

### Tasks

- [ ] Commit the integration.
  - Acceptance: commit message names the thread-ui integration.
  - Verification:
    ```bash
    git status --short
    git log --oneline -1
    ```

- [ ] Push `sandbox-worker-control-plane`.
  - Acceptance: remote branch contains the integration commit.
  - Verification:
    ```bash
    git push origin sandbox-worker-control-plane
    ```

- [ ] Trigger or observe staging CI/CD.
  - Acceptance: `staging-images.yml` runs for the branch if changed paths match
    the workflow trigger.
  - Verification: record GitHub Actions run URL.

- [ ] Smoke staging control-plane session open.
  - Acceptance: opening a control-plane session shows the shared Remote Codex
    thread UI surface.
  - Verification: staging URL, browser check, and screenshot if available.

- [ ] Smoke staging prompt submit.
  - Acceptance: prompt reaches the worker through the sandbox router and a reply
    appears or the running state updates then completes.
  - Verification: staging URL, session id, expected request path, and result.

- [ ] Smoke plugin settings.
  - Acceptance: Terminal and XYZ Molecule Viewer are visible in settings.
  - Verification: staging URL and screenshot if available.

- [ ] Smoke remote shell unavailable state.
  - Acceptance: switching to shell mode clearly shows remote shell transport is
    unavailable and does not fail with a local websocket error.
  - Verification: staging URL and screenshot if available.

### Evidence

- Files:
- Verification:
- Residual risk:

## Phase 9: Follow-Up After Integration

These items should remain unchecked unless they are explicitly implemented
after the package integration lands.

- [ ] Implement `ControlPlaneShellAdapter` after the sandbox router exposes a
  tested worker shell transport.
- [ ] Add package-local tests for `ThreadDetailSurface` if repeated downstream
  regressions appear.
- [ ] Move thread-specific CSS from `apps/supervisor-web/src/index.css` into a
  package stylesheet if another host app needs to consume `@remote-codex/thread-ui`
  without supervisor-web CSS.
- [ ] Add a small adapter test utility for downstream pages that consume
  `ThreadDetailSurface`.
- [ ] Revisit the project/workspace/session hierarchy as a separate product and
  migration task, not as part of this UI integration.

## Final Acceptance Criteria

- [x] `sandbox-worker-control-plane` includes `@remote-codex/thread-ui` from
  main.
- [x] `ControlPlaneSessionPage` renders `ThreadDetailSurface`.
- [x] `ControlPlaneSessionPage` no longer manually composes
  `ThreadWorkspaceLayout`, `ThreadTimeline`, or `ThreadComposer`.
- [x] Control-plane route navigation uses `ControlPlaneSession.id`.
- [x] Worker router requests use `ControlPlaneSession.workerSessionId`.
- [x] Prompt submit still reaches the sandbox router and receives worker
  updates.
- [x] Plugin settings show all registered package plugins, including Terminal
  and XYZ Molecule Viewer.
- [x] Remote shell remains explicitly unavailable until a real shell adapter is
  implemented.
- [x] Focused and broad supervisor-web checks pass.
- [ ] Staging smoke verifies session open, prompt submit, plugins, and shell
  unavailable state.
