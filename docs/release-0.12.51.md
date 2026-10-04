# Remote Codex 0.12.51

- Parent CLI cleanup: `thread delete CHILD_ID` authenticates the managed parent,
  refuses unrelated/active/queued/recursive deletion, and releases only the child's
  independent idle harness. Recorded results and workspace files remain intact.
- Explorer: desktop rail and mobile navigation shortcuts; download, relative-path
  copy, absolute-path copy, and a menu with rename/delete confirmation. Read-only
  sharing cannot mutate files. Workspace root, escapes, symlink targets and existing
  rename destinations are protected.
- Shared families: parent shares include existing and future descendants, with
  inherited permissions and revocation. Device-authenticated lineage snapshots
  contain only parent IDs. Siblings/unrelated roots remain inaccessible. Models are
  discovered from the addressed thread's provider/agent/workspace; controls no
  longer reuse another thread's GPT catalog. Sidebar and tabs count the same family,
  including children in other workspaces.
- Claude timers: finished native scheduled replies/tools are recovered into thread
  history and notify idle pages. The always-visible Watches control shows cadence,
  cron expression, task text, last trigger, expiry and session status. Cancelled,
  expired and fired one-shot jobs are removed. New owned turns identify their actual
  harness instance after settings preflight; older jobs without that evidence are
  unconfirmed. Native jobs do not persist after harness exit/restart.
- Pricing: official Opus 5.5, Sonnet 5.5 and Mythos 5.1 entries and current native
  Opus/Fable aliases. Opus 5.5 costs $4 input/$20 output/$0.20 cache read per million
  tokens, 5-minute cache write $5; fast doubles the rates. Sonnet 5.5 is
  $2/$10/$0.20/$2.50. The full 1M context uses standard rates. Explicit older models
  retain their separate rates.

Price source checked 2026-10-04:
https://platform.claude.com/docs/en/about-claude/pricing

Local validation used isolated services/data/build cache. Targeted Rust tests cover
parent authorization, process release, lineage isolation, path protection, pricing,
scheduled-history recovery and cadence parsing. Explorer browser acceptance passes
on desktop and mobile; encrypted shared-family acceptance verifies Claude models,
effort changes, cross-workspace descendants, matching group counts, watch visibility
and cancellation, unrelated-thread refusal and both share/grant revocation.

Publication includes the runtime/npm package, all four native assets and relay Web
deployment. Device Supervisors must use Settings → Check/Update for the new runtime
endpoints; active host/WSL Supervisors are not automatically upgraded or stopped.
