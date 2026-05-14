# Remote Codex Supervisor Product Context

## Register

product

## Product Purpose

Remote Codex Supervisor is a single-user control surface for running and monitoring local Codex work from another device on a private Tailscale network. It exists to make active Codex threads, workspace selection, durable shells, runtime status, and recovery controls usable from a phone or secondary browser without exposing the local machine to the public internet.

The interface should feel like a focused operator console, not a marketing site. It should reduce uncertainty during long-running agent work, make thread state visible at a glance, and preserve control when the user is away from the host machine.

## Primary Users

- A developer operating their own workstation remotely.
- The same developer on a phone, tablet, or laptop over Tailscale.
- A power user who understands Codex, shells, workspaces, session IDs, runtime settings, and local files.

## Core Jobs

- Select a trusted workspace and start a new Codex thread.
- Resume, inspect, rename, or delete existing threads.
- Follow long-running turns and understand whether the system is running, waiting, failed, or complete.
- Send follow-up instructions without losing context.
- Use a per-thread shell for tests, inspection, and manual recovery.
- Manage local Codex host settings when remote access is the only convenient control path.

## Product Principles

- Operational clarity beats visual drama.
- The current thread, current workspace, running state, and next available action must be obvious.
- Dense information is acceptable when it stays scannable.
- Error states must include a recovery path, not just a label.
- Mobile layouts are first-class because remote use often happens from a phone.
- The UI should make local/private operation feel explicit and controlled.
- Avoid decorative SaaS patterns that add confidence theater without helping the user act.

## Tone

Plain, calm, technical, and concise. Use the same nouns everywhere: workspace, thread, turn, shell, supervisor, session. Prefer direct action labels over promotional copy.

## Anti-References

- Generic AI dashboard aesthetics: purple gradients, glow-heavy dark mode, oversized hero metrics, and abstract cards.
- Marketing landing pages that delay access to the actual console.
- Decorative glass panels and nested cards that reduce information density.
- Terminal cosplay that hides real state behind visual noise.
- Mobile views that simply compress a desktop dashboard.

## Strategic Design Direction

The product should read as a private control room for a developer's own machine: compact, stable, warm enough for long sessions, and precise enough for debugging. Visual hierarchy should come from structure, typography, spacing, and state treatment before decoration. Color should be restrained and semantic, with amber reserved for primary action or attention, not used as a universal accent.
