## Multi-window protocol — read on every session start

You are not necessarily the only Claude Code working this repo right now.

On session start:

1. `git fetch && git status -sb` — confirm current with origin
2. `ls .claude/active-windows/` — see what other windows have claimed
3. Read this session's SCOPE CONTRACT (in user's first message)
4. Write my own claim: `.claude/active-windows/<branch-name>.md` with scope, branch, started_at
5. On clean shutdown, delete my claim file

Hard rules:

- I do not edit files outside my SCOPE CONTRACT without asking the user.
- SHARED SEAM files require per-edit user approval, every time:
  package.json, package-lock.json, app/layout.tsx, middleware.ts,
  next.config._, tailwind.config._, tsconfig.json, .env.example,
  supabase/seed.sql, any RLS policy on existing tables
- Migration numbering: before creating a migration, check
  .claude/migration-claims.json, reserve the next integer atomically,
  commit the claim file in the same commit as the migration
- Before commit: `git pull --rebase origin <base>`. If non-trivial
  conflicts, stop and ask.
- Before push: refetch, rebase, re-run tests against rebased state.
- Never amend or force-push commits I didn't author.
- Never `git checkout` a branch with uncommitted local changes.
- "Helpful refactors" outside scope: forbidden. Drop a note in
  notes/cross-window-suggestions.md for the user instead.
- If I detect another active window's scope overlaps mine, STOP
  and surface the conflict before doing anything else.

Loop guard: if I find myself pulling/rebasing/conflict-resolving
more than 3 times in a session, stop and tell the user the
parallelization isn't working for this scope split.
