# LepiOS — Failure Log

**Auto-generated from `failures_log` table.** Last updated: 2026-05-08T11:41:14.637Z.
Source of truth: `failures_log` table. Edit there (cockpit `/failures` form or via `POST /api/failures/log`).

F-L1–F-L15 live in `CLAUDE.md §9` (canonical hand-written entries kept in prose).
F-N entries below are auto-rendered from the table.

---

## Fixed (last 30 days) (8)

## F-N5 — /api/bookkeeping/\* shipped publicly accessible for ~5 hours (2026-05-05)

- **What:** Five new bookkeeping API routes (reconcile GET, reconcile/approve POST, reconcile/reject POST, qb-export GET, qb-export/mark POST) used createServiceClient for DB writes but never checked auth.getUser(). Root middleware excludes /api/\* (API routes self-gate). Anyone hitting the URL could read needs_review queue, read all unexported JEs, write JEs via approve, mark JEs as exported. Live in production from c4c9e9c until a3425d9 (~5 hours).
- **Root cause:** New API routes were copied from existing patterns that used the SSR/anon client (RLS-gated by default). Switching to service_role for write capability removed the implicit RLS gate without adding an explicit auth gate. No checklist or lint rule caught it. The bookkeeping tests verified shape + business logic but not the security envelope.
- **Fix/workaround:** commit a3425d9 (inline auth.getUser check + 401 smoke tests)
- **Lesson:** Any new /api/\* route that uses createServiceClient must (a) call auth.getUser() for user-facing routes OR (b) use requireCronSecret(request) for cron-style routes. Worth a lint rule (no-restricted-syntax) plus 401 test case in same commit.
- **Severity:** critical

---

## F-N9 — F-L11 recurrence: 19th cron in vercel.json silently broke deploy pipeline for ~50 minutes (2026-05-07)

- **What:** PR #109 (chore: self-repair v2 wire-up) added a 19th cron to vercel.json (/api/cron/night_watchman_scan at _/30 4-13 _ \* \* — both over the count ceiling AND sub-hourly). Vercel Hobby plan silently rejected the entire config at validation, before any build ran. PRs #109, #110, #111 all merged with Vercel: failure GitHub status checks. Production stayed pinned to last successful commit bb8b4a8 (PR #107) for ~50 min.
- **Root cause:** Same failure class as F-L11. CLAUDE.md §9 documents F-L11 with the lesson "Any cron addition must be validated against Vercel Hobby limits before merge" — but no automated check existed, so the discipline relied on human memory across windows. The Hobby cron count had crept up to exactly 18 without anyone noticing.
- **Fix/workaround:** PR #112 hotfix removed cron; pre-commit guard scripts/check-vercel-cron-count.mjs ships with MAX_CRONS=18
- **Lesson:** Same-session prevention: pre-commit script counts vercel.json crons + blocks sub-hourly schedules. Production-deploy verification still manual — after merging anything that touches vercel.json or adds API routes, list_deployments to confirm. Raise ceiling intentionally (Pro plan upgrade) — never bypass guard.
- **Severity:** high

---

## F-N7 — Bookkeeping reconcile/approve API uses status=approved which violates pending_transactions_status_check (2026-05-06)

- **What:** app/api/bookkeeping/reconcile/approve/route.ts writes status: 'approved' to pending_transactions after creating a journal entry. The CHECK constraint pending_transactions_status_check only allows pending, auto_approved, needs_review, rejected, manual_je, duplicate. The route would 500 with a constraint violation on every approve attempt; the journal entry would be created but the pending_transactions update would fail, leaving an orphan JE.
- **Root cause:** API code and DB constraint drifted independently. No test exercises the full approve flow against the real schema (the bookkeeping-reconcile-approve.test.ts tests use mocks).
- **Fix/workaround:** one-character API fix + manual SQL for in-flight items (status=manual_je)
- **Lesson:** Add a Vitest integration test that runs the approve handler against a temp Supabase project (or BEGIN/ROLLBACK wrapper). Mock-only tests verified shape but not the constraint envelope.
- **Severity:** high

---

## F-N8 — Concurrent-session contaminated working tree shipped Payouts UI without backend (2026-05-06)

- **What:** PR #86 (advisor backstop monitor) was opened from a branch I had just created (harness/advisor-backstop-monitor), but the squash-merge silently included unrelated Payouts UI changes — PayoutsPage.tsx with NotesCell references to s2.notes, plus a PATCH call to a route that did not exist yet. Live in production from bab3d5a until 7b842ba (~10 minutes). Migration 0132 (amazon_settlements.notes) had to be applied manually via Supabase MCP.
- **Root cause:** Concurrent Claude sessions sharing the same git working tree. Parallel autonomous session checked out its own branch, leaving the working tree on a different branch than the one I had created. lint-staged pre-commit git stash backup masked the drift. Subsequent git add captured the contaminated index.
- **Fix/workaround:** PR #87 superseded by PR #88 squash; manual migration apply
- **Lesson:** Pre-commit branch invariant (assert git branch --show-current matches expected). Pre-commit index invariant (staged files match git add list). Long-term: use isolated git worktree per parallel Claude session. Migration apply discipline: PR body checklist for migrations applied to prod.
- **Severity:** high

---

## F-N4 — 74 silent embed failures: cloudflared tunnel unreliable over batch (2026-04-27)

- **What:** Twin corpus ingest via Ollama returned 74 failures silently. Those chunks have no embeddings. cloudflared tunnel to local Ollama drops connections under sustained batch load. Ingest script swallowed per-chunk errors without logging them.
- **Root cause:** cloudflared tunnel to local Ollama drops connections under sustained batch load. Ingest script swallowed per-chunk errors without logging them.
- **Fix/workaround:** FTS fallback (S-L4 pattern)
- **Lesson:** Any batch job must log per-chunk success/failure to agent_events or a dedicated table. Silent failures in a batch = unknown coverage, not zero failures.
- **Severity:** high

---

## F-N1 — H1 Fix A (settings.json allowlist) ignored in cloud sandbox (2026-04-27)

- **What:** Added bash tool allow-permissions to project .claude/settings.json to fix H1 drain (drain trigger was blocked by sandbox). Drain still failed after the fix. The settings.json edit had no effect because Claude Code remote agents/cloud routines do not load project-level settings.json — only global user settings apply in that context.
- **Root cause:** Claude Code remote agents/cloud routines do not load project-level settings.json. Only global user settings apply in that context.
- **Fix/workaround:** task 2b05123b (H1-B Stage 2 pending_drain_triggers pattern)
- **Lesson:** Any settings.json fix targeting remote/cloud agent behavior is ineffective. Check execution environment (local dev vs. cloud routine) before applying. Cloud-safe fixes must use DB-resident config or harness API calls, not filesystem settings.
- **Severity:** medium

---

## F-N3 — Coordinator default branch name triggered branch guard on every session start (2026-04-27)

- **What:** Coordinator sessions auto-named branches claude/vibrant-heisenberg-\* (Claude default) instead of harness/task-{uuid}. Branch guard check ran after git operations; if task_id absent from invocation context, no expected branch name could be constructed.
- **Root cause:** Branch guard check ran AFTER git operations; if task_id absent from invocation context, no expected branch name could be constructed.
- **Fix/workaround:** commit 5695edb (coordinator.md §Branch Naming requires task_id check before any git op)
- **Lesson:** Any coordinator invocation missing task_id must STOP immediately — log branch_guard_triggered, reason=missing_task_id and exit. Do not proceed with a generated branch name.
- **Severity:** medium

---

## F-N2 — BUMP directive parser missed squash-merge body (2026-04-27)

- **What:** "bumps harness:slug to N%" directive was present in PR body but component % did not update post-merge. Squash-merge writes a single commit; the commit body differs from the PR description field. Parser reads PR description; the directive landed in the squash commit message instead.
- **Root cause:** Squash-merge writes a single commit; the commit body differs from the PR description field. Parser reads PR description; the directive landed in the squash commit message instead.
- **Fix/workaround:** Manual SQL UPDATE harness_components; F-L13 queued to automate
- **Lesson:** Test directive parser against squash-merge commit body format. Verify parser reads from the correct field (PR description vs merge commit body) before relying on it in production.
- **Severity:** low
