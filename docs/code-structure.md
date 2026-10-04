# Code structure and size budget

AGENTS.md sets a hard ceiling for this tree: **stay under 50k lines**. That
budget is why the code is deliberately dense. Do not "clean up" by expanding
terse-but-clear code across more lines, and do not treat a low line count as a
goal in itself — the budget constrains scope, it does not reward golfing.

## Measuring

Regenerate the numbers below rather than trusting them; they drift.

```sh
# Rust total against the 50k budget
find crates -name '*.rs' -not -path '*/target/*' | xargs wc -l | tail -1

# Largest Rust modules
find crates -name '*.rs' -not -path '*/target/*' | xargs wc -l | sort -rn | head -20

# Web surfaces
find apps/supervisor-web/src -name '*.ts*' -o -name '*.css' | xargs wc -l | sort -rn | head -15
find remote-codex-thread-ui/packages -name '*.ts*' -o -name '*.css' \
  | grep -v node_modules | grep -v /dist/ | xargs wc -l | sort -rn | head -15
```

Snapshot at 2026-09-29: Rust 43.2k (86% of budget), `apps/supervisor-web` 30.0k,
`remote-codex-thread-ui` 59.7k.

## The split convention

Large modules use a `foo.rs` + sibling `foo/` directory pair. The parent file
keeps the public surface and the directory holds cohesive internals. This is an
established pattern, not a proposal — follow it rather than inventing a new one:

| Parent | Directory |
| --- | --- |
| `runtime/src/service.rs` | `service/{reliability,update}.rs` |
| `runtime/src/upstreams.rs` | `upstreams/discovery.rs` |
| `runtime/src/interaction/mod.rs` | `interaction/{agents,inbox,tasks,transcript}.rs` |
| `supervisor/src/secure_transport.rs` | `secure_transport/streams.rs` |
| `relay/src/auth_api.rs` | `auth_api/passkeys.rs` |

Note that `relay/src/public_links.rs` uses `use super::*;`. Sibling modules in
`relay` lean on `lib.rs` internals this way, so extracting from `relay/src/lib.rs`
means deciding what becomes genuinely public on the parent rather than moving
code blindly.

## Modules that most need splitting

Ranked by size. These are candidates, not a mandate — split when you are already
working in the file, so the change carries test coverage with it.

| File | Lines | Notes |
| --- | --- | --- |
| `crates/relay/src/lib.rs` | ~6.8k | By far the largest. Sibling modules already `use super::*`, so plan the public surface first. |
| `crates/runtime/src/service.rs` | ~3.6k | Already has a `service/` directory to grow into. |
| `crates/runtime/src/acp/runtime.rs` | ~3.1k | Inside the harness boundary; keep adapters thin. |
| `crates/relay/src/hosted.rs` | ~2.3k | |
| `crates/supervisor/src/http.rs` | ~2.1k | Route table plus handlers; handlers extract more cleanly than the router. |
| `apps/supervisor-web/src/pages/ThreadDetailPage.tsx` | ~3.7k | Follow the existing `threadDetailModel.ts` / `useThreadAuxiliaryActions.ts` / `useThreadWorkspaceAdapter.ts` extraction pattern. |
| `apps/supervisor-web/src/pages/RelayAdminPage.tsx` | ~3.2k | |
| `apps/supervisor-web/src/pages/RelayDevicesPage.tsx` | ~2.6k | |
| `thread-ui/.../graph-chat/GraphChatHistoryItems.tsx` | ~1.6k | |
| `thread-ui/.../ThreadWorkspaceLayout.tsx` | ~1.4k | |

CSS is measured but excluded from splitting pressure:
`thread-ui/src/styles/history-markdown.css` (~3.0k) is a single cohesive
stylesheet, and breaking it up risks cascade-order regressions for no structural
gain.

## Testing a split

Per AGENTS.md, run regressions **in proportion to the change** — a targeted
`cargo test -p <crate> <test-name>` plus `cargo fmt`/`cargo check`, not
`cargo test --workspace` and not a platform matrix. A pure module move should be
behaviour-preserving; if it needs test changes beyond import paths, it is not a
pure move and deserves closer review.
