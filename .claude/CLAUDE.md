## Multi-window protocol — read on every session start

You are not necessarily the only Claude Code working this repo right now.

On session start:

1. `git fetch && git status -sb` — confirm current with origin
2. `node scripts/window-status.mjs` — see what other windows have claimed and prune stale entries (use `--prune` to actually delete). Claims live in the **main checkout**'s `.claude/active-windows/`, resolved via `git rev-parse --git-common-dir`, so this command shows every live window across all worktrees of the repo.
3. Read this session's SCOPE CONTRACT (in user's first message). The user names which file globs your work is allowed to touch.
4. **If `window-status.mjs` shows any other live window, you MUST work in your own worktree** — claiming a window in the main checkout while others are live is refused by `window-start.mjs` (F-N8 prevention). To set up a worktree on Windows:

   ```bash
   # From the main checkout:
   git worktree add ../lepios-<slug> <branch>
   # PowerShell — junction node_modules + .husky/_ so lint-staged + husky still work:
   New-Item -ItemType Junction -Path ..\lepios-<slug>\node_modules -Target ..\lepios\node_modules
   New-Item -ItemType Junction -Path ..\lepios-<slug>\.husky\_ -Target ..\lepios\.husky\_
   cd ../lepios-<slug>
   ```

   Single-window sessions can stay in the main checkout — the guard only fires when other windows are live. Emergency single-window bypass: `--allow-main-checkout`.

5. Claim your window from inside the worktree: `node scripts/window-start.mjs --scope "<glob>" [--scope "<glob>"...]`. The script:
   - Refuses if working tree is dirty or branch is `main`
   - Refuses if running in the main checkout while other windows are live (see step 4)
   - Refuses if another live window's scope overlaps yours
   - Writes `<main-checkout>/.claude/active-windows/<branch>.json` (shared across worktrees)

6. On clean shutdown, run `node scripts/window-end.mjs` to release the claim.

Hard rules (most are now enforced by `.husky/pre-commit` and `.husky/commit-msg`):

- **Scope contract — enforced.** Every commit is checked against the active claim's scope globs. Out-of-scope files block the commit. Bypass once with `WINDOW_SCOPE_BYPASS=1 git commit ...` only if the user has explicitly approved.
- **No active claim — enforced.** A commit on a branch without an `active-windows` claim is blocked. Run `window-start.mjs` first.
- **Shared seams — enforced.** Edits require `[seam-approved]` in the commit message — per-edit user approval, every time. Current seam set:
  - **App boundaries:** `package.json`, `package-lock.json`, `app/layout.tsx`, `middleware.ts`, `next.config.*`, `tailwind.config.*`, `tsconfig.json`, `.env.example`, `eslint.config.*`, `.gitignore`
  - **Schema:** `supabase/seed.sql`, any RLS policy on existing tables
  - **Multi-window protocol files:** `.claude/CLAUDE.md`, `scripts/window-{start,end,status,scope-check}.mjs`, `scripts/lib/window-claim.mjs`, `.husky/{pre-commit,commit-msg,prepare-commit-msg,post-merge}`
  - The protocol files are seamed because a silent edit from one window breaks every other window's enforcement layer — the very class of bug PR #118 (worktree enforcement) closed.
- **Migration numbering — enforced.** Before creating a migration, check `.claude/migration-claims.json`, reserve the next integer in the same commit as the migration. Pre-commit hook blocks unclaimed migration numbers.
- **Rebase before commit — enforced.** Pre-commit hook aborts if branch is behind `origin/main`. Run `git pull --rebase origin main` and retry.
- **Before push:** refetch, rebase, re-run tests against rebased state.
- **Never amend or force-push** commits I didn't author.
- **Never `git checkout`** a branch with uncommitted local changes.
- **Helpful refactors outside scope: forbidden.** Drop a note in `notes/cross-window-suggestions.md` for the user instead.

Loop guard: if I find myself pulling/rebasing/conflict-resolving more than 3 times in a session, stop and tell the user the parallelization isn't working for this scope split.

### Scope glob syntax

Same as `.gitignore` / minimatch:

- `lib/auth/**` — everything under `lib/auth/`, recursively
- `app/api/admin/*` — direct children of `app/api/admin/` (one level)
- `supabase/migrations/0140_*` — migration `0140` whatever its name
- exact paths (`README.md`) match exactly

Multiple `--scope` flags are OR'd. Files must match at least one to be allowed.
