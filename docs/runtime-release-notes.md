The terminal now docks below chat with a compact VS Code inspired layout, while the file explorer remains alongside it.

- Resize, maximize, collapse and hide the bottom terminal panel. Terminal groups, split proportions and panel size survive reloads; switching chat focus preserves running sessions.
- Desktop terminal tabs support splitting, renaming, reconnecting and terminating sessions. Mobile uses a compact session switcher and direct input at the terminal cursor, with Ctrl/Esc/Tab/arrow keys above the Android soft keyboard. Mobile splits no longer use a misleading full green outline.
- PTY reconnects replay recent output without duplication and remove exited processes from the session list.
- Fix virtualized file-tree gaps after hiding/reopening the explorer. Returning from an external linked image now shows its real parent path rather than a fictitious “linked files” folder.

Verified with targeted Rust and shared UI regressions, desktop/mobile Chromium terminal and explorer E2E, and a headless Android 14 emulator running Chrome and Gboard. Real Gboard typing/Enter, backspace, command history, Ctrl+C, long-output cursor visibility and keyboard dismissal were exercised.

Runtime installation and updates continue to use immutable GitHub Release native artifacts. This release does not change the independently released Windows Device Manager.
