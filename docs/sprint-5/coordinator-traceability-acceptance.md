# Acceptance Doc — Coordinator Traceability + Budget Session Fidelity

**Chunk:** `coordinator-traceability`
**Task ID:** `dbbb1a53-4230-437f-a2a0-3f99b9cc9ee6`
**Sprint:** 5 (harness hardening parallel track)
**Phase:** Greenfield — no Streamlit predecessor. Phase 1a–1c skipped per coordinator.md.
**Status:** Awaiting Colin approval
**Written:** 2026-05-10

---

## Scope

Three tightly-coupled harness gaps surfaced in session-postmortem `8fce1384`, all in the coordinator task-completion path:

1. **commit_sha capture** — coordinator must write the resulting commit SHA(s) and branch name to `task_queue.metadata` on task completion. Currently traceability requires manual `git log` inspection.
2. **expired session status** — `work_budget_sessions.status` CHECK constraint allows only `('active', 'drained', 'stopped')`. Over-budget auto-close needs an `expired` terminal state; attempting to write it violates the constraint at the DB layer.
3. **used_minutes + completed_count not incremented by cloud coordinator** — `onTaskComplete()` in `pickup-runner.ts` correctly increments both, but `onTaskComplete` is only reached via `POST /api/coordinator/complete`. The cloud coordinator updates `task_queue` via direct Supabase SQL (MCP tool), bypassing the endpoint and leaving session totals inaccurate.

**One-sentence scope:** Add commit SHA traceability to every coordinator-completed task, close the used_minutes/completed_count gap when the coordinator finishes, and add `expired` as a legal terminal status for work budget sessions.

**Single acceptance criterion:** After builder ships:
- `SELECT metadata->>'commit_sha', metadata->>'branch_name' FROM task_queue WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1` returns non-null values.
- `SELECT used_minutes, completed_count FROM work_budget_sessions WHERE status != 'active' ORDER BY completed_at DESC LIMIT 1` reflects the actual minutes the coordinator ran for the last task.
- `UPDATE work_budget_sessions SET status = 'expired' WHERE id = '<any-row-id>'` succeeds without constraint violation.

---

## Out of scope

- Backfilling `commit_sha` onto previously completed tasks — schema change is additive, old rows have null (acceptable)
- Calibration trigger changes — `runCalibration()` in `onTaskComplete` is correctly called via the API endpoint path; no change needed
- Work budget UI showing expired sessions — deferred; the status is needed at the DB layer first
- Drain detection for expired sessions — deferred to a follow-on task

---

## Files expected to change

| File | Change |
|------|--------|
| `.claude/agents/coordinator.md` | Add commit_sha capture step in "On completion" section (step 9 of invocation instructions). Update to call `/api/coordinator/complete` endpoint (preferred) or JSONB-merge via SQL fallback. |
| `app/api/coordinator/complete/route.ts` | Accept `commit_sha?: string` and `branch_name?: string` in body. On completion, JSONB-merge `{commit_sha, branch_name}` into `task_queue.metadata`. |
| `lib/work-budget/tracker.ts` | Add `'expired'` to `WorkBudgetSession.status` type union. Add `expireSession(sessionId: string): Promise<WorkBudgetSession \| null>` function (analogous to `stopSession`). |
| `supabase/migrations/0171_coordinator_traceability.sql` | (a) Expand `work_budget_sessions_status_check` to include `'expired'`. |
| Tests | `tests/harness/coordinator/complete.test.ts` — add test: body with `commit_sha` + `branch_name` → metadata updated. `tests/work-budget.test.ts` — add test: `expireSession` sets status='expired'. |

---

## Check-Before-Build findings

| Item | Finding |
|------|--------|
| `task_queue.metadata` column | Exists — JSONB, default `'{}'`. JSONB merge via `metadata \|\| '{"commit_sha":"..."}'` is safe and additive. |
| `/api/coordinator/complete` endpoint | Exists at `app/api/coordinator/complete/route.ts`. Already accepts `result` JSONB. Does NOT currently accept `commit_sha` or `branch_name`. Does NOT write to `task_queue.metadata`. |
| `onTaskComplete` | Exists in `lib/harness/pickup-runner.ts:481`. Already calls `incrementBudgetUsedMinutes` (which increments both `used_minutes` and `completed_count`). Already triggered by `/api/coordinator/complete` (line 74). Gap: not reached when coordinator does direct SQL update. |
| `work_budget_sessions.status` CHECK | Constraint name: `work_budget_sessions_status_check`. Current allowed values: `('active', 'drained', 'stopped')`. 'expired' is absent — confirmed via `pg_constraint` query. |
| `WorkBudgetSession` type | In `lib/work-budget/tracker.ts:16`. Currently typed as `'active' | 'drained' | 'stopped'`. Needs `'expired'` added. |
| `expireSession` | Does not exist. `stopSession` and `drainSession` serve as reference implementations. |
| Existing tests | `tests/work-budget.test.ts` covers `onTaskComplete`, `incrementBudgetUsedMinutes`, `drainSession`. |

---

## Design choice requiring Colin's decision

**Open question:** Two implementation options for closing the used_minutes/completed_count gap. Builder needs a choice before starting.

**Option A — Coordinator calls the API endpoint (preferred by coordinator):**
Modify coordinator.md step 9 to:
1. `COMMIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")`
2. `BRANCH=$(git branch --show-current 2>/dev/null || echo "")`
3. If `/tmp/coordinator-secret` exists: `POST /api/coordinator/complete` with `{task_id, status:'completed', result, commit_sha, branch_name}` using CRON_SECRET bearer.
4. Fallback if CRON_SECRET unavailable: direct SQL `UPDATE task_queue SET status='completed', completed_at=NOW(), metadata = metadata || '{"commit_sha":"$COMMIT_SHA","branch_name":"$BRANCH"}'` — then also `UPDATE work_budget_sessions SET used_minutes = used_minutes + actual_mins, completed_count = completed_count + 1 WHERE status='active' AND id=(SELECT id FROM work_budget_sessions WHERE status='active' ORDER BY started_at DESC LIMIT 1)`.

Pros: single code path handles commit_sha + budget + loop. The endpoint already exists and handles all of this.
Cons: requires CRON_SECRET in /tmp (written at session start from harness_config). In this session, temp file was absent because Supabase env vars weren't in bash env — so fallback would have fired.

**Option B — DB trigger:**
Add a PostgreSQL trigger `AFTER UPDATE ON task_queue FOR EACH ROW WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')` that increments `work_budget_sessions.used_minutes + completed_count`. This fires regardless of whether the coordinator used the API or SQL.

Pros: zero-miss guarantee — any completion path triggers it. No coordinator.md changes needed for the budget gap (only for commit_sha).
Cons: double-increment if both trigger AND application-layer `onTaskComplete` run (web flow). Requires guarding `onTaskComplete` to skip `incrementBudgetUsedMinutes` if trigger is present — or accepting that the trigger supersedes the application-layer increment and removing it there.

**Coordinator recommendation:** Option A. It's simpler (one code path), the fallback SQL covers the CRON_SECRET-unavailable case, and it avoids DB trigger complexity. Option B introduces a new trigger that could interact unexpectedly with the existing application-layer increment.

**Colin: please reply with A or B. Builder will not start until this is resolved.**

---

## External deps tested

No external APIs touched. All changes are internal (coordinator.md instructions, one route, one migration, one library file).

---

## Grounding checkpoint

After builder ships and is deployed:

1. Trigger a test coordinator run or manually set a task to 'completed' via the endpoint:
   ```bash
   curl -X POST https://lepios-one.vercel.app/api/coordinator/complete \
     -H "Authorization: Bearer {CRON_SECRET}" \
     -H "Content-Type: application/json" \
     -d '{"task_id":"<any-queued-task>","commit_sha":"abc123","branch_name":"test-branch"}'
   ```
2. Verify: `SELECT metadata->>'commit_sha', metadata->>'branch_name' FROM task_queue WHERE id='<task_id>'` — both non-null.
3. Verify: `SELECT used_minutes, completed_count FROM work_budget_sessions WHERE status != 'active' ORDER BY completed_at DESC LIMIT 1` — counters match expected minutes.
4. Verify expired status: `UPDATE work_budget_sessions SET status='expired' WHERE id=(SELECT id FROM work_budget_sessions LIMIT 1)` — no constraint error.

---

## Kill signals

- API endpoint body change breaks existing callers → revert route change, keep only SQL fallback
- DB constraint change causes RLS violation (migration may need to touch RLS policy) → check migration 0051 RLS policies before applying

---

## Cached-principle decisions

None cached. Escalating to Colin for approval per non-negotiable #2 (never self-approve acceptance docs) and because:
- Changing coordinator.md (the agent spec I'm implementing) involves changing fundamental coordinator behavior — this is "new terrain" per escalation rules
- Design choice (Option A vs B) cannot be pattern-matched from prior decisions

---

## Open questions

1. **Option A vs B** (above — blocking). Colin reply needed before build starts.
2. In the Option A fallback path (direct SQL), should `actual_minutes` be computed from `claimed_at` (which the coordinator knows) or from wall clock (completed_at - NOW())? Task row has `claimed_at` already set. Coordinator can compute: `actual_mins = round((now() - claimed_at) / 60)`.

---

**Artifacts:** This file — `docs/sprint-5/coordinator-traceability-acceptance.md`
