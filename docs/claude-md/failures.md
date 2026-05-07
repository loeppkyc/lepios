# LepiOS — Failure Log (F-N series)

F-L1–F-L15 live in `CLAUDE.md §9` (canonical). This file holds entries added after F-L15.
Newest-first. Format: date · what happened · root cause · fix/workaround · what to do differently.

---

## F-N9 — F-L11 recurrence: 19th cron in vercel.json silently broke deploy pipeline for ~50 minutes (2026-05-07)

- **What:** PR #109 (`chore: self-repair v2 wire-up`) added a 19th cron to `vercel.json` (`/api/cron/night_watchman_scan` at `*/30 4-13 * * *` — both over the count ceiling AND sub-hourly). Vercel Hobby plan silently rejected the entire config at validation, before any build ran. PRs #109, #110, #111 all merged with `Vercel: failure` GitHub status checks pointing to the same stale `vercel.link/3Fpeeb1` placeholder URL — Vercel's behavior when it skips deploy creation. Production stayed pinned to the last successful commit `bb8b4a8` (PR #107) for ~50 min while three subsequent PRs landed but didn't deploy. Caught when PR #110 (AI Pick Engine schema) couldn't merge and we dug into the build logs.
- **Root cause:** Same failure class as F-L11. CLAUDE.md §9 documents F-L11 with the lesson "Any cron addition must be validated against Vercel Hobby limits before merge" — but no automated check existed, so the discipline relied on human memory across windows. The night-watchman v2 PR author wasn't aware of the limit; the Hobby cron count had crept up to exactly 18 (the empirical ceiling) without anyone noticing the headroom was gone.
- **Fix/workaround:**
  - Hotfix PR #112 removed the new cron entirely, returning vercel.json to the proven-working 18-cron count. Build pipeline resumed within 5 minutes of the fix landing. PR #110 then rebased + deployed clean.
  - Night-watchman scan is currently in degraded state: its cron is gone, only the `/halt` killswitch route + manual API invocation work. Logged in PR #112 description for follow-up to either invoke from `/api/cron/night-tick` or upgrade to Pro plan.
- **Next time:**
  - **Same-session prevention shipped:** `scripts/check-vercel-cron-count.mjs` now runs in `.husky/pre-commit`. Counts `vercel.json` crons, blocks commits that exceed `MAX_CRONS = 18`, and blocks any sub-hourly schedule (`*/N` minute, multiple discrete minutes, or `*` minute). Bypass via `VERCEL_CRON_CHECK_BYPASS=1` only when explicitly upgrading the plan in the same commit. Pattern matches S-L11: name the failure, ship visibility + prevention same-day.
  - **Production-deploy verification gap remains:** the deploy gate verifies tests + merge but doesn't confirm a Vercel deployment actually landed for the merged commit. F-L11 already named this; the smoke-test framework will eventually close it. For now, after merging anything that touches `vercel.json` or adds API routes, run `mcp__claude_ai_Vercel__list_deployments` with `since=now` to verify a new deployment appeared. (The pre-commit guard catches the cron-count regression class specifically; broader deploy-verification is still manual.)
  - **Raise the ceiling intentionally, not accidentally:** if a future PR genuinely needs more than 18 crons, the right move is to upgrade to Pro and bump `MAX_CRONS` in the script in the same PR — not to bypass the guard. The guard should be the visible gate where the upgrade decision happens.

---

## F-N8 — Concurrent-session contaminated working tree shipped Payouts UI without backend (2026-05-06)

- **What:** PR #86 (advisor backstop monitor) was opened from a branch I'd just created (`harness/advisor-backstop-monitor`), but the squash-merge silently included unrelated Payouts UI changes — `PayoutsPage.tsx` with `NotesCell` references to `s2.notes`, plus a PATCH call to a route that didn't exist yet. Main TypeScript-built fine but the Payouts page would crash at runtime on the missing column. Live in production from `bab3d5a` (PR #86 squash) until `7b842ba` (PR #88 squash, ~10 minutes later, which carried the gap-fill backend an autonomous parallel session had pushed onto my branch in between). Migration 0132 (`amazon_settlements.notes`) had to be applied manually via Supabase MCP — nobody had DDL authority on prod from the autonomous loop.
- **Root cause:** Concurrent Claude sessions sharing the same git working tree. While I was on branch `harness/advisor-backstop-monitor` editing files, a parallel autonomous session was working on the Payouts feature on a different branch (`harness/payouts-notes-gap-fill`). At some point the parallel session checked out its own branch, leaving the working tree on a different branch than the one I'd created. `git status` after my `git checkout -b` reported success; `git branch --show-current` after my commit reported a different branch. lint-staged's pre-commit `git stash` backup masked the drift — the commit landed on whichever branch was checked out at commit time, not the one I'd created. Subsequent `git add` of my four files succeeded into the _current_ index (which already contained the parallel session's staged Payouts changes), and the commit captured both. The squash-merge of PR #86 then swept the contaminated index into main.
- **Fix/workaround:**
  - Manual: applied migration 0132 via `mcp__claude_ai_Supabase__apply_migration`, verified column exists, smoke-tested `/api/payouts` (401 = route alive, not 500), `/api/twin/ask` (200, `retrieval_path: vector` — no pgvector regression), `/api/health` (200, commit matches `7b842ba`). Production stable within 10 minutes of detection. PR #87 (which the parallel session opened with the gap-fill) was closed as superseded since its commits landed inside #88's squash.
  - Detection: an autonomous parallel session noticed main was broken (TS reference to a non-existent column) and opened PR #87 with the missing migration + PATCH route + tests + acceptance doc. That same session pushed those commits onto my in-flight branch, which is how they ended up in #88's squash. Detection was fast (≤5 min); the gap-fill arrived before I'd noticed myself.
- **Next time:**
  - **Pre-commit branch invariant:** the pre-commit hook should assert `git branch --show-current` matches the branch the session expects to be on. Drift = abort, not commit. (Sibling rule to S-L7 "branch guard for coordinator"; current branch guard runs only on coordinator-initiated git ops, not on developer commits.) Track as `branch_drift_detected` in `agent_events`.
  - **Pre-commit index invariant:** the pre-commit hook should assert the file list staged in the index matches the explicit `git add` list passed by the session. If the session ran `git add A B C D` and the index also contains `E F G`, abort. Track as `unintended_staged_files` in `agent_events`.
  - **Better long-term:** parallel Claude sessions should use isolated `git worktree` checkouts, not the same filesystem. One worktree per session means no shared working tree, no drift. This is the right structural fix; the pre-commit invariants above are the cheap defensive layer that works without restructuring the workspace.
  - **Migration apply discipline:** any PR that adds a `supabase/migrations/*.sql` file must include a checklist item "migration applied to prod via MCP" in the PR body. Currently nobody catches when a migration commits to repo without applying — the autonomous-fix mechanism here only worked because the gap was visible at TypeScript compile time. A pure-DDL migration (no app-side reference) could ship to repo and silently never apply.

---

## F-N7 — Bookkeeping reconcile/approve API uses `status='approved'` which violates `pending_transactions_status_check` (2026-05-06)

- **What:** `app/api/bookkeeping/reconcile/approve/route.ts` writes `status: 'approved'` to `pending_transactions` after creating a journal entry. The CHECK constraint `pending_transactions_status_check` only allows `'pending', 'auto_approved', 'needs_review', 'rejected', 'manual_je', 'duplicate'`. The route would 500 with a constraint violation on every approve attempt; the journal entry would be created but the pending_transactions update would fail, leaving an orphan JE and the txn stuck in `needs_review`. Discovered today when manually approving 3 needs_review items via SQL — the API code path likely has not been exercised end-to-end since whichever migration tightened the constraint.
- **Root cause:** API code and DB constraint drifted independently. No test exercises the full approve flow against the real schema (the `bookkeeping-reconcile-approve.test.ts` tests use mocks).
- **Fix/workaround:** Used `status='manual_je'` directly via SQL for the 3 in-flight items (semantically correct: manual classification → JE created). Three JEs created, all balanced (debit = credit), pending_transactions updated. API code change is a one-character fix (`'approved'` → `'manual_je'`) but also needs a real-schema integration test to prevent the same drift class from recurring on other status writes.
- **Next time:** Add a Vitest integration test that runs the approve handler against a temp Supabase project (or against a `BEGIN; ... ROLLBACK;` wrapper on the real DB). The mock-only tests verified shape but not the constraint envelope. Filed as separate follow-up to be handled in next session.

---

## F-N5 — `/api/bookkeeping/*` shipped publicly accessible for ~5 hours (2026-05-05)

- **What:** Five new bookkeeping API routes (reconcile GET, reconcile/approve POST, reconcile/reject POST, qb-export GET, qb-export/mark POST) used `createServiceClient` for DB writes but never checked `auth.getUser()`. Root middleware excludes `/api/*` (API routes self-gate). Anyone hitting the URL could read the needs_review queue, read all unexported JEs, write JEs via approve, mark JEs as exported. Live in production from `c4c9e9c` (initial reconcile) until `a3425d9` (auth fix) — roughly 5 hours.
- **Root cause:** New API routes were copied from existing patterns that used the SSR/anon client (RLS-gated by default). Switching to service_role for write capability removed the implicit RLS gate without adding an explicit auth gate. No checklist or lint rule caught it. The bookkeeping tests verified shape + business logic but not the security envelope.
- **Fix/workaround:** Inline `auth.getUser()` check at the top of each handler, return 401 if no session, then proceed with the service client. Same pattern as `app/api/business-review/statement-coverage/override/route.ts`. Smoke tests now hit both routes expecting 401 — auth regression would surface in `morning_digest`.
- **Next time:** Any new `/api/*` route that uses `createServiceClient` must (a) call `auth.getUser()` for user-facing routes OR (b) use `requireCronSecret(request)` for cron-style routes. There is no third option. Worth a lint rule: `no-restricted-syntax` against `createServiceClient` in files under `app/api/**` that don't import either `auth.getUser` or `requireCronSecret`. Also: every new API route should ship with a 401 test case in the same commit as the route.

---

## F-N4 — 74 silent embed failures: cloudflared tunnel unreliable over batch (2026-04-27)

- **What:** Twin corpus ingest via Ollama returned 74 failures silently. Those chunks have no embeddings.
- **Root cause:** cloudflared tunnel to local Ollama drops connections under sustained batch load. Ingest script swallowed per-chunk errors without logging them.
- **Fix/workaround:** FTS fallback covers gap for now. Proper fix: retry-with-backoff in ingest, or run ingest locally (no tunnel needed).
- **Next time:** Any batch job must log per-chunk success/failure to `agent_events` or a dedicated table. Silent failures in a batch = unknown coverage, not zero failures.

---

## F-N3 — Coordinator default branch name triggered branch guard on every session start (2026-04-27)

- **What:** Coordinator sessions auto-named branches `claude/vibrant-heisenberg-*` (Claude's default) instead of `harness/task-{uuid}`.
- **Root cause:** Branch guard check ran _after_ git operations; if `task_id` absent from invocation context, no expected branch name could be constructed.
- **Fix/workaround:** `coordinator.md` §Branch Naming now requires `task_id` presence check _before_ any git op. Checkouts to `harness/task-{task_id}` are explicit.
- **Next time:** Any coordinator invocation missing `task_id` must STOP immediately — log `branch_guard_triggered, reason=missing_task_id` and exit. Do not proceed with a generated branch name.

---

## F-N2 — BUMP directive parser missed squash-merge body (2026-04-27)

- **What:** `bumps harness:slug to N%` directive was present in PR body but component % did not update post-merge.
- **Root cause:** Squash-merge writes a single commit; the commit body differs from the PR description field. Parser reads PR description; the directive landed in the squash commit message instead.
- **Fix/workaround:** Manual SQL `UPDATE harness_components SET weight_pct=N WHERE slug='...'`. Task F-L13 queued to automate this.
- **Next time:** Test directive parser against squash-merge commit body format. Verify parser reads from the correct field (PR description vs. merge commit body) before relying on it in production.

---

## F-N1 — H1 Fix A (settings.json allowlist) ignored in cloud sandbox (2026-04-27)

- **What:** Added bash tool allow-permissions to project `.claude/settings.json` to fix H1 drain (drain trigger was blocked by sandbox). Drain still failed after the fix.
- **Root cause:** Claude Code remote agents/cloud routines do not load project-level `settings.json`. Only global user settings apply in that context.
- **Fix/workaround:** H1-B Stage 2 — replace curl-based drain trigger with Supabase-native `pending_drain_triggers` table pattern (task `2b05123b`, now queued at priority=1).
- **Next time:** Any settings.json fix targeting remote/cloud agent behavior is ineffective. Check execution environment (local dev vs. cloud routine) before applying. Cloud-safe fixes must use DB-resident config or harness API calls, not filesystem settings.
