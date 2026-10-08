# Official draw.io viewer

`viewer-static.v32.3.0.min.js` is unmodified from jgraph/drawio v32.3.0, commit
`96f8c7acb719aa93f0108eecedf20c3afdcbe431`:
https://github.com/jgraph/drawio/blob/96f8c7acb719aa93f0108eecedf20c3afdcbe431/src/main/webapp/js/viewer-static.min.js

Upstream Apache-2.0 license is included as `LICENSE`; bundled third-party notices
are retained inside the script. The asset is served locally and only loaded when
opening a draw.io file, in a script-only sandbox with network access restricted
by CSP. No diagram is sent to the hosted diagrams.net viewer. External image/font
URLs and external stencil downloads are intentionally unavailable; embedded data
images and the shapes included in the official static viewer are supported.

The versioned filename matches the relay's immutable asset caching policy.

To update: pin a reviewed upstream commit, replace this script and license,
change the versioned filename and shared UI viewer path, and
run the actual draw.io Explorer rendering regression (both browser projects).
