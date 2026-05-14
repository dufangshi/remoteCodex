# Remote Codex Supervisor Design Context

## Current System

The frontend is a React and Vite product UI using Tailwind CSS v4. Most styling is expressed as utility classes plus global theme variables in `apps/supervisor-web/src/index.css`. The app supports light, dark, and system theme modes through `data-theme-effective` on the document root.

## Theme Direction

The current visual language uses warm tinted neutrals, stone surfaces, and amber accents. Keep the product restrained: the interface is for repeated operational use, often from a phone while monitoring local Codex work. The default dark scene is a developer checking active work in a dim room or on a secondary device. Light mode should remain practical for daytime mobile use.

Avoid pure black and pure white. Prefer existing theme variables:

- `--app-bg` and `--app-fg` for page-level shell color.
- `--theme-panel` for durable panels and navigation surfaces.
- `--theme-surface` and `--theme-surface-strong` for nested operational surfaces.
- `--theme-muted`, `--theme-hover`, and `--theme-border` for quiet structure.
- `--theme-accent-*` for primary action and focused attention.

## Color Rules

- Amber is the primary action and attention color, not a universal decoration.
- Success, warning, danger, and informational states should use semantic colors with enough contrast in both themes.
- Avoid gray text on saturated color backgrounds. Use near-black or near-white when contrast requires it, or a hue-specific foreground token.
- Avoid pure black or pure white utility classes and hex values in new UI.
- Prefer token-backed classes or CSS variables over new hard-coded color combinations.

## Typography

The current stack is IBM Plex Sans with Segoe UI fallback. Keep type compact and readable. Use uppercase tracking only for small metadata labels, not primary controls. Body text should stay within comfortable line lengths. Thread titles, workspace names, session IDs, shell output, and status labels must survive long content without layout breakage.

## Layout

This is a product console. Favor dense but organized layouts, predictable navigation, and stable dimensions. Cards are acceptable for repeated thread or workspace items, but avoid cards inside cards. Thread detail and thread list routes intentionally lock the viewport, so polish work must check overflow, safe areas, mobile keyboards, and fixed composer behavior.

## Components And Patterns

- App shell navigation lives in `AppShellNavigation.tsx`.
- Thread and workspace navigation patterns live around `ThreadWorkspaceLayout.tsx`.
- Thread event display lives in `ThreadTimeline.tsx`.
- Thread input and execution controls live in `ThreadComposer.tsx`.
- Shared confirmation and rename flows use `ConfirmDialog.tsx` and `RenameDialog.tsx`.

Prefer improving shared patterns before one-off class edits. If a button, badge, dialog action, or timeline state appears in several places, align it at the pattern level.

## Interaction

Every interactive element needs visible hover, focus, active, disabled, loading, and error states where applicable. Touch targets should be at least 44px on mobile unless the element is clearly secondary and grouped in a dense desktop-only control. Keyboard navigation should stay predictable, especially for menus, dialogs, thread cards, and composer controls.

## Motion

Use motion sparingly. State changes can transition color, opacity, and transform over short durations. Do not animate layout properties. Respect reduced motion. Avoid bounce and elastic easing.

## Known Polish Targets

- Replace or justify thick left accent borders in timeline items where they are decorative.
- Normalize colored button foregrounds to avoid gray-on-color combinations.
- Remove pure black utility usage from navigation shadows or overlays.
- Reduce amber overuse by separating primary action, warning, and informational states.
- Audit mobile thread detail for overlap between timeline, shell panel, top controls, and composer.
