# Android Client Architecture

The Android client lives in `apps/android` as an independent Gradle build. It is intentionally separate from the root pnpm workspace so the Node/TypeScript supervisor and the native Android toolchain can evolve without making the default repository build slower or more fragile.

## Scope

This skeleton is the first step for a Kotlin Android client targeting Android 10 and newer.

- Minimum SDK: 29, Android 10.
- Target SDK: 34.
- Language: Kotlin.
- Build system: Gradle with the Android Gradle Plugin.
- UI framework: Jetpack Compose and Material 3.
- Initial module: `:app`.

The first APK now has a first-run supervisor connection setup path plus the first real thread-detail REST path. The setup path supports local, server, and relay connection modes, persists the selected endpoint, logs in to server and relay auth endpoints, and follows the relay account/device model rather than QR pairing. In relay mode the Android client can load `/relay/portal`, show registered backend devices with online/last-heartbeat status, create a new relay device, and display the one-time `rcd_...` token plus a `remote-codex relay-supervisor` command for the private backend. After a connection is saved, the app reads a backend home snapshot from `/api/workspaces` and `/api/threads` using direct or relay-forwarded paths. Workspace rows can call `POST /api/workspaces/:id/open`, `POST /api/workspaces/:id/favorite`, `PATCH /api/workspaces/:id`, `DELETE /api/workspaces/:id`, and `POST /api/threads/start`, then refresh the home snapshot or open the newly started thread. Thread rows now open a real `/api/threads/:id` detail screen, project server turns, pending requests, and answered request notes into the native timeline, load workspace trees through `/api/workspaces/:id/files/tree`, load and switch bounded file previews through `/api/workspaces/:id/files/preview`, append additional preview chunks with `offset`, read shell state through `/api/threads/:id/shell`, create shells through `POST /api/threads/:id/shell`, terminate shells through `POST /api/shells/:id/terminate`, attach shells and stream shell output through `/ws`, send shell input and PTY controls through supervisor socket messages, clear shell output through `shell.clear`, send prompts through `/api/threads/:id/prompt`, interrupt active turns through `/api/threads/:id/interrupt`, update thread model/reasoning/fast/plan settings through `PATCH /api/threads/:id/settings`, update goals through `PATCH /api/threads/:id/goal`, compact context through `POST /api/threads/:id/compact`, load fork targets through `GET /api/threads/:id/fork-turns`, fork latest or selected turns through `POST /api/threads/:id/fork`, load export turn options through `GET /api/threads/:id/export-turns`, download transcript exports through `GET /api/threads/:id/exports/pdf`, load real skills/MCP/hooks panel data through `/api/threads/:id/skills`, `/api/threads/:id/mcp-servers`, and `/api/threads/:id/hooks`, trust or untrust hooks through `/api/threads/:id/hooks/trust` and `/api/threads/:id/hooks/untrust`, answer pending requests through `/api/threads/:id/requests/:requestId/respond`, rename threads through `PATCH /api/threads/:id`, and delete threads through `DELETE /api/threads/:id`. The detail route also opens `/ws` or `/relay/devices/:deviceId/ws`, listens for matching `thread.*` envelopes, and refreshes the aggregate detail projection when live thread events arrive. The sample thread detail surface remains as a fallback and component preview while a full event reducer, complete PTY terminal parity, and remaining workspace file actions are completed.

## Directory Layout

```text
apps/android
  settings.gradle.kts
  build.gradle.kts
  gradle.properties
  app
    build.gradle.kts
    src/main
      AndroidManifest.xml
      java/com/remotecodex/android
        api
        settings
        ui/components
        ui/model
        ui/presentation
        ui/sample
        ui/screen
        ui/theme
```

Code should keep clear package boundaries:

- `api`: REST transport, connection modes, auth/session DTOs, relay portal/device DTOs, websocket URL derivation, first-pass websocket event stream, thread detail fetch, workspace tree/file-preview fetch, shell state/create/terminate methods, prompt send, interrupt, thread settings, goal update, compact, pending request response, rename, and delete methods.
- `auth`: future Android Keystore token storage, relay account login, and device revocation flows.
- `settings`: persistent local app settings such as theme mode, base URL, auth token, and selected relay device id.
- `thread`: thread projection state, event reducers, optimistic sends, and reconnect reconciliation.
- `workspace`: workspace list and file-preview models.
- `voice`: native audio session orchestration.
- `ui`: Android screens and view models.

When these areas become large, split them into Gradle modules such as `:core:api`, `:core:thread-state`, and feature modules. The first skeleton stays single-module to keep the build simple while the API contract is still moving.

## Relationship To The Web Client

The Android app should not duplicate the React page orchestration from `apps/supervisor-web`. Long-term maintainability depends on moving stable protocol logic into shared contracts before native screens become complex:

- typed REST and WebSocket client behavior,
- thread event ordering and projection rules,
- optimistic prompt and pending confirmation lifecycle,
- reconnect and foreground resume reconciliation.

Until those contracts exist, Android screens should stay narrow and should prefer server aggregate DTOs over reconstructing state from many low-level calls.

## Current Thread UI Alignment

The first native pass aligns with the mobile graph-chat thread surface from `/home/u/dev/remote-codex-thread-ui`, especially:

- `ThreadDetailSurface.tsx`: thread detail as a topbar, chat timeline, workspace/shell switch, and composer surface.
- `GraphChatThreadChatPanel.tsx`: mobile chat layout with fixed composer and bottom timeline padding.
- `GraphChatTurnFrame.tsx`: compact turn header with turn index, time, status, and token summary.
- `GraphChatMessageFrame.tsx`: assistant/user message frames, sender label, status badge, and time treatment.
- `GraphChatToolCall.tsx`: tool call frame with monospaced tool name, status badge, parameters, and result block.
- `ThreadComposer.tsx`: rounded input group, slash toolbox, attachment menu, model/effort controls, plan chip, shell tools, and primary send action.
- `ThreadGraphWorkspacePanel.tsx`: right-side workspace surface with Workspace, Tool Usage, Guide, Graph, and Extensions tabs.
- `GraphGuidePanel.tsx`: compact operational guide content for workspace and viewer behavior.
- `styles.css`: light and dark graph-chat tokens, restrained neutral surfaces, slate foregrounds, and semantic status colors.

Android equivalents are intentionally native Compose components:

- `AppShellPanels.kt`
- `ThreadTopBar.kt`
- `ThreadActionDialogs.kt`
- `ThreadTimelineComponents.kt`
- `GraphChatHistoryEntries.kt`
- `GraphAccordion.kt`
- `ThreadComposer.kt`
- `GraphChatShellLayout.kt`
- `GraphResizablePanels.kt`
- `GraphUiPrimitives.kt`
- `GraphInputGroup.kt`
- `GraphSlider.kt`
- `LongTextDialog.kt`
- `RunningDots.kt`
- `StatusBadge.kt`
- `ThreadPresentation.kt`
- `WorkspaceTree.kt`
- `MarkdownHeuristics.kt`
- `RichMessageBlocks.kt`
- `GraphChatPlainText.kt`
- `GraphChatToolBlocks.kt`
- `GraphChatSyntaxHighlighting.kt`
- `UserMessageSegments.kt`
- `ThreadColors.kt`
- `PendingRequestCard.kt`
- `ThreadRoomsPanel.kt`
- `WorkspacePanel.kt`
- `WorkspaceInfoCard.kt`
- `ArtifactPreviewCard.kt`
- `ShellPanel.kt`
- `RemoteCodexTheme.kt`
- `RichMessageContent.kt`
- `SupervisorHomeScreen.kt`

The current thread detail screen is sample-data driven through `ThreadPreviewSample.kt`. The app shell now gates that preview behind a real connection setup screen, but the connected state only proves the selected supervisor or relay endpoint can authenticate and answer health/session requests.

The settings surface now also shows a live backend snapshot summary after connection. This is intentionally small: it verifies authenticated REST access to workspace and thread lists without prematurely coupling the native timeline to the Web client state machine.

The visual direction is close to the web mobile thread view, but not a literal DOM port. Native screens should preserve the information architecture and state vocabulary while using Android touch targets, safe areas, and Compose layout primitives.

## Component Coverage Matrix

| Web thread-ui source | Android native equivalent | Current status |
| --- | --- | --- |
| `AppShellNavigation.tsx` | `SupervisorHomeScreen.kt` + `AppShellPanels.kt` + `ThreadTopBar.kt` | Native connected home with switchable Workspaces/Threads/Shells destinations, supervisor summary, live workspace/thread counts, recent thread/workspace rows from the supervisor snapshot, real workspace open/favorite/rename/delete actions with snapshot refresh, real New Thread action that calls `/api/threads/start` and opens the created thread, shell process preview rows, settings/change-connection actions, plus the in-thread app shell drawer with shared close icon controls and active-state badges. |
| `AppShellNavContext.tsx` | `ThreadDetailPreviewScreen.kt` state + `ThemeMode.kt` | Local Compose state for nav/settings visibility plus persisted System/Light/Dark theme mode. |
| `AppShellSettingsDialog` appearance section | `AppShellSettingsPanel` + `AppSettingsRepository.kt` | Settings panel with explicit System/Light/Dark theme selection, native theme glyphs, Active badges, and shared-preferences persistence. |
| `AppShellSettingsDialog` plugin section | `AppShellSettingsPanel` + `AppShellPreview` | Native plugin/renderers settings skeleton showing enabled state with shared selection glyphs, renderer status with graph badges, plugin source badges, capabilities, and an import-plugin draft form with manifest URL/JSON validation plus queued-state feedback. |
| `ThreadDetailSurface.tsx` | `ThreadDetailScreen.kt` + `ThreadDetailPreviewScreen.kt` | Real REST-backed thread detail route plus preview fallback, both sharing the native topbar, chat timeline, workspace/shell switch, and fixed composer surface. |
| `ThreadWorkspaceLayout.tsx` | `ThreadTopBar.kt` + `ThreadRoomsPanel.kt` + `ThreadActionDialogs.kt` | Mobile topbar with Web-like app menu/settings glyph buttons, workspace/session/usage details disclosure, mobile workspace return and New Chat shortcut glyph pills, action/thread glyph pills, native rename/export/delete action glyphs, segmented Chat/Workspace/Shell navigation, rooms drawer with Web-like thread message, New Chat, close, wired rename/copy-session/delete buttons, copied-session feedback, Rooms header/count, active-room badge, native Create New Chat dialog with editable chat-name draft, and a tablet/desktop collapsed rooms rail with workspace mark, expand control, New Chat, room glyphs, active-room selection, and status dots. |
| `GraphChatShellLayout.tsx` | `GraphChatShellLayout.kt` + `ThreadDetailPreviewScreen.kt` | Native shell root, frame, main panel, topbar shell, split region, mobile scrim, and rooms rail shell now wrap the preview screen. |
| `ThreadTimeline.tsx` top-level controls | `ThreadTimelineComponents.kt` + `TimelineAuxiliaryPreview` + `ThreadPresentation.kt` | Native preview rows for loading earlier history, activity notes, answered request notes, pending steers, ephemeral user prompt, and optimistic turn labeling. Activity notes now include a Web-like linked action pill such as `Open fork` for fork activity previews. Activity notes, pending requests, and answered request notes are projected into one Web-like request-entry section and sorted by `sortKey`, matching the `ActivityRequestEntrySection` created-at ordering model. |
| `GraphChatThreadChatPanel.tsx` | `ThreadDetailPreviewScreen.kt` + `ThreadTimelineComponents.kt` | Chat surface with timeline padding and fixed composer behavior. |
| `GraphChatTurnFrame.tsx` | `ThreadTimelineComponents.kt` | Turn header, status, time, token summary, body grouping, and Web-like per-turn collapse/expand control with compact collapsed summary. |
| `GraphChatMessageFrame.tsx` | `ThreadTimelineComponents.kt` + `StatusBadge.kt` + `ThreadPresentation.kt` + `ThreadColors.kt` | User/assistant message surfaces, transparent assistant frame treatment, Web-aligned user bubble colors, green assistant sender pill, Web-compatible compact message status badges with running dots/check/x/circle glyphs, Web-like user footer placement, time treatment, and compact assistant reply copy action. |
| `GraphChatRunningDots` usage in message/history frames | `RunningDots.kt` + `StatusBadge.kt` + `ThreadTimelineComponents.kt` | Shared native running-dot primitive now backs thread/tool status badges, thinking accordions, running live-plan steps, and running history group/row indicators. Metadata pills keep a static dot treatment. |
| `GraphChatMessageBody.tsx` and `GraphChatMessageContent.tsx` | `RichMessageBlocks.kt` + `GraphChatPlainText.kt` + `UserMessageSegments.kt` + `ThreadTimelineComponents.kt` + `RichMessageContent.kt` + `ArtifactPreviewCard.kt` | Native assistant rich message rendering for paragraphs, headings, nested unordered/ordered/task lists with continuation lines, blockquotes, horizontal rules, aligned simple tables, inline code, inline/display math notation, strong/emphasis/strikethrough spans, markdown inline links, markdown image placeholders, backtick and tilde fenced code blocks, molecule fenced code previews for `xyz`/`extxyz`/`cif`/`pdb` with Source and Collapse controls, tool blocks, code-copy feedback, clickable plain URLs, and 4,000-character Show more/less previews. User messages parse `[PHOTO path]` and `[FILE path]` tokens into native attachment chips/placeholders through tested presentation helpers. |
| `markdownHeuristics.ts` | `MarkdownHeuristics.kt` + `RichMessageContent.kt` | Native markdown syntax heuristic chooses between lightweight plain text blocks and richer markdown-like parsing. |
| `graphChatToolBlocks.ts` | `GraphChatToolBlocks.kt` + `RichMessageContent.kt` + `GraphAccordion.kt` + `StatusBadge.kt` | Native preprocessing for `tool-call`, `tool-result`, and merged tool blocks, with accordion disclosure, compact unframed tool glyph, monospaced structured tool title, call id, compact tool status badge, JSON-like typed key/value parameter and result blocks including empty objects and top-level array/object values, pre-style object/array result output, raw output blocks for `stdout`/`stderr`/`result`, and content-level copy rendering inside rich messages. |
| `graphChatShiki.ts` | `GraphChatSyntaxHighlighting.kt` + `RichMessageContent.kt` | Lightweight native syntax styling for fenced code blocks. This improves code readability without embedding Shiki or a JavaScript highlighter runtime. |
| `threadPresentation.ts` | `ThreadPresentation.kt` + timeline/rooms/workspace components | Central native labels for thread status, export status, tool status, plan steps, history item labels, and scrollable history kinds. |
| `GraphChatCompactMessageItem.tsx` reasoning section | `ThreadTimelineComponents.kt` + `GraphAccordion.kt` + `ReasoningPreview` | Assistant messages show a native collapsible Thought Process/Thinking block with bounded monospace content, running state, and reasoning copy action through the shared accordion primitive. |
| `GraphAccordion.tsx` | `GraphAccordion.kt` + `ThreadTimelineComponents.kt` + `WorkspacePanel.kt` + `RichMessageContent.kt` | Native accordion root/item/trigger/content primitive with chevron, separator, disabled state, stable state keys, custom colors, trailing content, and expanded content. Used by workspace guide/extensions, timeline reasoning, rich-message tool blocks, and history groups. |
| `GraphChatToolCall.tsx` | `ThreadTimelineComponents.kt` + `GraphAccordion.kt` | Tool call accordion with Web-like wrench glyph, monospaced name, status badge, parameters, non-empty result block, auto-open behavior for running/output states, and copy actions for parameters/results. |
| `GraphChatTurnBody.tsx` live plan branch | `ThreadTimelineComponents.kt` + `LivePlanPreview` + `ThreadPresentation.kt` | Native live plan card rendered inside the turn frame with explanation, ordered steps, Web-like compact icon status badges, running dots, and accessibility labels. Step status badge tone, running state, and accessibility labels are projected in `ThreadPresentation.kt` so the Compose row follows the Web `GraphChatPlanStepStatusIcon` semantics. |
| `GraphChatHistoryEntries.tsx` | `GraphChatHistoryEntries.kt` + `ThreadTimelineComponents.kt` | Native history entry dispatcher maps item, command group, file-change group, file-read group, and search group entries to timeline renderers. |
| `GraphChatHistoryItems.tsx` | `ThreadTimelineComponents.kt` + `HistoryItemPreview` + `ThreadPresentation.kt` | Native typed history cards for plan, context, command, tool, agent, skill, web search, file read, file change, image, artifact, hook, and generic events, with Web-like kind glyphs, running event hint, structured and fallback file-change summary chips, trailing path compaction for file-change rows, grouped-row first-line previews with gap markers, Web-like grouped row ordinal labels, hook output/status summaries, artifact type/title/renderer summaries, Web-like artifact Open/Hide fallback disclosure, detail actions, and copy actions. |
| `GraphChatHistoryGroupFrame.tsx` and grouped history items | `GraphChatHistoryEntries.kt` + `ThreadTimelineComponents.kt` + `GraphAccordion.kt` + `HistoryGroupPreview` | Expandable native batch cards for command, web-search, file-read, and file-change groups, with Web-like kind glyphs, overlaid count badges, running status, child rows, file-count and line delta summaries, and copy actions through the shared accordion primitive. |
| `GraphChatImageItem.tsx` | `ThreadTimelineComponents.kt` + `HistoryItemPreview` | Native image event placeholder with fixed-ratio preview block, Web-like clickable asset path row, open detail action, and path copy feedback. |
| `LongTextDialog.tsx` | `LongTextDialog.kt` + `DetailPreview` | Native full-detail overlay for history actions such as Command Output, File Read Details, File Change Details, and Artifact inspection, backed by shared dialog overlay primitives. |
| `RenameDialog.tsx` | `ThreadActionDialogs.kt` | Native rename-thread dialog with editable title draft, token-aligned text field, save summary, busy/error state, and real `PATCH /api/threads/:id` wiring on the REST-backed thread detail route. |
| `ExportTranscriptDialog.tsx` | `ThreadActionDialogs.kt` + `ExportTurnPreview` | Native export transcript dialog with stateful latest/custom mode, PDF/HTML format controls, custom turn selection with Select all/Clear and per-turn toggles, selected turn rows loaded from `/export-turns`, zero-selection export guard, real transcript download request, toggleable token/price option, format-specific guidance, and icon-labeled export footer. |
| `ConfirmDialog.tsx` | `ThreadActionDialogs.kt` | Native destructive delete-thread confirmation with target thread, risk/recovery summary rows, explicit confirmation guard, busy/error state, and real `DELETE /api/threads/:id` wiring on the REST-backed thread detail route. |
| `ThreadComposer.tsx` | `ThreadComposer.kt` | Bottom input surface with Web-like native slash/attachment/shell glyph buttons, editable chat prompt, real prompt submission, real stop/interrupt, real model/reasoning-effort/fast-mode/plan-mode settings updates, real goal update, real compact action, and real fork latest/selected-turn actions on the REST-backed thread detail route, empty-draft send guard, preview-local chat/shell view switching, native slash toolbox with graph badge status markers, goal compose/status/error and fast-mode hint preview rows with real detail-route submit plus preview-local fallback behavior, fork turn-option status rows from `/fork-turns`, real skills list rows from `/skills`, real MCP server/tool/status rows from `/mcp-servers`, real hooks rows/warnings/errors from `/hooks`, real hook trust/untrust actions, compact attachment action menu with native photo/file glyph rows, preview-local photo/file insertion and chip removal, compact Web-like model and effort menus with shared selection glyphs plus preview-local selection/default-effort feedback, fast-mode-disabled model/effort controls, model-panel disabled reason notice and empty runtime fallback, Web-matched jump-to-latest badge with local follow-state update, editable shell prompt preview with toolbar draft label, Send Shell Input/Ctrl-C disabled semantics and local send feedback, Web-matched shell tool pill tones, compact two-column shell tools overlay, disabled-aware shell controls, click feedback, and circular send icon action. |
| `ThreadComposer.tsx` context usage and attachment draft UI | `ThreadComposer.kt` | Native context progress bar, context usage row, glyph-backed queued attachment chips, and attachment preview strip. |
| `InputGroup.tsx` | `GraphInputGroup.kt` + `ThreadComposer.kt` | Native grouped prompt input surface with block-start attachment chips, prompt body/control content, and block-end metadata/addon rows. |
| `Slider.tsx` | `GraphSlider.kt` + `ThreadComposer.kt` | Native slider track/range/thumb primitive plus labeled slider wrapper, used by context usage and reasoning effort previews. It is visual-only until settings wiring lands. |
| `Button.tsx` | `GraphUiPrimitives.kt` | Native graph button primitive with default, destructive, outline, secondary, ghost, disabled, compact size variants, optional action glyph slots, and tone-aware shared selection glyphs for choice rows. |
| `Badge.tsx` | `GraphUiPrimitives.kt` | Native graph badge primitive with default, secondary, destructive, and outline variants. |
| `ButtonGroup.tsx` | `GraphUiPrimitives.kt` + `ArtifactPreviewCard.kt` | Native grouped control surface used by molecule viewer actions, with horizontal flow and vertical group support. |
| `Separator.tsx` | `GraphUiPrimitives.kt` + `ArtifactPreviewCard.kt` | Native horizontal/vertical separator primitive used inside grouped molecule controls. |
| `Tooltip.tsx` | `GraphUiPrimitives.kt` + `ArtifactPreviewCard.kt` | Android equivalent uses semantic content descriptions for compact controls. Pointer hover popovers are intentionally not part of the first mobile pass. |
| `Dialog.tsx` | `GraphUiPrimitives.kt` + `ThreadActionDialogs.kt` | Native dialog overlay, frame, header, scrollable content body, icon-only close action, and icon-labeled footer actions now back rename/export/delete thread dialogs. |
| `ConfirmDialog.tsx` and pending request flows | `PendingRequestCard.kt` + `ThreadPresentation.kt` | Inline mobile pending request stack with stable request keys, risk label, command preview, deny, command approval, question submit, disabled-until-answered state, Web-like option selection, custom answer input, free-form answer input, matching accessibility labels, and explicit `approval`/`requestUserInput`/`planDecision` presentation semantics. Plan decisions use the Web-like `Plan` title, hide descriptive body copy, omit the footer submit row, disable option chips while busy, and show Web-like `Starting...`/`Saving...` busy labels for the selected plan option. |
| `ThreadGraphWorkspacePanel.tsx` | `WorkspacePanel.kt` | Native Workspace/Tool Usage/Guide/Graph/Extensions tabs inside the mobile Workspace surface, now backed by real workspace tree and bounded first-file preview data on the REST-backed thread detail route. |
| `GraphWorkspaceExplorer.tsx` | `WorkspacePanel.kt` | Workspace file tree from `/api/workspaces/:id/files/tree`, clickable file rows that switch `/files/preview`, selected row state for the loaded preview file, root label, row-level download glyph action, refresh/garbage action glyph chips, workspace summary strip, empty workspace state, and Web-like native folder/file/artifact/event glyphs. |
| `workspaceTree.ts` | `WorkspaceTree.kt` + `WorkspacePanel.kt` | Native path helpers for extension/name extraction, ancestor expansion, directory-first sorting, and flat preview nodes used by the workspace explorer. |
| `GraphWorkspacePreviewPane.tsx` | `WorkspacePanel.kt` | Code preview pane backed by `/api/workspaces/:id/files/preview`, with metadata bar, native copy/open action glyph chips, truncated preview warning chip, real load-more chunk append via `offset`, and scrollable monospaced content. |
| `GraphWorkspacePreviewPane.tsx` artifact branch | `ArtifactPreviewCard.kt` | Native fallback card with artifact metadata, source preview, and molecule-specific summary. |
| `GraphMoleculeViewerData.ts` | `GraphMoleculeViewerData.kt` + `ArtifactPreviewCard.kt` | Native molecule data normalization for XYZ/extxyz, trajectory frame splitting, export-content joining, and first-frame atom parsing for the compact schematic preview. |
| `GraphWorkspaceCards.tsx` | `WorkspaceInfoCard.kt` + `WorkspacePanel.kt` | Native workspace info card used by guide and extension surfaces, with compact label treatment and panel styling. |
| `GraphResizablePanels.tsx` | `GraphResizablePanels.kt` + `WorkspacePanel.kt` | Native vertical panel group, panel, and handle primitives divide workspace explorer, artifact preview, and file viewer sections. Drag resizing is not implemented on mobile. |
| `GraphEmptyGarbageDialog.tsx` | `WorkspacePanel.kt` + `WorkspacePreview.garbageFiles` | Native empty-garbage confirmation backed by shared dialog overlay/frame/footer primitives, with code-style `garbage/` target, empty state, file-count risk summary, file list, icon-labeled cancel, and Web-matched destructive confirmation copy. |
| `XyzArtifactRenderer.tsx` and `InlineXyzRenderer.tsx` | `ArtifactPreviewCard.kt` + `GraphMoleculeViewerData.kt` | Minimal native 2D molecule fallback for XYZ-like artifacts, using parsed first-frame atom coordinates when available. Full 3D rendering is not implemented yet. |
| `GraphMoleculeViewer.tsx` | `ArtifactPreviewCard.kt` + `GraphMoleculeViewerData.kt` | Coverage is intentionally partial: Android shows a parsed compact schematic and metadata rather than an interactive 3D viewer. |
| `GraphMoleculeViewerControls.tsx` | `ArtifactPreviewCard.kt` | Native molecule control chips for copy/download/screenshot, zoom/reset, measurement, selection, staging, and unit-cell affordances. |
| `GraphMoleculeViewerUpperButtonGroup.tsx` | `ArtifactPreviewCard.kt` | Upper molecule control group represented as native chips above the schematic preview. |
| `GraphMoleculeViewerLowerButtonGroup.tsx` | `ArtifactPreviewCard.kt` | Lower molecule control group represented as measurement and selection/staging rows with disabled unavailable actions. |
| `GraphToolUsagePanel.tsx` | `WorkspacePanel.kt` | Compact tool usage empty state, calls-this-session count bars, disabled reload affordance, and a native call log with input and output sections. |
| `GraphGuidePanel.tsx` | `WorkspacePanel.kt` | Mobile guide tab covering getting started, workspace explorer, previews, and tool usage. |
| `GraphVisualization.tsx` | `WorkspacePanel.kt` | Native graph summary with static relationship sketch and node list. Full interactive graph is still open. |
| `FloatingEdge.tsx` | `WorkspacePanel.kt` graph canvas | Native graph canvas draws curved directed edges with arrowheads between summary nodes. |
| `FloatingConnectionLine.tsx` | `WorkspacePanel.kt` graph canvas | Native graph canvas includes target markers on directed graph connections. Interactive drag-to-connect is not implemented. |
| `FloatingHelper.tsx` | `WorkspacePanel.kt` graph helper strip | Native graph helper strip and legend summarize Bezier edges, arrow targets, live nodes, and node categories. |
| Thread panel extension cards | `WorkspacePanel.kt` | Extensions tab uses Web-like WorkspaceInfoCard sections for plugin panels, enabled renderers, Remote Codex tools, thread meta, and settings preview rows. |
| `ThreadShellPanel.tsx` | `ShellPanel.kt` | Terminal shell frame now backed by real REST shell state and supervisor websocket shell events on the thread detail route, with Web-like native connection/terminate glyph controls, active process bar, live process count, mobile process drawer with no-live-process empty state, real new-shell action, real terminate action, websocket attach/input/output handling, clipboard copy/paste, real clear action, Ctrl-C/Ctrl-D/Esc/Tab/Up/Down PTY control sends, floating shell toolbox trigger, feedback pill, disabled-aware tone-matched control chips, state output, and command bar with disconnected/running disabled states. Full terminal escape-sequence parity is still open. |
| `styles.css` graph-chat tokens | `ThreadColors.kt` + `RemoteCodexTheme.kt` + `ThemeMode.kt` | Light/dark token sets with persisted System/Light/Dark theme mode. |

Still open:

- Full app shell destination behavior is still open: the connected home now switches between Workspaces/Threads/Shells and uses the supervisor snapshot, but workspace drill-in/create workspace, real shell list/actions from backend shell state, plugin import API calls, backend settings, and richer thread-list filtering are not yet complete.
- Full markdown/GFM parity beyond the current native subset, especially KaTeX-quality math typesetting, advanced nested list edge cases, advanced syntax highlighting, and non-molecule plugin-rendered inline artifacts. Current Android math support keeps inline and display formulas readable as native monospaced notation but does not shape TeX into full mathematical layout.
- Real image loading for markdown image sources is still open; Android currently renders stable native placeholders with alt text and basename.
- Full Shiki parity for code blocks: language grammars, themes, token scopes, and line metadata are still open. Current Android highlighting is intentionally lightweight, with native copy affordances already present on fenced code and tool blocks.
- Full graph-ui primitive behavior: pressed/loading states, focus polish, icon slots, real editable input controls, long-press tooltip popovers, Dialog trigger/portal parity, and broader reuse outside molecule controls, accordion surfaces, input groups, sliders, and thread action dialogs.
- Full graph-chat tool block parity: robust JSON parsing, richer formatting for nested values, streaming result reconciliation, and plugin-aware renderers. Current Android support is lightweight and preview-oriented, with native copy actions, top-level primitive value styling, raw output blocks, and structured key/value parameter/result sections.
- Full history entry ordering parity with persisted server events; current native dispatcher preserves the preview item/group stream and top request-entry `sortKey` order, but does not yet consume server event cursors.
- Full `ThreadTimeline.tsx` behavior: scroll anchoring, tail visibility, server-managed history paging, deferred history detail cache, request anchoring by turn id, and live output attachment are still not implemented.
- Full pending request lifecycle is still open for WebSocket-created requests, immediate plan-decision submit behavior, optimistic busy state, richer backend errors, and event-based answered-note reconciliation. REST detail parsing and `respond` submission are now present for request-user-input style pending requests.
- Full history item and user attachment interactions: deferred detail loading, real image asset loading, clipboard actions, and richer full-detail content types.
- Broader copy affordances for deferred-detail history items; assistant replies, reasoning text, fenced code, tool blocks, native history item summaries/details, and image paths already have clipboard feedback.
- Remaining real thread action wiring behind native dialogs: export PDF/HTML and fuller post-delete navigation refresh. Rename and delete now call the real thread REST APIs from the detail route with busy/error states.
- Full artifact-specific viewers, including interactive molecule and graph panels.
- Real molecule viewer behavior behind the current native control chips: 3D renderer, robust bond perception, frame slider/playback, atom selection, camera updates, copy/download/screenshot actions, and unit-cell toggling.
- Real graph editor behavior behind the current native graph summary: React Flow layout parity, draggable nodes, live connection preview, selectable edges, and graph pan/zoom.
- Remaining real composer actions behind the current native sample menus: MCP config write, hook create/update editable forms, attachments, export save/share destination, and fuller shell controls. Model updates, reasoning effort updates, fast mode, plan mode, goal update, compact, fork, transcript export request, skills/MCP/hooks reads, and hook trust/untrust now call real thread APIs from the detail route.
- Real composer input behavior behind the current grouped prompt surface: editable rich text, clipboard paste sanitization, drag/drop extraction, attachment file picker, context usage from the backend, and slider value persistence.
- Real workspace actions behind the current native action chips: refresh, copy, open, upload, download, and file mutation. Workspace tree, file selection, and load-more preview fetches now call the backend from the thread detail route.
- Full workspace tree parity beyond backend `ThreadWorkspaceTreeNode` basics: artifact/event/live roots, interactive preview source selection, and molecule snapshot generation.
- Broader workspace card reuse across file previews, graph node detail, and future plugin panels.
- Real resizable workspace panel behavior on tablet/desktop form factors; current Android coverage keeps stable panel boundaries and handle visuals without drag resizing.
- Real garbage folder mutation behind the current empty-garbage confirmation skeleton.
- Remaining shell adapter actions behind the current native shell controls: rename, split pane, resize UI, richer terminal escape-sequence handling, queued first input while waiting for `shell.connected`, and full PTY parity. REST shell state/create/terminate plus websocket attach/input/control/clear/output now call the backend from the detail route.
- Full WebSocket event reducer, relay device deletion/revocation, shared-session selection, and shell integration. Android now has a first-pass websocket client that subscribes to supervisor thread events and refreshes thread detail for matching `threadId` values, but it still relies on full-detail reconciliation instead of applying `thread.output.delta` and item lifecycle events locally.
- A backend claim-code flow is still open. The current relay model is: login to the relay, create a device, copy the one-time `rcd_...` token to the private backend, and run `remote-codex relay-supervisor` with that token. A future smoother path can let the backend print a short claim code and let a logged-in Web or Android client bind that pending backend to the account.
- Real plugin management behind the current native settings skeleton: refresh, persisted import, enable/disable, uninstall, and trusted renderer policy.
- Screenshot-based E2E after emulator access is available.

## Build

Use JDK 17 or newer.

```bash
cd apps/android
./gradlew :app:assembleDebug
```

The debug APK is written to:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

Local Android SDK paths should stay outside git. Use `local.properties` if the SDK is not discoverable from `ANDROID_HOME` or `ANDROID_SDK_ROOT`.

## Emulator And E2E Verification

The local SDK is expected at `/home/u/Android/Sdk` in this environment. The emulator package and an API 34 Google APIs x86_64 system image can be installed with:

```bash
JAVA_HOME=/home/u/.jdks/jdk-17 \
ANDROID_HOME=/home/u/Android/Sdk \
ANDROID_SDK_ROOT=/home/u/Android/Sdk \
/home/u/Android/Sdk/cmdline-tools/latest/bin/sdkmanager \
  "emulator" \
  "system-images;android-34;google_apis;x86_64"
```

Create the current test AVD with:

```bash
printf 'no\n' | JAVA_HOME=/home/u/.jdks/jdk-17 \
ANDROID_HOME=/home/u/Android/Sdk \
ANDROID_SDK_ROOT=/home/u/Android/Sdk \
/home/u/Android/Sdk/cmdline-tools/latest/bin/avdmanager create avd \
  --force \
  --name remote_codex_api34 \
  --package 'system-images;android-34;google_apis;x86_64' \
  --device pixel_6
```

Headless emulator launch command:

```bash
JAVA_HOME=/home/u/.jdks/jdk-17 \
ANDROID_HOME=/home/u/Android/Sdk \
ANDROID_SDK_ROOT=/home/u/Android/Sdk \
/home/u/Android/Sdk/emulator/emulator @remote_codex_api34 \
  -no-window \
  -no-audio \
  -no-boot-anim \
  -gpu swiftshader_indirect \
  -accel auto
```

When running the emulator directly inside WSL, the x86_64 emulator needs `/dev/kvm` access in the active Linux login session. Add the user to the `kvm` group and start a new login session before relying on WSL-hosted screenshot E2E:

```bash
sudo gpasswd -a "$USER" kvm
```

Once the emulator boots, install and capture with:

```bash
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.remotecodex.android/.MainActivity
adb exec-out screencap -p > output/android-thread-preview.png
```

In this workspace, the Windows-hosted emulator can also be reached from WSL through `/home/u/bin/adb-windows`. Timeline smoke coverage includes UIAutomator checks for the Web-like pending request flows and activity-note action previews: free-form question rendering, option selection, free-form input availability, the `Plan` title, immediate decision options, the `Starting...` plan busy label, hidden plan-decision body copy, the absence of an empty plan command block, and the `Open fork` activity action. Composer smoke coverage checks the slash toolbox root actions, skills/MCP/hooks subpanel routing, MCP and hook action affordances, model menu, and reasoning-effort menu, including toolbox statuses, context usage, selected/available option rows, and effort guidance. Focused Compose instrumentation tests cover local slash subpanel state that UIAutomator should not own: skills copy preview feedback, MCP add/HTTP/Back navigation, MCP raw TOML block/Back navigation, MCP HTTP/raw write preview feedback, hooks add/Back navigation, hooks edit/Back navigation, hooks write/update preview feedback, hooks trust/untrust preview feedback, and idle fork turn-picker navigation. Presentation unit tests cover disabled-submit behavior, pending request busy labels, mixed activity/request/answered request-entry ordering, and stable pending-request keys.

```bash
JAVA_HOME=/home/u/.jdks/jdk-17 \
ANDROID_HOME=/home/u/Android/Sdk \
ANDROID_SDK_ROOT=/home/u/Android/Sdk \
./gradlew :app:compileDebugKotlin :app:compileDebugAndroidTestKotlin \
  :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest

/home/u/bin/adb-windows install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
/home/u/bin/adb-windows install -r apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
/home/u/bin/adb-windows shell am instrument -w -r \
  -e class com.remotecodex.android.ui.components.PendingRequestCardTest \
  com.remotecodex.android.test/androidx.test.runner.AndroidJUnitRunner
/home/u/bin/adb-windows shell am instrument -w -r \
  -e class com.remotecodex.android.ui.components.ThreadComposerMenuTest \
  com.remotecodex.android.test/androidx.test.runner.AndroidJUnitRunner
/home/u/bin/adb-windows shell am instrument -w -r \
  -e class com.remotecodex.android.ui.components.ThreadComposerStateTest \
  com.remotecodex.android.test/androidx.test.runner.AndroidJUnitRunner
```

Live relay/backend verification uses a relay server reachable from the Windows-hosted emulator at `10.0.2.2`. The websocket E2E logs in to the relay, opens `/relay/devices/:deviceId/ws`, sends `supervisor.ping`, and waits for the private supervisor to return `supervisor.pong`. The backend E2E logs in, verifies the selected relay device is online, creates or finds a workspace, starts a real Codex-backed thread, sends a prompt, and polls the real thread detail until the expected Codex reply appears.

```bash
/home/u/bin/adb-windows shell am instrument -w -r --user 0 \
  -e class com.remotecodex.android.e2e.RelayWebSocketE2ETest \
  -e relayBaseUrl http://10.0.2.2:18788 \
  -e relayUsername androide2e \
  -e relayPassword androidpassword \
  -e relayDeviceId 971c9750-623a-43ee-a8af-5205a53c7581 \
  com.remotecodex.android.test/androidx.test.runner.AndroidJUnitRunner

/home/u/bin/adb-windows shell am instrument -w -r --user 0 \
  -e class com.remotecodex.android.e2e.RelayBackendE2ETest \
  -e relayBaseUrl http://10.0.2.2:18788 \
  -e relayUsername androide2e \
  -e relayPassword androidpassword \
  -e relayDeviceId 971c9750-623a-43ee-a8af-5205a53c7581 \
  -e workspacePath /home/u/dev/remote-codex-android-instrumented-e2e-workspace \
  -e expectedReply android-websocket-refresh-ok \
  com.remotecodex.android.test/androidx.test.runner.AndroidJUnitRunner
```

## Near-Term Roadmap

1. Bind the connected mode to a minimal home screen: active threads, workspaces, and pending confirmations.
2. Replace sample thread detail data with `GET /api/threads/:id` or relay-forwarded equivalents.
3. Replace the first-pass websocket refresh with a real event reducer for streaming output, live items, pending requests, reconnect reconciliation, and foreground resume.
4. Move stored auth tokens from SharedPreferences to Android Keystore before broader remote usage.
5. Add relay device deletion/revocation and shared-session selection.
6. Add voice mode as a native feature instead of mirroring the web composer.
7. Replace artifact fallbacks with richer native renderers where they are worth maintaining.
