# Android Deferred Backlog

This document holds Android backlog items that are outside the user-selected completion scope for the current parity goal. Keep shell and terminal parity excluded unless explicitly re-enabled by product policy.

## Deferred App Shell And Settings

- A3. Provider config archives: support low-risk archive list/create backup for `/api/config/providers/:provider/archives`; defer apply until restart policy is explicit.
- A4. Runtime install/update/build/restart actions: expose host-changing runtime operations only after confirmation and recovery UX are defined.
- A6. Plugin policy completion: add uninstall when the backend route exists, plus trusted renderer policy and clearer plugin permission/risk states.

## Deferred Composer And Thread Actions

- C3. MCP config write: add native editable forms for MCP configuration changes.
- C4. Hook create/update forms: add native forms for hook creation, editing, and command-template configuration.

## Deferred Workspace And Files

- D1. Workspace refresh and file mutation: add refresh behavior plus file write, rename, delete, and other supported mutations.
- D2. Garbage folder mutation: wire the empty-garbage confirmation to a real backend mutation and refresh the workspace state.
- D3. Workspace tree parity: add artifact/event/live roots, preview source switching, and Web-like explorer state.
- D4. File preview drill-in: improve binary, large-file, image, unknown-type, and attachment detail flows.
- D5. Workspace card reuse: broaden workspace info cards across file previews, graph node detail, and future plugin panels.

## Deferred Markdown, Code, And Images

- E4. Shiki parity for code blocks: add richer language grammars, themes, token scopes, line metadata, and diff/code viewer details.
- E5. Non-molecule inline artifacts: define and implement renderers or fallback policy for plugin-rendered inline artifact types.

## Deferred Tool Calls, History Items, And Artifacts

- F3. Plugin-aware tool/artifact renderers: decide native renderer, WebView fallback, or server-rendered preview strategy.
- F6. Full artifact viewers: implement artifact-specific viewers beyond the current fallbacks.
- F7. Molecule 3D viewer: add 3D rendering, bond perception, frame slider/playback, atom selection, camera controls, screenshots, and unit-cell toggling.
- F8. Graph editor/viewer: add pan/zoom, draggable nodes, edge selection, live connection preview, and React Flow layout parity.

## Deferred UI Primitive And Interaction Polish

- G1. Graph UI primitive states: complete pressed, loading, focus, active, disabled, and error states across buttons, badges, dialogs, inputs, and sliders.
- G2. Long-press tooltip/popover behavior: add mobile explanations for dense icon controls where content descriptions are not enough.
- G3. Dialog trigger/portal parity: align trigger, focus, back/escape, and overlay behavior with the Web primitives.
- G4. Tablet/desktop resizable panels: implement drag resizing for larger Android form factors.
- G5. Screenshot-based visual E2E: create repeatable emulator screenshot checks against representative Android surfaces and Web reference states.

## Deferred Voice And Notifications

- H1. Native voice session: implement microphone permission, audio session management, push-to-talk, barge-in, Bluetooth headset handling, and foreground/background lifecycle.
- H2. Voice action protocol: connect Android voice mode to backend voice session, action, and confirmation policy when available.
- H3. Push notification bridge: add Android notifications for completed turns, failures, permission required, input required, and agent disconnects.
