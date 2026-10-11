# .scratch

Local working space for agents and people. Everything here except this file is
ignored by git.

Put temporary material here, never in `docs/`:

- plans, task lists and progress notes;
- investigation notes and test or verification evidence;
- screenshots, logs and drafts.

Each checkout and git worktree has its own `.scratch/`, because git does not
share ignored files. When pointing someone to your notes, give the absolute path.

Use one folder per task, for example `.scratch/2026-10-11-docs-cleanup/`. Before
finishing, move anything with lasting value into the right document under
`docs/` (see [docs/README.md](../docs/README.md)), and delete the rest when it is
no longer needed.
