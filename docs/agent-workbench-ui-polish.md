# Agent Workbench UI Polish Plan

## Scope

Target surface: Agent Workbench, the per-thread interface at `/threads/:id` for prompt input, agent timeline, thread state, goal monitor, and shell control.

Primary files:

- `apps/supervisor-web/src/pages/ThreadDetailPage.tsx`
- `apps/supervisor-web/src/components/ThreadComposer.tsx`
- `apps/supervisor-web/src/components/ThreadTimeline.tsx`
- `apps/supervisor-web/src/components/ThreadShellPanel.tsx`
- `apps/supervisor-web/src/components/ThreadWorkspaceLayout.tsx`
- `apps/supervisor-web/src/components/AppShellNavigation.tsx`
- `apps/supervisor-web/src/components/ConfirmDialog.tsx`
- `apps/supervisor-web/src/components/RenameDialog.tsx`
- `apps/supervisor-web/src/components/threadPresentation.ts`
- `apps/supervisor-web/src/index.css`

## Baseline Findings

Impeccable static scan of Agent Workbench files found:

- 13 `gray-on-color` warnings.
- 12 `side-tab` warnings.
- 1 `pure-black-white` warning.

Rendered URL scan of `http://127.0.0.1:4173/threads/7ecbb6f0-6e24-4b93-9c00-d99b42906a05` also found:

- Low contrast text, including ratios below WCAG AA.
- Repeated side-tab timeline cards.
- Long text line lengths around 102 characters.
- Cramped padding on small chips.
- Many nested card-like containers.
- Many touch targets below 44px, especially on mobile.

## Recommended Name

Use **Agent Workbench** as the product-facing name. Use **Thread Workbench** only when a technical distinction is needed.

Subsurface names:

- Prompt Composer: bottom input and mode controls.
- Agent Timeline: conversation, tool activity, file changes, plans, and command history.
- Shell Panel: terminal view.
- Run Status: thread connection, active turn, goal monitor, and related controls.

## Task List

- [x] Install and configure Impeccable skill and CLI.
- [x] Create `PRODUCT.md` and `DESIGN.md`.
- [x] Run baseline Impeccable audit/critique on Agent Workbench.
- [x] Add semantic status/action color tokens and migrate high-impact controls away from ad hoc Tailwind color pairs.
- [x] Fix low-contrast and gray-on-color issues in Prompt Composer, Agent Timeline, dialogs, and Run Status controls.
- [x] Replace timeline default `border-l-2` side-tab accents with product-style role markers, full borders, and subtle state tints.
- [x] Reduce nested card depth inside Agent Timeline where spacing, dividers, or typography can carry hierarchy.
- [x] Cap prose line length in agent/user messages while preserving code, terminal, and table width.
- [x] Improve mobile touch targets for Prompt Composer controls, Run Status controls, copy buttons, and compact timeline actions.
- [x] Remove pure black overlay usage in settings/dialog surfaces.
- [x] Re-run Impeccable static scan and rendered URL scan.
- [x] Run focused frontend tests and typecheck.
- [x] Capture desktop and mobile screenshots for visual verification.

## Mobile Light Density Follow-up

Current target: make Agent Workbench denser and calmer on phones in light mode without changing low-priority controls.

In scope:

- [x] Fix remaining light-mode gray-on-warm and low-contrast text in selected navigation, timeline metadata, batch rows, and pending action cards.
- [x] Reduce the light-mode glare from large near-white panels while keeping the composer and active content legible.
- [x] Rework mobile timeline nested cards so inner command/tool/search/file-change groups read as compact sections or divided rows instead of card-inside-card stacks.
- [x] Preserve desktop timeline hierarchy, except where shared semantic classes improve consistency.
- [x] Re-run Impeccable rendered scan and mobile screenshot checks against light mode.

Out of scope for this pass:

- Do not do a broad touch-target pass for low-frequency controls.
- Do not change token/price summary badge sizing or layout.

Follow-up verification:

- `pnpm --filter @remote-codex/supervisor-web typecheck` passed.
- `pnpm --filter @remote-codex/supervisor-web test -- ThreadTimeline ThreadDetailPage` passed; Vitest matched 12 files and 147 tests.
- Mobile Puppeteer audit at `390x844`, DPR 3, touch enabled found no horizontal overflow in light or dark mode.
- Mobile screenshot artifacts:
  - `/tmp/agent-workbench-mobile-light-density.png`
  - `/tmp/agent-workbench-mobile-dark-density.png`
- `pnpm exec impeccable detect --json http://127.0.0.1:5173/threads/7ecbb6f0-6e24-4b93-9c00-d99b42906a05` still reports broad `nested-cards` warnings on the rendered page. Treat this as residual because the CLI uses its own rendered viewport and cannot target the mobile breakpoint; the mobile DOM audit confirms the new mobile inner timeline sections render without extra background-card layers.

## Mobile Command And File Density Follow-up

Target: reduce vertical height for `commandExecution`, `fileChange`, `commandGroup`, and `fileChangeGroup` on phone layouts, especially the blank top area created by the mobile corner badge plus nested section padding.

- [x] Use Playwright API on a `390x844` mobile viewport to measure actual rendered heights and top offsets.
- [x] Add mobile-only dense classes for command/file events and their batch variants.
- [x] Reduce dense event outer padding, inner top offset, badge size, batch toggle height, and batch chip padding.
- [x] Keep the change scoped to command/file-change rows; do not compress regular message/search/tool rows in this pass.
- [x] Re-run typecheck and focused timeline tests.
- [x] Capture final mobile screenshot and record measurement delta.

Measurement notes:

- Before: visible `fileChangeGroup` rows were typically `80px`; the visible `commandGroup` row was `69px`. Outer top padding was `10px`; inner content started about `11px` below the outer top.
- After CSS pass: visible `fileChangeGroup` and `commandGroup` rows measured `46px`. Outer top padding is about `3.5px`; inner content starts about `5px` below the outer top.
- Current audit thread has only batch command/file rows (`7` file-change groups, `1` command group), but the same dense class is applied to single command and file-change components for future single-row cases.
- Final screenshot: `/tmp/agent-workbench-command-file-density-final.png`.

## Mobile Tight-Corner Bubble Follow-up

Target: compress all mobile timeline bubbles further while keeping message text clear.

- [x] Make mobile timeline bubbles use a square top-left corner, with the other three corners still rounded.
- [x] Shrink the mobile category badge to the sharp top-left corner.
- [x] Reduce mobile bubble vertical padding to nearly zero for normal messages, command/file rows, and command/file batches.
- [x] Add a first-line-only float reserve in mobile message prose so the top-left badge does not cover text, without adding permanent left padding to the whole message.
- [x] Verify light and dark mobile layouts with Playwright geometry checks and screenshots.
- [x] Re-run Impeccable rendered scan, focused tests, and typecheck.

Measurement notes:

- Normal user/agent message bubbles now report `border-top-left-radius: 0px`, about `0.96px` top padding, and about `1.28px` bottom padding on a `390x844` mobile viewport.
- The first rendered text range starts around `x=32px` while the mobile badge ends around `x=24px`, so Playwright reports `0` badge/text overlaps in both light and dark modes.
- `fileChangeGroup` samples remain `29px` tall after the overlap fix, so the first-line reserve did not undo the command/file density pass.
- Mobile light and dark screenshots:
  - `/tmp/agent-workbench-tight-corner-light-rangefix.png`
  - `/tmp/agent-workbench-tight-corner-dark-rangefix.png`
- Impeccable still reports `cramped-padding`; this is expected for this pass because the user explicitly requested near-zero vertical padding. Remaining `nested-cards`, line-length, single-font, and palette warnings are inherited broad rendered-page warnings rather than blockers for the tight-corner bubble change.

## Mobile Corner Copy Follow-up

Target: make the agent message copy affordance match the compact corner-icon language instead of using the previous large touch-target block.

- [x] Scope right-bottom sharp corners only to timeline bubbles that actually have a corner copy action.
- [x] Remove the timeline copy button from the mobile `2.75rem` generic touch-target rule.
- [x] Split the copy control into a small visual glyph and a slightly larger hit area.
- [x] Match the copy visual size to the top-left category badge on mobile.
- [x] Verify mobile light/dark geometry and screenshots with Playwright.
- [x] Re-run Impeccable rendered scan, focused tests, and typecheck.

Measurement notes:

- Top-left category badge remains about `15x15px`.
- Right-bottom copy visual now measures about `15x15px`, with a `20x20px` hit area. That keeps the interaction target roughly 30% larger than the visual control without returning to the old large button.
- Agent message bubbles with copy controls report `border-bottom-right-radius: 0px`; sampled user/message-free and command/file dense bubbles still keep their rounded bottom-right corners.
- Playwright mobile light/dark geometry found `0` horizontal overflow.
- Mobile screenshot artifacts:
  - `/tmp/agent-workbench-copy-corner-light.png`
  - `/tmp/agent-workbench-copy-corner-dark.png`
- Impeccable still reports the expected broad warnings from the dense rendered page (`cramped-padding`, `nested-cards`, `line-length`, single-font/palette warnings). No new rendered issue is specific to the compact copy corner.

## Mobile Tool Bubble Alignment Follow-up

Target: align single command/file/search rows with the already-compressed batch file-change pattern.

- [x] Apply the mobile dense outer frame and sharp top-left corner treatment to single file-change rows.
- [x] Wire single and batch web-search rows to the same mobile dense classes, even though the current audit thread has no web-search samples.
- [x] Keep single command rows on the same dense command class and distinguish command/file/search families for future measurement.
- [x] Remove the right-side circular expand affordance from command, file-change, and web-search batches. The whole row still toggles expansion through `aria-expanded`.
- [x] Convert single file-change content from a two-line label/path layout into a compact one-line path plus delta summary.
- [x] Make file delta badges less round and vertically centered.
- [x] Confirm image bubbles are not accidentally pulled into the file dense class.
- [x] Verify with Playwright, Impeccable, typecheck, and focused tests.

Measurement notes:

- Playwright mobile `390x844`, light/dark: horizontal overflow remains `0`.
- Real single `fileChange` samples now measure about `30px` tall with `border-top-left-radius: 0px`.
- Real `fileChangeGroup` and `commandGroup` samples remain about `29px` tall and report `expandIconCount: 0`.
- Delta badges now measure about `19px` tall, use about `4.48px` radius, and report `align-items: center` plus `justify-content: center`.
- Current audit thread has no single command or web-search samples, but the React branches now use `timeline-mobile-dense-command` / `timeline-mobile-dense-search` classes for those cases.
- Screenshot artifacts:
  - `/tmp/agent-workbench-dense-tools-light-final.png`
  - `/tmp/agent-workbench-dense-tools-dark-final.png`
- Impeccable still reports the expected broad dense-page warnings (`cramped-padding`, `nested-cards`, `line-length`, single-font/palette warnings). These are not specific regressions from this tool-bubble alignment pass.

## Mobile Composer And Tail Clearance Follow-up

Target: keep the mobile prompt controls compact and make the Agent Timeline tail fully reachable above the floating composer.

- [x] Remove the single file-change `completed` status text from the compact row.
- [x] Keep single command execution status icon-only: completed renders as a compact green check, non-completed states render the compact running dots.
- [x] Override the broad mobile `2.75rem` button minimum inside the Prompt Composer toolbar so slash, add, and shell/chat controls return to their explicit `h-7 w-7` sizing.
- [x] Measure the floating mobile composer host by viewport overlap, not only by the inner form height.
- [x] Feed the measured composer overlap into `ThreadTimeline` `bottomSpacer` so scrolling to the bottom leaves the tail sentinel above the prompt input and its toolbar.
- [x] Re-run typecheck, focused tests, Playwright mobile measurements, and Impeccable rendered scan.

Implementation notes:

- The bottom spacer now uses the larger of the composer host overlap and the form-height fallback, plus a small guard gap. This covers the prompt input, its toolbar row, safe-area padding, and keyboard-offset movement.
- The product decision for these toolbar buttons is density over 44px touch targets. They are low-height secondary controls grouped directly above the prompt, and the user confirmed the compact size is preferred.
- Playwright mobile `390x844` final measurement: Prompt Composer toolbar buttons are `28x28px`; timeline tail sentinel is about `12.8px` above the floating composer top after scrolling to bottom; horizontal overflow is `0`; sampled file-change rows contain `0` `completed` status labels.
- Focused frontend validation passed:
  - `pnpm --filter @remote-codex/supervisor-web typecheck`
  - `pnpm --filter @remote-codex/supervisor-web test -- ThreadTimeline ThreadDetailPage ThreadComposer` (Vitest matched 12 files, 148 tests passed)
- Impeccable rendered scan was run against `http://127.0.0.1:5173/threads/7ecbb6f0-6e24-4b93-9c00-d99b42906a05`. It still reports the expected broad dense-page warnings (`cramped-padding`, `nested-cards`, `line-length`, single-font/palette warnings), not a new warning specific to the compact toolbar or timeline tail clearance fix.
- Screenshot artifact: `/tmp/agent-workbench-mobile-composer-tail-final.png`.

## Desktop Corner Bubble Follow-up

Target: apply the successful mobile corner-bubble language to desktop Agent Workbench timeline rows.

- [x] Hide the old desktop left icon columns for message, command, tool, file-change, search, and batch timeline rows.
- [x] Promote the top-left category badge to the shared desktop treatment: square top-left corner, compact icon visual, and no separate column width.
- [x] Make agent-message copy controls match the corner-icon language on desktop: bottom-right sharp bubble corner, about `19px` visual glyph, and about `25px` hit area.
- [x] Add enough first-line/title-row reserve on desktop so text does not run under the top-left badge without reintroducing a full icon column.
- [x] Make dense command/file/search rows and their inner sections use a sharp top-left corner on desktop too.
- [x] Keep file delta badges compact and centered on desktop, matching the mobile rectangle treatment instead of large round pills.
- [x] Re-run Playwright desktop geometry checks, focused tests, typecheck, and Impeccable rendered scan.

Measurement notes:

- Playwright desktop `1440x1000`: horizontal overflow is `0`.
- Old desktop icon columns report `0` visible samples after the shared CSS pass.
- Top-left badge and copy visual both measure about `18.9x18.9px`; the copy hit area measures about `24.8x24.8px`.
- Sampled message and dense tool rows report `border-top-left-radius: 0px`; agent message rows with copy report `border-bottom-right-radius: 0px`.
- Text/badge overlap audit reports `0` overlaps after adding the desktop title-row reserve.
- Dense file/command samples measure about `38-39px` tall on desktop; delta badges measure about `18.9px` tall with about `4.5px` radius and centered content.
- The current audit thread has no visible single command status buttons or web-search rows, but those React branches use the same shared `.timeline-item-inner` / `.timeline-mobile-dense-inner` corner-button rules.
- Screenshot artifacts:
  - `/tmp/agent-workbench-desktop-corner-bubbles-final.png`
  - `/tmp/agent-workbench-desktop-dense-tools-final.png`
- Impeccable rendered scan against `http://127.0.0.1:5174/threads/7ecbb6f0-6e24-4b93-9c00-d99b42906a05` still reports expected broad dense-page warnings (`cramped-padding`, `nested-cards`, `line-length`, single-font/palette warnings). These are inherited from the intentionally compact operator-console layout and not specific regressions from the desktop corner-bubble sync.

## Desktop Message Density Follow-up

Target: fix the remaining desktop message-bubble wasted space visible in screenshots.

- [x] Remove the desktop `sm:bottom/right` offsets from agent-message copy buttons so the visual glyph sits in the actual bottom-right sharp corner.
- [x] Remove the agent-message `pb-7` reserve that made the copy button consume an extra logical text row.
- [x] Remove the desktop `62ch` message and markdown paragraph max-width so message text can use the full bubble width.
- [x] Replace the desktop whole-row left reserve with a small first-line-only float reserve, just enough to avoid the top-left icon.
- [x] Keep the old desktop left icon column hidden.
- [x] Verify with Playwright, Impeccable, typecheck, and focused timeline tests.

Measurement notes:

- Playwright desktop `1440x1000`: horizontal overflow is `0`; visible old icon column count is `0`.
- Copy icon visual is about `18.9x18.9px` and sits about `1px` from the right and bottom frame edges.
- Copy button no longer contributes any `::after` text-flow reserve; sampled message prose reports `::after` content `none`.
- Message prose and markdown paragraph max-width now report `100%` rather than `62ch`.
- First-line left gap from the bubble frame dropped from about `36px` to about `23px`, while badge/text overlap remained `0`.
- A sampled one-line long message used about `941px` of the `960px` content width, leaving about `9px` unused on the right.
- Screenshot artifacts:
  - `/tmp/agent-workbench-desktop-message-density-final.png`
  - `/tmp/agent-workbench-desktop-message-density-final-2.png`
- Impeccable rendered scan now emphasizes `line-length` warnings because full-width desktop text is an intentional density choice for this operator timeline. Remaining `cramped-padding`, `nested-cards`, single-font, and palette warnings are the existing broad dense-page warnings, not a blocker for this targeted fix.

## Implementation Order

1. `impeccable colorize`: status/action tokens, contrast fixes, semantic palette cleanup.
2. `impeccable layout`: Agent Timeline side-tab removal, nested card reduction, line-length caps.
3. `impeccable adapt`: mobile touch target and composer ergonomics.
4. `impeccable polish`: final consistency, focus/hover/disabled states, screenshots, tests.

## Notes For Future Agents

- This is a product UI, not a brand surface. Favor restrained, semantic color and dense but scannable structure.
- Do not hide core shell/thread controls on mobile. Reorganize them into touch-safe controls instead.
- Keep one-font product typography unless a clear product reason emerges. Current problems are hierarchy and contrast, not font pairing.
- Existing worktree may contain unrelated user changes. Do not revert them.

## Verification Notes

- `pnpm exec impeccable detect --fast --json` on Agent Workbench source files returns `[]`.
- Rendered scan against the current Vite dev server (`http://127.0.0.1:5173/threads/7ecbb6f0-6e24-4b93-9c00-d99b42906a05`) no longer reports `side-tab`; remaining rendered warnings are mainly light-theme contrast estimates where transparent elements are sampled as black, plus broader nested-card warnings for the intentionally dense control-room layout.
- Prose line width is capped through `.thread-message-prose` and `.agent-markdown` paragraph/list/heading rules. Code blocks, tables, terminal output, and inline operational data retain full available width.
- Follow-up light-mode polish adjusted global light tokens and light-only component overrides:
  - The outer app, sidebar, thread detail surface, timeline surface, message cards, and composer now have clearer brightness separation.
  - Amber is reduced on non-primary surfaces. Command/file/search group rows use muted semantic surfaces instead of saturated blocks.
  - `New Thread` and `Send` render with high-contrast light text on the primary brown action background.
  - Active sidebar thread text is darkened to avoid gray text on a warm selected background.
- Screenshot artifacts from this pass:
  - `/tmp/agent-workbench-current-desktop.png`
  - `/tmp/agent-workbench-current-mobile.png`
  - `/tmp/agent-workbench-light-polish.png`
  - `/tmp/agent-workbench-dark-polish.png`
  - `/tmp/agent-workbench-light-polish-2.png`
- Validation commands completed:
  - `pnpm --filter @remote-codex/supervisor-web typecheck`
  - `pnpm --filter @remote-codex/supervisor-web test -- ThreadComposer ThreadTimeline` (Vitest matched 12 files, 147 tests passed)
  - `pnpm --filter @remote-codex/supervisor-web test -- ThreadComposer ThreadTimeline ThreadDetailPage` (Vitest matched 12 files, 147 tests passed)
