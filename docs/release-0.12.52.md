# Remote Codex 0.12.52

Includes the parent cleanup, shared families/provider controls, Claude watch UI
and pricing, and Explorer actions from 0.12.51. Fixes the default-width desktop
Explorer: its file column keeps a 144px minimum so the download and clipboard/menu
controls cannot extend behind the chat area.

The browser regression now exercises all file operations at the default width,
without dragging the panel wider. Desktop acceptance passed. The CSS applies only
to the desktop side Explorer; mobile and full workspace layouts retain their
existing sizing. The published 0.12.51 assets remain immutable.
