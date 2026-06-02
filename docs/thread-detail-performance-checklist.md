# Thread Detail Performance Checklist

This checklist tracks the prompt input lag investigation for the thread detail view.

Rule: when an item is completed, update this document in the same change and mark that item with `[x]`. A task is not considered complete until its checkbox is checked here.

## Scope

- `apps/supervisor-web/src/pages/ThreadDetailPage.tsx`
- `apps/supervisor-web/src/components/ThreadTimeline.tsx`
- `apps/supervisor-web/src/components/ThreadComposer.tsx`
- `apps/supervisor-api/src/thread-detail-assembler.ts`
- `apps/supervisor-api/src/thread-history-items.ts`

## High Priority

- [x] Memoize `ThreadTimeline` and stabilize the props passed from `ThreadDetailPage`.
  - Wrap the exported timeline component with `memo`.
  - Replace inline fallback arrays such as `detail.answeredRequestNotes ?? []`, `detail.activityNotes ?? []`, and `detail.pendingSteers ?? []` with stable empty-array references.
  - Replace inline callbacks such as `onLoadHistoryItemDetail={(itemId) => ...}` with `useCallback`.
  - Verify that prompt typing does not re-render `ThreadTimeline` when timeline data has not changed.

- [x] Replace the full `contentSignature` `JSON.stringify` path in `ThreadTimeline`.
  - Remove the per-render full traversal over loaded turns, items, notes, requests, live items, and optimistic state.
  - Prefer a narrow revision value or smaller change marker that only changes when timeline content changes.
  - Keep auto-scroll behavior correct for new turns, live output, live items, plans, pending requests, answered notes, and bottom spacer changes.
  - Measure before and after with a loaded-history thread.

- [x] Stop background loading from automatically accumulating the full thread history in `detail.turns`.
  - Review the effect that starts from the initial 3-turn load and repeatedly fetches `DETAIL_TURN_PAGE_SIZE` earlier turns.
  - Either remove automatic earlier-history loading, cap it, or store prefetched turns outside the rendered `detail.turns` list.
  - Preserve the manual "Load earlier" recovery path.
  - Confirm that old history no longer increases prompt-input cost unless the user explicitly displays it.

- [x] Add a render window for server-managed history.
  - Current server-managed mode renders every loaded turn because `visibleTurns = turns`.
  - Ensure loaded history and rendered history are separate concepts.
  - Keep `totalTurnCount`, hidden count, manual loading, absolute turn numbers, active turn visibility, optimistic turns, pending requests, and activity anchors correct.
  - Prefer turn-level windowing first; consider full virtualization only after measuring.

- [x] Re-check markdown and Streamdown rendering after timeline isolation.
  - Verify whether completed markdown messages re-render while typing in the prompt.
  - If they still re-render, add stronger memoization or cache completed markdown rendering.
  - Keep streaming output as cheap as possible and avoid expensive markdown work while a turn is actively streaming.

- [x] Reduce `ThreadComposer` contentEditable work if it remains slow after timeline isolation.
  - Measure `serializeEditorPrompt`, `snapshotSelection`, attachment filtering, DOM sync, and selection restoration costs.
  - Avoid changing the rich editor architecture until timeline and parent-render causes are removed.
  - If still needed, consider a plain textarea path for text-only prompts or a ref/debounced draft model that does not update React state on every keystroke.

## Medium Priority

- [x] Throttle or deprioritize live output updates while preserving responsiveness.
  - Review `queueLiveOutputDelta` and frame-based `setLiveOutput`.
  - Consider coarser batching, `startTransition`, or another low-priority update path for timeline/live rendering.
  - Verify that typing during active streaming remains responsive.
  - Preserve tail-follow behavior and final transcript correctness.

- [x] Reduce scroll measurement and auto-scroll work.
  - Audit `getBoundingClientRect`, `scrollHeight`, `scrollTop`, `ResizeObserver`, and tail visibility effects.
  - Ensure prompt typing does not cause timeline scroll effects when timeline content did not change.
  - Consider an IntersectionObserver-based tail sentinel if manual visibility checks remain expensive.
  - Re-test mobile keyboard, bottom spacer, and follow-tail behavior.

- [x] Expand preview/deferred-detail handling for large non-command history items.
  - Command and tool details are already deferred, but long agent messages, reasoning, file changes, file reads, web searches, hooks, artifacts, or images may still be heavy.
  - Identify item kinds that can carry large text into the timeline.
  - Add preview/detail split or collapsed rendering where the full content is not needed immediately.
  - Ensure transcript export and detail dialogs still expose full content.

- [x] Avoid full-detail backend materialization for paged detail requests where possible.
  - Review `ThreadDetailAssembler.buildCacheEntry` and `sliceTurnsForDetail`.
  - Avoid building or merging full turn history when the request only needs the latest page.
  - Add or preserve adapter-level pagination where runtime providers support it.
  - Keep active-thread refresh lightweight enough that it does not compete with prompt input.

## Required Verification

- [x] Add or run a profiler check proving prompt typing no longer causes unrelated timeline renders.
- [x] Test a short thread, a 10-turn thread, and a long thread with 30 or more turns.
- [x] Test while a turn is actively streaming live output.
- [x] Test mobile viewport behavior with the floating composer and keyboard inset.
- [x] Run targeted web tests for `ThreadDetailPage`, `ThreadTimeline`, and `ThreadComposer`.
- [x] Record the before/after measurement summary in this document or the implementing PR.

## Verification Notes

- Before: prompt draft updates in `ThreadDetailPage` recreated timeline props and forced `ThreadTimeline` to traverse loaded history via a full `JSON.stringify` content signature. With many loaded turns, each keystroke could compete with timeline markdown, scroll, and history rendering work.
- After: a regression test counts `ThreadTimeline` renders while typing in the composer and verifies the timeline render count stays unchanged when timeline inputs are unchanged. The full-history signature path is gone, server-managed history renders through the same 10-turn window, and earlier history is only added to the rendered set after explicit user action.
- Added a `ThreadDetailPage` regression test that counts `ThreadTimeline` renders and verifies typing into the chat composer does not re-render the timeline when timeline props are unchanged.
- `ThreadTimeline.test.tsx` covers the 35-turn long-history render window, remote-paged "Load earlier" behavior, live output attachment, streaming live items, auto-scroll, and ResizeObserver growth behavior.
- `ThreadDetailPage.test.tsx` covers the small initial 3-turn page, manual earlier-turn loading, active streaming websocket output, mobile realtime header behavior, and floating mobile composer layering.
- Targeted verification passed with:
  - `pnpm --filter @remote-codex/supervisor-web test -- ThreadTimeline ThreadDetailPage`
  - `pnpm --filter @remote-codex/supervisor-web test -- ThreadDetailPage ThreadTimeline ThreadComposer`
  - `pnpm --filter @remote-codex/supervisor-api test -- app`
- Final verification passed with:
  - `pnpm --filter @remote-codex/supervisor-web typecheck && pnpm --filter @remote-codex/supervisor-api typecheck && pnpm --filter @remote-codex/supervisor-web test && pnpm --filter @remote-codex/supervisor-api test`
