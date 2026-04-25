# Sprint 5 — Harness Stall Alarm — Acceptance Doc

Status: **DRAFT — awaiting Colin approval before builder proceeds**
Chunk: `harness-stall-alarm`
Sprint: 5 (harness expansion)
Greenfield: YES — no Streamlit predecessor; Phase 1a–1c skipped
Cache-match: DISABLED (Sprint 4 baseline override — every doc escalates to Colin)
Generated: 2026-04-25 by coordinator (task_id: 40b1aa4b-c969-4d94-93f7-49ce29f3fc26)

---

## Scope

A new scheduled harness check that detects 5 categories of stalls and fires a distinct,
deduplicated Telegram alert for each. Each alert message includes: what's stuck, why, and
a suggested action as plain text.

**One acceptance criterion:** After this ships, each of the 5 triggers — when manually
simulated in staging — produces a Telegram alert within 65 minutes (one cron cycle + 5-min
buffer), does NOT re-alert for the same entity within the dedup window, and writes a
`stall_alert_fired` row to `agent_events`.

**v1 scope:** Fire-and-forget text messages only. No Telegram inline buttons. Suggested
action is "paste this command" text — interactive "tap to resolve" buttons are a follow-up
chunk (significant added scope: callback routing + API handlers per trigger type).

---

## Out of Scope

- Telegram inline keyboard buttons (defer — each trigger needs a distinct callback action)
- New database tables (use existing `agent_events` and `outbound_notifications`)
- Retroactive alert backfill for historical stalls
- Auto-remediation (auto-requeue stuck tasks, auto-dismiss stale tasks) — Colin decides

---

## Triggers

### T1 — Coordinator stuck >30 min, no heartbeat progress

**Detection:**
```sql
SELECT id, task, claimed_at, last_heartbeat_at
FROM task_queue
WHERE status IN ('claimed', 'running')
  AND COALESCE(last_heartbeat_at, claimed_at) < NOW() - INTERVAL '30 minutes'
```

**Alert message:**
```
[LepiOS Harness] stall-alarm — T1: coordinator stuck
Task: {task[:60]} ({id[:8]})
No heartbeat for {N} min (last: {COALESCE(last_heartbeat_at, claimed_at)}).
Will self-clear at next pickup run (reclaim_stale_tasks fires at 15-min window).
Force requeue: UPDATE task_queue SET status='queued', claimed_at=NULL,
  last_heartbeat_at=NULL WHERE id='{id}';
```

**Dedup window:** 60 min per task_id.

**Relationship to reclaim_stale_tasks():** `reclaim_stale_tasks()` fires inside the
task-pickup cron and resets/cancels stale tasks at 15 min. This alarm fires at 30 min as a
proactive alert *before or between* pickup runs — additive, not a replacement.

---

### T2 — Active budget session, no task completed in 30 min

**Detection (two-step):**

Step 1: Any active session started >30 min ago?
```sql
SELECT * FROM work_budget_sessions
WHERE status = 'active'
  AND started_at < NOW() - INTERVAL '30 minutes'
```

Step 2 (if session found): Last task completion after session start?
```sql
SELECT MAX(occurred_at) AS last_completion
FROM agent_events
WHERE action = 'estimation.complete'
  AND occurred_at > '{session.started_at}'
```

Fire if `last_completion IS NULL` OR `last_completion < NOW() - INTERVAL '30 minutes'`.

**Alert message:**
```
[LepiOS Harness] stall-alarm — T2: budget session stalled
Session: {id[:8]} | {used_minutes}/{budget_minutes} min used | {completed_count} tasks done
No task completion in 30+ min. Session started {N} min ago.
If coordinator is idle: check harness logs or queue a new task.
Drain session: UPDATE work_budget_sessions SET status='stopped'
  WHERE id='{id}';
```

**Dedup window:** 60 min per session_id.

---

### T3 — Stale meta-task at top of queue

**Detection:**
```sql
SELECT id, task, created_at, retry_count, priority
FROM task_queue
WHERE status = 'queued'
  AND retry_count = 0
  AND created_at < NOW() - INTERVAL '72 hours'
ORDER BY priority ASC, created_at ASC
LIMIT 1
```

Fire if any row returned (alert on the oldest/highest-priority stale task).

**Alert message:**
```
[LepiOS Harness] stall-alarm — T3: stale meta-task
Task: {task[:60]} ({id[:8]})
Queued {N} days ago, never attempted.
This task may describe work that's already shipped.
Dismiss: UPDATE task_queue SET status='dismissed' WHERE id='{id}';
```

**Dedup window:** 24 h per task_id (low-urgency, no need for hourly re-alert).

⚠️ **ASSUMPTION (requires Colin confirmation — see Q1):** "stale meta-task" is detected
as `queued + retry_count=0 + created_at >72h ago`. If Colin's intent is a different
detection mechanism (e.g., LLM comparison against recent completions, explicit stale flag),
builder must not proceed on T3 until Q1 is resolved.

---

### T4 — awaiting_review tasks stuck >2 h

**Detection:**
```sql
SELECT id, task, last_heartbeat_at, claimed_at
FROM task_queue
WHERE status = 'awaiting_review'
  AND COALESCE(last_heartbeat_at, claimed_at) < NOW() - INTERVAL '2 hours'
```

**Alert message:**
```
[LepiOS Harness] stall-alarm — T4: awaiting_review timeout
Task: {task[:60]} ({id[:8]})
Waiting for Telegram reply for {N} h. Harness may be blocked.
Approve or reject via Telegram, or update status manually.
```

**Dedup window:** 2 h per task_id.

⚠️ **Schema dependency:** `awaiting_review` was added by migration 0026
(`0026_task_queue_review_statuses.sql`) but has NOT been applied to production as of
2026-04-25. This check returns 0 rows and fires no alerts until 0026 is applied — the
implementation is defensive by design. No builder action required for the gap.

**Time anchor:** Uses `COALESCE(last_heartbeat_at, claimed_at)` as proxy for "when task
entered awaiting_review." This is approximate; if a more precise anchor is needed, a
`awaiting_review_since` column would be required (deferred, out of scope for v1).

---

### T5 — Pickup cron missed >2 expected runs

**Detection:**
```sql
SELECT occurred_at
FROM agent_events
WHERE action = 'task_pickup'
ORDER BY occurred_at DESC
LIMIT 1
```

Compute threshold dynamically based on current cron schedule:
- Read `vercel.json` cron schedule for `/api/cron/task-pickup` at startup
- If schedule = `0 * * * *` (hourly, post task-pickup-100): threshold = `2 hours`
- If schedule = `0 0 * * *` or daily equivalent: threshold = `48 hours`

Fire if `occurred_at < NOW() - threshold` (or no rows at all).

**Alert message:**
```
[LepiOS Harness] stall-alarm — T5: pickup cron missed
Last pickup: {occurred_at} ({N} h ago). Expected cadence: {threshold/2}.
Harness may have stopped running.
Check Vercel cron dashboard. Manual trigger:
  curl -X POST https://lepios-one.vercel.app/api/cron/task-pickup \
    -H "Authorization: Bearer $CRON_SECRET"
```

**Dedup window:** `threshold / 2` per T5 (don't re-alert more than once per expected cycle).

**TASK_PICKUP_ENABLED check:** Before firing T5, verify `SELECT COUNT(*) FROM agent_events WHERE action='task_pickup' AND occurred_at > NOW() - INTERVAL '7 days'`. If 0 rows → task-pickup may have never been enabled; skip T5. This prevents alarm noise on fresh envs.

---

## Architecture

```
app/api/cron/harness-alarm/route.ts   ← new cron route
  GET/POST — auth: same Bearer pattern as task-pickup
  Calls runStallChecks(runId)

lib/harness/stall-checks.ts           ← new lib
  runStallChecks(runId): Promise<StallCheckResult[]>
    calls T1–T5 in sequence (non-blocking, errors per-trigger are swallowed)
    returns array of { trigger, entity_id, fired, suppressed, error? }

  checkT1(runId): Promise<void>
  checkT2(runId): Promise<void>
  checkT3(runId): Promise<void>
  checkT4(runId): Promise<void>
  checkT5(runId): Promise<void>

  isAlreadyAlerted(trigger: string, entityId: string, windowMs: number): Promise<boolean>
    SELECT 1 FROM agent_events
    WHERE action = 'stall_alert_fired'
      AND meta->>'trigger' = trigger
      AND meta->>'entity_id' = entityId
      AND occurred_at > NOW() - {windowMs}ms

  fireAlert(trigger: string, entityId: string, message: string): Promise<void>
    1. INSERT INTO outbound_notifications (requires_response=false, channel='telegram')
    2. INSERT INTO agent_events (action='stall_alert_fired', meta.trigger, meta.entity_id)
    3. Trigger drain: POST /api/harness/notifications-drain (best-effort, swallow error)
```

**Error isolation:** Each trigger check runs inside its own try/catch. A failure in T2's
DB query must not prevent T3–T5 from running. Log per-trigger errors to `agent_events` with
`action='stall_check_error'`, `meta.trigger`, `meta.error`.

**Cron schedule:** `30 * * * *` (30 min past the hour) — interleaves with task-pickup
(`0 * * * *` post task-pickup-100). Maximum detection lag = 60 min (stall begins at minute
0, alarm runs at minute 30, checks 30-min threshold → fires; worst case stall begins at
minute 31, alarm misses, next run at minute 90). Acceptable for personal OS.

---

## Check-Before-Build Findings

| Component | Exists? | Action |
|---|---|---|
| `outbound_notifications` + drain | YES — live in prod | Use as-is |
| `agent_events` for dedup + events | YES — live in prod | Use as-is |
| `work_budget_sessions` (needed fields: `id`, `status`, `budget_minutes`, `used_minutes`, `completed_count`, `started_at`) | YES | Use as-is |
| `task_queue.status = 'awaiting_review'` | Schema: migration 0026 written, NOT applied to prod | T4 is defensive — no action needed |
| `lib/harness/stall-checks.ts` | Does not exist | Build new |
| `app/api/cron/harness-alarm/route.ts` | Does not exist | Build new |
| `vercel.json` harness-alarm cron entry | Does not exist | Add new |
| Any existing "stall", "alarm", "stuck" logic | None found in `/app/api/harness/`, `/lib/`, `/app/api/cron/` | Confirmed greenfield |
| `reclaim_stale_tasks()` Postgres fn | EXISTS — handles recovery at 15-min window | This alarm is additive; do NOT modify `reclaim_stale_tasks()` |

Next migration number: `0029` (last applied: `0028_attribution_actor_type_colin.sql`).
**No migration needed for v1** — all tables already have needed columns.

---

## F17 — Behavioral Ingestion Justification

| Alert type | Engine signal |
|---|---|
| T1 (coordinator stuck) | coordinator_health — sticky coordinators correlate with large-scope or ambiguous tasks |
| T2 (budget session stalled) | session_effectiveness — idle sessions reveal task-picking or queue-depth problems |
| T3 (stale queued task) | task_lifecycle — never-attempted tasks reveal prioritization drift or stale proposals |
| T4 (awaiting_review jam) | human_response_latency — Colin's Telegram approval delay per task type |
| T5 (cron missed) | infrastructure_health — cron reliability; baseline for "harness is alive" |

All events: `agent_events`, `domain='harness'`, `action='stall_alert_fired'`, `meta.trigger`,
`meta.entity_id`. Feeds path probability engine as coordinator behavioral signals.

---

## F18 — Measurement

```
module: harness-stall-alarm
primary_metric: alert_to_resolution_latency_p50_p95
units: milliseconds

capture_method: |
  Fire event: agent_events action='stall_alert_fired'
    meta: { trigger, entity_id, fired_at, message_preview }
  Resolve event: on each stall-alarm run, for each stall_alert_fired in last 4h,
    re-check if the trigger condition is still true.
    If condition cleared: INSERT agent_events action='stall_alert_resolved'
      meta: { trigger, entity_id, resolution_latency_ms }
  Resolution = stall condition no longer true on re-check (not button-based in v1)

secondary_metric: dedup_suppression_rate
  = alerts suppressed by dedup / total alerts checked (per trigger, per run)
  Stored in runStallChecks() return value; logged via agent_events action='stall_check_run'

benchmark: |
  resolution latency p50 < 30 min, p95 < 120 min (personal OS, no external SLA)
  dedup suppression rate < 50% (low repeat-noise target)
  Baseline: 0 historical alerts (new feature)

surfacing_path: |
  morning_digest addition: "stall-alarm: T1={n} T2={n} T3={n} T4={n} T5={n} fired (24h)"
  Query:
    SELECT meta->>'trigger', COUNT(*) as fired,
           AVG((meta->>'resolution_latency_ms')::numeric / 60000) as avg_resolution_min
    FROM agent_events
    WHERE action = 'stall_alert_fired'
      AND occurred_at > NOW() - INTERVAL '24 hours'
    GROUP BY meta->>'trigger'
```

---

## External Deps — Principle 1

No new external APIs. All reads/writes to Supabase (existing tables). Telegram delivery via
existing `outbound_notifications` pipeline. No new env vars required.

---

## Files Expected to Change

| File | Action | Notes |
|---|---|---|
| `lib/harness/stall-checks.ts` | Build new | 5 check fns + dedup + fireAlert |
| `app/api/cron/harness-alarm/route.ts` | Build new | Calls runStallChecks; auth = Bearer CRON_SECRET |
| `vercel.json` | Beef up | Add `{ "path": "/api/cron/harness-alarm", "schedule": "30 * * * *" }` |
| `tests/harness/stall-checks.test.ts` | Build new | Unit tests per check + dedup (see Tests section) |

**Do NOT touch:**
- `lib/harness/task-pickup.ts`
- `lib/harness/pickup-runner.ts`
- `reclaim_stale_tasks()` Postgres function
- `task_queue` schema
- `ARCHITECTURE.md`, `CLAUDE.md`

---

## Tests

**File:** `tests/harness/stall-checks.test.ts` (new)

Required test cases:

| # | Case | Pass condition |
|---|---|---|
| 1 | T1: task stuck 35 min → fires alert | `agent_events` row inserted with `action='stall_alert_fired'`, `meta.trigger='T1'` |
| 2 | T1: task stuck 20 min → no alert | no `stall_alert_fired` row |
| 3 | T1: task stuck 35 min, already alerted 30 min ago → suppressed | dedup prevents second insert |
| 4 | T2: active session >30 min, no completions → fires alert | T2 alert row inserted |
| 5 | T2: active session >30 min, completion 25 min ago → no alert | no T2 alert |
| 6 | T2: no active session → no alert | no T2 alert |
| 7 | T3: queued task 73h old, retry_count=0 → fires alert | T3 alert row inserted |
| 8 | T3: queued task 71h old → no alert | no T3 alert |
| 9 | T3: queued task 73h old, retry_count=1 → no alert | retry_count>0 excluded |
| 10 | T5: last pickup 3h ago, threshold=2h → fires alert | T5 alert row inserted |
| 11 | T5: last pickup 1h ago, threshold=2h → no alert | no T5 alert |
| 12 | `isAlreadyAlerted`: returns true when matching event exists within window | |
| 13 | `isAlreadyAlerted`: returns false when event is outside window | |
| 14 | One trigger check failure does not prevent other triggers from running | All non-failing triggers fire |

---

## Grounding Checkpoint

After ship, Colin verifies manually:

1. **T1:** Set a task to `running` with `last_heartbeat_at = NOW() - INTERVAL '35 minutes'`
   via SQL. Trigger alarm cron: `curl -X POST .../api/cron/harness-alarm -H "Authorization: Bearer $CRON_SECRET"`. Confirm Telegram alert received. Run again → no second alert (dedup). Query: `SELECT meta FROM agent_events WHERE action='stall_alert_fired' AND meta->>'trigger'='T1' ORDER BY occurred_at DESC LIMIT 1` — confirm entity_id, trigger present.

2. **T5:** Confirm last `task_pickup` event in `agent_events`. If last run is >2h old: alarm
   fires T5. If not: manually query `SELECT occurred_at FROM agent_events WHERE action='task_pickup' ORDER BY occurred_at DESC LIMIT 1` and note the gap.

3. **F18 baseline:** `SELECT meta->>'trigger', COUNT(*) FROM agent_events WHERE action='stall_alert_fired' GROUP BY meta->>'trigger'` — confirm rows exist after grounding tests.

**"Working" definition:** T1 fires on simulated condition, dedup suppresses re-alert, and
`stall_alert_fired` rows exist in `agent_events` for each simulated trigger.

---

## Kill Signals

1. **All 5 checks fail** — if Supabase is unreachable, all checks error-out and nothing is
   alerted. The alarm silently does nothing. Mitigation: log `stall_check_run` event at the
   START of the run (before any checks) so absence of this event reveals a dead cron.
2. **T2 false positives on planned downtime** — if Colin deliberately has an active session
   but isn't running harness tasks, T2 fires spuriously. Mitigation: check if any `queued`
   tasks exist before firing T2 — only alert if there's actionable work sitting idle.
3. **T3 fires on legitimately long-queued tasks** — some tasks (low priority, backlog) may
   intentionally sit for >72h. Mitigation: allow manual `dismissed` status as suppression;
   tasks already `dismissed` are excluded by the WHERE clause.
4. **dedup index miss** — if `agent_events` grows large without an index on `(action, occurred_at)`,
   dedup queries may be slow. Builder: check `\d+ agent_events` for existing indexes and add
   if missing: `CREATE INDEX IF NOT EXISTS idx_agent_events_action_occurred ON agent_events (action, occurred_at)`.

---

## Open Questions

**Q1 — BLOCKING for T3:** Acceptance doc assumes T3 "stale meta-task" detection = `queued`
AND `retry_count = 0` AND `created_at < 72h ago`. Is this the intended mechanism? If Colin
meant something else (e.g., LLM check comparing task description to recent completions,
an explicit "stale" metadata flag, or a different age threshold), builder cannot proceed on
T3 until confirmed. T1, T2, T4, T5 can proceed regardless.

**Q2 — Clarifying (non-blocking) — T4 schema:** Migration 0026 (`awaiting_review` status)
is written but not applied to prod. T4 implementation is defensive — silent until 0026
applied. Confirming this is acceptable (no action needed before builder proceeds on T4).

**Q3 — Non-blocking — cron placement:** Proposed schedule `30 * * * *` (new dedicated cron
entry). Alternative: integrate stall checks into the task-pickup cron route (avoids a new
vercel.json entry, runs at the same frequency). Colin's preference?

**Q4 — Non-blocking — T5 threshold:** Current cron is daily (`0 0 * * *`); task-pickup-100
will change it to hourly. Builder reads vercel.json at startup to pick the right threshold.
Confirming this dynamic-threshold approach is acceptable (vs. hardcoding post-task-pickup-100).

**Q5 — Non-blocking — F18 resolution:** Resolution is defined as "stall condition no longer
true on re-check." Interactive acknowledgment (Telegram button tap) requires a follow-up
chunk. Confirming text-only v1 is acceptable.
