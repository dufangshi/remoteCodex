# Extract `@remote-codex/thread-ui` Checklist

This checklist tracks the extraction of the main-branch Remote Codex thread experience into a reusable workspace package named `@remote-codex/thread-ui`.

Rule: when an item is completed, update this document in the same change and mark that item with `[x]`. A task is not complete until its checkbox is checked here and its verification note or test result is recorded.

## Goal

Package the existing main-branch thread UI into `packages/thread-ui` so downstream branches, including `sandbox-worker-control-plane`, can embed the same thread experience through adapters instead of copying `ThreadDetailPage.tsx` and related components.

The refactor must preserve current `/threads/:id` behavior in `apps/supervisor-web`. This is an extraction and adapter-boundary task, not a redesign.

## Non-Goals

- Do not implement the control-plane remote adapter in main.
- Do not move control-plane code into `packages/thread-ui`.
- Do not redesign the thread UI.
- Do not remove project, workspace, or session control-plane concepts.
- Do not rewrite all `ThreadDetailPage` state management unless necessary for the extraction.

## Phase 1: Baseline Audit

- [x] Record the current thread UI files and their imports.
  - Verify: list all imports for `ThreadDetailPage.tsx`, `ThreadTimeline.tsx`, `ThreadComposer.tsx`, `ThreadWorkspaceLayout.tsx`, and plugin files.
  - Verify: identify direct dependencies on `../lib/api`, `react-router-dom`, `/api/threads`, `/ws`, `window.location`, app-local storage keys, and app-local route strings.

- [x] Record current behavior that must remain unchanged.
  - Verify: note the current `/threads/:id` shell, timeline, composer, settings/meta controls, plugin rendering, artifact rendering, image rendering, and linked-thread navigation behavior.
  - Verify: run or identify existing tests that cover the current core thread experience before extraction.

- [x] Confirm the existing workspace package conventions.
  - Verify: inspect nearby `packages/*/package.json` and `tsconfig.json` files.
  - Verify: document the local package dependency style used for React, `@remote-codex/shared`, plugin packages, tests, and build/typecheck scripts.

## Phase 2: Create `packages/thread-ui`

- [x] Create the workspace package directory.
  - Required files:
    - `packages/thread-ui/package.json`
    - `packages/thread-ui/tsconfig.json`
    - `packages/thread-ui/src/index.ts`
    - `packages/thread-ui/src/types.ts`
    - `packages/thread-ui/src/adapters.ts`
    - `packages/thread-ui/src/components/`
    - `packages/thread-ui/src/plugins/`
  - Verify: `pnpm --filter @remote-codex/thread-ui typecheck` can discover the package.

- [x] Set package identity and dependencies.
  - Required package name: `@remote-codex/thread-ui`.
  - Required dependencies: React and shared DTO types.
  - Allowed dependencies if workspace-addressable: `@remote-codex/shared`, `@remote-codex/plugin-terminal`, `@remote-codex/plugin-xyz-viewer`.
  - Verify: the package does not depend on `apps/supervisor-web`.

- [x] Export the initial public surface from `src/index.ts`.
  - Required exports:
    - `ThreadDetailSurface`
    - `ThreadWorkspaceLayout`
    - `ThreadTimeline`
    - `ThreadComposer`
    - adapter and prop types
    - plugin provider/context/hooks/builtin plugin exports
  - Verify: imports from `@remote-codex/thread-ui` work in `apps/supervisor-web`.

## Phase 3: Extract Shared Components

- [x] Move or package-copy `ThreadWorkspaceLayout.tsx` into `packages/thread-ui/src/components/`.
  - Verify: it compiles inside `@remote-codex/thread-ui`.
  - Verify: it no longer imports app-only modules.

- [x] Move or package-copy `ThreadTimeline.tsx` into `packages/thread-ui/src/components/`.
  - Verify: it compiles inside `@remote-codex/thread-ui`.
  - Verify: it no longer imports app-only modules.

- [x] Move or package-copy `ThreadComposer.tsx` into `packages/thread-ui/src/components/`.
  - Verify: it compiles inside `@remote-codex/thread-ui`.
  - Verify: composer behavior and attachments still work in supervisor web tests.

- [x] Move supporting thread component utilities.
  - Required files:
    - `threadPresentation.ts`
    - `markdownHeuristics.ts`
    - `LongTextDialog.tsx` if still used by timeline/composer
    - `ConfirmDialog.tsx` only if needed by exported surface
    - `ExportTranscriptDialog.tsx` only if needed by exported surface
  - Verify: no duplicated stale copies remain unless intentionally kept as temporary app wrappers.

- [x] Do not extract app shell navigation/settings unless strictly necessary.
  - Verify: `packages/thread-ui` does not own full app shell navigation.
  - Verify: app shell-specific code remains in `apps/supervisor-web`.

## Phase 4: Extract Plugin System

- [x] Move or package-copy plugin types and context into `packages/thread-ui/src/plugins/`.
  - Required files:
    - `plugin-types.ts`
    - `plugin-context.ts`
    - `usePlugins.ts`
    - `PluginProvider.tsx` or package-level equivalent
  - Verify: plugin state can still be provided by supervisor web.

- [x] Move or package-copy builtin plugin registration into the package.
  - Required files:
    - `builtin-plugin-modules.tsx`
    - `xyz-plugin-renderers.tsx`
  - Verify: `builtinFrontendPlugins` is exported.

- [x] Preserve Terminal plugin support.
  - Required builtin id: `remote-codex.terminal`.
  - Verify: shell availability is still controlled through plugin state.

- [x] Preserve XYZ Molecule Viewer plugin support.
  - Required builtin id: `remote-codex.xyz-viewer`.
  - Verify: XYZ inline and artifact renderers remain registered and enabled by default.

- [x] Preserve artifact and inline code plugin rendering.
  - Verify: timeline artifact rendering still uses plugin renderers.
  - Verify: inline code rendering still uses plugin renderers.

## Phase 5: Remove Package-Level App Couplings

- [x] Remove all direct `react-router-dom` imports from `packages/thread-ui`.
  - Verify: `rg -n "react-router-dom" packages/thread-ui` returns no matches.

- [x] Remove all direct imports from `apps/supervisor-web/src/lib/api.ts`.
  - Verify: `rg -n "lib/api|supervisor-web/src/lib/api|\\.\\./lib/api" packages/thread-ui` returns no matches.

- [x] Remove hardcoded local REST endpoints from `packages/thread-ui`.
  - Verify: `rg -n '"/api|/api/threads|/api/workspaces' packages/thread-ui` returns no package-level endpoint assumptions.

- [x] Remove hardcoded websocket endpoint assumptions from `packages/thread-ui`.
  - Verify: `rg -n '"/ws|/ws' packages/thread-ui` returns no package-level endpoint assumptions.

- [x] Remove hardcoded app-local thread route assumptions from `packages/thread-ui`.
  - Verify: no package code assumes `/threads/new`, `/threads/:id`, or `window.location.assign('/threads/...')`.

- [x] Remove app-local storage key assumptions from `packages/thread-ui`.
  - Verify: storage keys either remain in supervisor web or are adapter-provided.

## Phase 6: Make `ThreadWorkspaceLayout` Reusable

- [x] Add adapter-style navigation props.
  - Required props:
    - `getThreadHref?: (threadId: string) => string`
    - `onOpenThread?: (threadId: string) => void`
    - `newThreadHref?: string`
    - `newThreadLabel?: string`
    - `onNewThread?: () => void`
    - `renderThreadLink?: optional escape hatch if needed`
  - Verify: layout can navigate with callbacks when no router is available.

- [x] Make rename/delete controls conditional.
  - Verify: rename controls render only when rename handler props are provided.
  - Verify: delete controls render only when delete handler props are provided.

- [x] Keep supervisor web layout behavior unchanged.
  - Verify: `/threads/:id` thread list, active state, new-thread entry, rename, and delete behavior match before extraction.

## Phase 7: Make `ThreadTimeline` Adapter-Driven

- [x] Add a timeline adapter boundary.
  - Required shape, or a cleaner equivalent:
    ```ts
    interface ThreadTimelineAdapter {
      getImageAssetUrl?: (input: { threadId: string; path: string }) => string;
      onOpenLinkedThread?: (threadId: string) => void;
      onLoadHistoryItemDetail?: (itemId: string) => Promise<ThreadHistoryItemDto>;
    }
    ```
  - Verify: type is exported from `@remote-codex/thread-ui`.

- [x] Replace hardcoded local image asset URLs.
  - Verify: no package code hardcodes `/api/threads/:id/assets/image`.
  - Verify: supervisor web passes a local `getImageAssetUrl` adapter.

- [x] Replace linked-thread hard navigation.
  - Verify: no package code calls `window.location.assign('/threads/...')`.
  - Verify: linked-thread navigation goes through `onOpenLinkedThread` or equivalent callback.

- [x] Keep timeline behavior unchanged.
  - Verify: existing timeline tests still pass after moving/adapting the component.

## Phase 8: Make Shell Panel Adapter-Driven

- [x] Do not move current local-only `ThreadShellPanel` without a shell adapter boundary.
  - Verify: if `ThreadShellPanel` is extracted, it accepts `shellAdapter`; otherwise supervisor web owns the local panel until adapterization is complete.

- [x] Define and export a shell adapter interface.
  - Required shape, or a cleaner equivalent:
    ```ts
    interface ThreadShellAdapter {
      fetchState(threadId: string): Promise<ThreadShellStateDto>;
      createShell(threadId: string, input?: { cols?: number; rows?: number; label?: string }): Promise<ThreadShellStateDto>;
      terminateShell(shellId: string): Promise<ShellSessionDto>;
      updateShell(shellId: string, input: UpdateShellInput): Promise<ShellSessionDto>;
      connectSocket(handlers: ShellSocketHandlers): ShellSocketConnection;
    }
    ```
  - Verify: the interface does not mention local `/api` or `/ws` endpoints.

- [x] Create a supervisor-web local shell adapter.
  - Verify: local API and websocket calls remain in `apps/supervisor-web`.
  - Verify: `ThreadShellPanel` receives the local shell adapter from the app.

- [x] Preserve terminal plugin behavior.
  - Verify: shell panel availability still respects the Terminal plugin enablement state.

## Phase 9: Create `ThreadDetailSurface`

- [x] Implement and export `ThreadDetailSurface` from `@remote-codex/thread-ui`.
  - It should render:
    - `ThreadWorkspaceLayout`
    - thread detail surface container
    - realtime/status controls via props
    - `ThreadTimeline`
    - `ThreadComposer`
    - optional shell panel
    - meta/settings slots
    - plugin-aware artifact/inline renderers
  - Verify: it does not fetch local data directly.

- [x] Define and export `ThreadDetailSurfaceProps`.
  - Required inputs, or cleaner equivalent:
    - `threads: ThreadDto[]`
    - `detail: ThreadDetailDto | null`
    - `loading: boolean`
    - `error: string | null`
    - `status?: AgentRuntimeStatusDto | null`
    - `capabilities?: AgentProviderCapabilitiesDto | null`
    - `managementSchema?: AgentBackendManagementSchemaDto | null`
    - `plugins: PluginContextValue`
    - `adapter: ThreadDetailUiAdapter`
    - `metaContent?: ReactNode`
    - `settingsContent?: ReactNode`
    - `currentThreadId?: string`
    - `currentWorkspaceId?: string | null`
    - `currentWorkspaceLabel?: string | null`
  - Verify: downstream code can render the surface using only DTOs, plugin context, slots, and adapters.

- [x] Define and export `ThreadDetailUiAdapter`.
  - Required operations, or cleaner equivalent:
    - `openThread(threadId: string): void`
    - `getThreadHref?: (threadId: string) => string`
    - `getNewThreadHref?: (workspaceId?: string | null) => string`
    - `renameThread?: (threadId: string, title: string) => Promise<void>`
    - `deleteThread?: (thread: ThreadDto) => Promise<void> | void`
    - `sendPrompt(input: SendPromptInput): Promise<boolean | void>`
    - `interrupt?: () => Promise<void> | void`
    - `compact?: () => Promise<void> | void`
    - `updateSettings?: (input: UpdateThreadSettingsInput) => Promise<void> | void`
    - `loadHistoryItemDetail?: (itemId: string) => Promise<ThreadHistoryItemDto>`
    - `getImageAssetUrl?: (path: string) => string`
    - `shell?: ThreadShellAdapter | null`
  - Verify: the adapter boundary is stable, typed, and does not overfit supervisor-web internals.

## Phase 10: Migrate Supervisor Web To Consume The Package

- [x] Update `apps/supervisor-web` imports to consume `@remote-codex/thread-ui`.
  - Verify: `ThreadDetailPage.tsx` imports shared thread UI components/surface from the package.

- [x] Convert `ThreadDetailPage.tsx` into a local controller/container.
  - It should keep:
    - local data fetching
    - websocket handling
    - optimistic updates
    - goal state
    - hook state
    - MCP state
    - settings state
    - local route handling
  - Verify: local app-specific logic remains in supervisor web, not the package.

- [x] Pass prepared props and adapters into `ThreadDetailSurface`.
  - Verify: REST API calls remain in supervisor web adapters.
  - Verify: local websocket calls remain in supervisor web adapters.
  - Verify: router navigation remains in supervisor web adapters.
  - Verify: `ThreadDetailPage.tsx` renders `<ThreadDetailSurface ... />` directly instead of manually composing `ThreadWorkspaceLayout`, `ThreadTimeline`, `ThreadComposer`, and `ThreadShellPanel` in page JSX.

- [x] Keep `/threads/:id` visible behavior unchanged.
  - Verify: core timeline, composer, status controls, shell panel, settings/meta controls, errors, loading state, and mobile layout match current main behavior.
  - Verify: Tailwind scans `packages/thread-ui/src` from `apps/supervisor-web/src/index.css` so extracted utility classes such as `hidden`, `flex`, and `lg:grid` are generated.

## Phase 11: CSS And Styling

- [x] Decide the initial CSS strategy.
  - Option 1: keep CSS in `apps/supervisor-web/src/index.css` and document that `@remote-codex/thread-ui` requires those classes/tokens.
  - Option 2: move thread-specific CSS into `packages/thread-ui/src/styles.css` and import it from the app.
  - Verify: no new visual theme is introduced.

- [x] Preserve thread UI visual output.
  - Required coverage:
    - thread detail surface
    - thread timeline
    - thread composer
    - sidebar cards
    - empty/error/status surfaces
    - XYZ viewer styles if currently imported through plugin renderer
  - Verify: no redesign, palette change, spacing reset, or interaction styling regression.

- [x] Document CSS requirements if CSS remains app-owned.
  - Verify: package README or checklist notes explain required class/token imports.

## Phase 12: Tests And Static Verification

- [ ] Add or migrate package tests if component tests move into `packages/thread-ui`.
  - Verify: `pnpm --filter @remote-codex/thread-ui test` passes if tests are added.
  - Status: not applicable for this extraction because focused component tests remain in `apps/supervisor-web`.

- [x] Typecheck the new package.
  - Verify: `pnpm --filter @remote-codex/thread-ui typecheck` passes.

- [x] Typecheck supervisor web.
  - Verify: `pnpm --filter @remote-codex/supervisor-web typecheck` passes.

- [x] Run focused supervisor web thread-detail tests.
  - Verify: `pnpm --filter @remote-codex/supervisor-web test -- ThreadDetailPage` passes.

- [x] Run focused timeline/composer/plugin tests if they remain in supervisor web or move to thread-ui.
  - Verify: relevant package or app test commands pass.

- [x] Run full supervisor web tests.
  - Verify: `pnpm --filter @remote-codex/supervisor-web test` passes.

- [x] Run full repo typecheck if feasible.
  - Verify: record the exact command and result.

- [x] Verify forbidden package imports and endpoint strings.
  - Required commands:
    - `rg -n "react-router-dom" packages/thread-ui`
    - `rg -n "lib/api|supervisor-web/src/lib/api|\\.\\./lib/api" packages/thread-ui`
    - `rg -n '"/api|/api/threads|/api/workspaces|"/ws|/ws' packages/thread-ui`
    - `rg -n "window\\.location|/threads/new|/threads/" packages/thread-ui`
  - Verify: any match is either removed or explicitly justified as not an app coupling.

## Phase 13: Acceptance Criteria

- [x] `packages/thread-ui` exists and builds.
- [x] Package name is `@remote-codex/thread-ui`.
- [x] Main `ThreadDetailPage` consumes `@remote-codex/thread-ui`.
- [x] No file in `packages/thread-ui` imports from `apps/supervisor-web/src/lib/api.ts`.
- [x] No file in `packages/thread-ui` imports `react-router-dom`.
- [x] No file in `packages/thread-ui` hardcodes local supervisor REST endpoints.
- [x] No file in `packages/thread-ui` hardcodes local websocket endpoints.
- [x] Main branch `/threads/:id` behavior is unchanged.
- [x] Built-in Terminal plugin is available through the extracted package.
- [x] Built-in XYZ Molecule Viewer plugin is available through the extracted package.
- [x] Artifact and inline plugin renderers still work.
- [x] A downstream branch can import `ThreadDetailSurface`, provide a control-plane adapter, and get the same thread UI without copying `ThreadDetailPage.tsx`.

## Recommended Follow-Up After This Lands

- [ ] In `sandbox-worker-control-plane`, replace custom `ControlPlaneSessionPage` UI with `ThreadDetailSurface` from `@remote-codex/thread-ui`.
- [ ] Add `ControlPlaneThreadAdapter`.
- [ ] Add `ControlPlaneShellAdapter` after router shell transport exists.
- [ ] Add remote asset URL builder through sandbox router.
- [ ] Map control-plane session list data to `ThreadDto`.

## Verification Log

Record completed commands and review notes here as the extraction progresses.

- Created `packages/thread-ui` with package name `@remote-codex/thread-ui`, source components/plugins, adapter types, package README, and generated build output.
- Migrated `apps/supervisor-web` so `ThreadDetailPage.tsx`, app plugin provider usage, and app navigation plugin access consume `@remote-codex/thread-ui`.
- Kept supervisor-web controller responsibilities local: REST API helpers, supervisor websocket, shell websocket, router navigation, optimistic updates, goals, MCP, hooks, settings, and local storage persistence remain in `apps/supervisor-web`.
- Added app-local wrapper compatibility for old component import paths while keeping package code free of app router/API assumptions.
- CSS strategy: thread-specific CSS remains in `apps/supervisor-web/src/index.css` for this extraction; `packages/thread-ui/README.md` documents the required host classes/tokens.
- Static forbidden checks on `packages/thread-ui` all returned no matches:
  - `rg -n "react-router-dom" packages/thread-ui`
  - `rg -n "lib/api|supervisor-web/src/lib/api|\\.\\./lib/api" packages/thread-ui`
  - `rg -n '"/api|/api/threads|/api/workspaces|"/ws|/ws' packages/thread-ui`
  - `rg -n "window\\.location|/threads/new|/threads/|localStorage|sessionStorage|remote-codex:shell-layout" packages/thread-ui`
- Build/typecheck verification passed:
  - `pnpm --filter @remote-codex/thread-ui build`
  - `pnpm --filter @remote-codex/thread-ui typecheck`
  - `pnpm --filter @remote-codex/supervisor-web typecheck`
  - `pnpm typecheck`
- Test verification passed:
  - `pnpm --filter @remote-codex/supervisor-web test -- ThreadDetailPage`
  - `pnpm --filter @remote-codex/supervisor-web test -- ThreadShellPanel ThreadDetailPage`
  - `pnpm --filter @remote-codex/supervisor-web test`
- Production build verification passed:
  - `pnpm --filter @remote-codex/supervisor-web build`
- No package-local tests were added, so `pnpm --filter @remote-codex/thread-ui test` is not applicable for this extraction.
- Follow-up extraction note: `ThreadDetailPage.tsx` now renders `ThreadDetailSurface` and passes controller state, slots, local router callbacks, local REST adapters, local shell adapter, timeline props, composer props, shell composer props, dialogs, and app shell controls into the package surface.
- Follow-up extraction note: `ThreadDetailSurface` owns the shared surface composition for `ThreadWorkspaceLayout`, `ThreadTimeline`, chat composer, optional shell panel, shell composer, mobile floating composer, surface actions, floating panel, banners, empty/loading content, and dialogs.
- Follow-up regression note: `apps/supervisor-web/src/index.css` includes `@source "../../../packages/thread-ui/src/**/*.{ts,tsx}";`; this must remain while styles are app-owned or extracted package Tailwind classes will not be generated.
- Follow-up regression note: `ThreadDetailPage.tsx` keeps supervisor-specific data fetching, websocket handling, optimistic updates, goals, hooks, MCP, settings, export/delete dialogs, route navigation, and shell adapter construction local to supervisor web.
- Follow-up regression note: `surfaceAdapter` includes current controller callback dependencies so `adapter.sendPrompt` does not capture the initial chat-mode `handlePrompt` closure after switching to shell view.
- Follow-up regression note: floating mobile chat composer rendering remains a single fixed composer in mobile mode, matching the pre-surface page behavior and avoiding duplicate accessible slash-toolbox controls.
- Follow-up test note: the app-local `ThreadTimeline` wrapper test now passes `adapter.onOpenLinkedThread`, so jsdom no longer emits the legacy `window.location.assign` navigation warning in the fork-source navigation test.
- Follow-up items under "Recommended Follow-Up After This Lands" remain unchecked intentionally because they belong to the downstream `sandbox-worker-control-plane` integration, not this main-branch extraction.
