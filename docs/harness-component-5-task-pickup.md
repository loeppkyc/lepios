# Autonomous Harness — Component #5: Non-Human Task Pickup

**Status:** Design — in progress
**Author:** Colin + Claude, 2026-04-21
**Scope:** Supabase task queue + Vercel cron pickup that lets the coordinator run without Colin typing
**Rationale:** Audit 2026-04-21 found coordinator/builder pattern 35% complete and entirely blocked by absence of non-human task source. Highest-leverage single move on the board — activates latent coordinator value without building new agent capability.
**Sequencing:** Ahead of Step 6.5 (Ollama daytime tick) per decision 2026-04-21. Step 6.5 design remains valid at docs/harness-step-6.5-ollama-daytime-tick.md.

---

## 1. Goal

The coordinator/builder pattern is fully specified in `.claude/agents/coordinator.md` and
`.claude/agents/builder.md`. It has been successfully exercised once — Sprint 4 plan
generation (Phase 1, `docs/handoffs/cost-log.md`, 2026-04-19). It cannot run again without
Colin typing a prompt. That is the only thing blocking the loop.

Component #5 breaks that dependency. It introduces:

1. **A task queue** — a Supabase table where work items can be written by anything: Colin
   manually, a cron, an API call, a future agent. Tasks accumulate without Colin present.

2. **A pickup cron** — a Vercel route that fires on a schedule, claims the highest-priority
   queued task, writes a structured handoff that coordinator can read cold, and notifies
   Colin via Telegram that work is ready.

**What this unlocks:** Colin queues "Sprint 4 Chunk A" once. The next pickup run claims it,
writes the handoff, sends the Telegram. Colin sees "Coordinator ready — Sprint 4 Chunk A" and
invokes coordinator with one word: *go*. The cognitive work of synthesizing what to do next
is removed. That is the value unlock even in v0, before full remote agent invocation exists.

**The v1 horizon:** pickup claims a task and directly invokes the coordinator via the Claude
Code remote trigger API — no Colin typing required at all. That architecture is noted in §6
but is explicitly out of scope for v0.

> **v0 note:** Autonomous pickup + coordinator planning. Build execution still requires Colin
> to paste one line into Claude Code to start. v1 (remote invocation) is the last mile to
> true unattended operation. Do not mistake v0 shipping for full component #5.

---

## 2. Scope

### In scope (v0)

- `task_queue` Supabase table — schema, migration, RLS
- `GET /api/cron/task-pickup` route — claim, validate, write handoff, notify
- `docs/harness-tasks/active-task.md` — structured handoff file coordinator reads cold
- Telegram notification to Colin when a task is claimed: task description, handoff path,
  one-word invocation instruction
- Feature flag: `TASK_PICKUP_ENABLED` env var
- Dry-run mode: `TASK_PICKUP_DRY_RUN` env var — claims and notifies but writes "[DRY RUN]"
  prefix, no live coordinator invocation
- `KNOWN_EVENT_DOMAINS` updated; `vercel.json` updated
- Stale claim recovery — tasks stuck in `claimed` status reset to `queued` after 30 minutes

### Explicitly out of scope (future versions)

- **Remote coordinator invocation** — calling the Claude Code agent API directly from the
  pickup cron to run coordinator without Colin typing. This is v1; v0 establishes the queue
  and handoff that v1 will consume.
- **GitHub issue watcher** — polling or webhook on a GitHub issues label. Adds external API
  dependency with no advantage over a Supabase row for v0.
- **Telegram inbox reader** — parsing Colin's Telegram messages as task sources. Muddy:
  mixes control channel with alert channel; requires non-trivial NLP to distinguish "run
  coordinator" from "here's a deal I just found."
- **Multi-source priority queue** — merging tasks from multiple origins with per-source
  priority weights. Single source (manual insert + future cron insert) is sufficient for v0.
- **Task dependency graph** — tasks that block each other. Sprint chunk ordering is handled
  by coordinator, not the queue.
- **Dashboard UI for the queue** — reading/writing tasks from the `/autonomous` page.
  SQL is sufficient for v0.

---

## 3. Source choice

Three options evaluated:

| Criterion | Supabase table | GitHub issues | Telegram inbox |
| --- | --- | --- | --- |
| Uses existing infrastructure | Yes — service client already wired | No — new GitHub API auth | Partial — bot exists but alert-only |
| Queryable by Vercel cron | Yes — standard SQL | No — webhook or polling required | No — polling required |
| Supports structured metadata | Yes — JSONB column | Limited — labels + body text | No |
| Inspectable / debuggable | Yes — SQL query | Medium | Low |
| Separation of concerns | Clean — queue is queue | Muddy — issues serve dual purpose | Very muddy |
| Write path from other agents | Yes — INSERT via service client | Requires GitHub token | Requires bot send |
| Colin's existing workflow | Not native (new habit) | Semi-native | Native |

**Chosen: Supabase table.**

The only advantage of GitHub issues or Telegram inbox is that Colin already uses them.
Neither integrates cleanly with a Vercel cron, neither supports structured JSONB metadata,
and both blur the line between their primary purpose and queue semantics. The Supabase
service client is already wired throughout the codebase (`lib/supabase/service.ts`). Adding
a new table is one migration; adding a new integration is a new dependency class.

The "Colin already uses it" advantage belongs to v1 (Telegram inbox reader) or v2 (GitHub
issue sync), once the queue itself is proven. v0 builds the foundation.

---

## 4. Schema

### 4.1 Migration

New table: `task_queue`. Migration file at
`supabase/migrations/0015_add_task_queue.sql`.

```sql
CREATE TABLE public.task_queue (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),

  task        TEXT      NOT NULL,
  description TEXT,                                       -- optional long-form context

  -- 1 = highest priority, 10 = lowest; ties broken by created_at ASC
  priority    SMALLINT  NOT NULL DEFAULT 5,

  -- queued    → waiting to be claimed by pickup cron
  -- claimed   → pickup cron claimed it; handoff written; coordinator not yet started
  -- running   → coordinator actively executing with heartbeat
  -- completed → coordinator finished successfully
  -- failed    → unrecoverable error or exhausted retries
  -- cancelled → manually cancelled, or max_retries hit on stale reclaim
  status      TEXT      NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued','claimed','running','completed','failed','cancelled')),

  source      TEXT      NOT NULL DEFAULT 'manual'
              CHECK (source IN ('manual','handoff-file','colin-telegram','cron')),

  metadata    JSONB     NOT NULL DEFAULT '{}'::jsonb,
  result      JSONB,

  retry_count SMALLINT  NOT NULL DEFAULT 0,
  max_retries SMALLINT  NOT NULL DEFAULT 2,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at        TIMESTAMPTZ,
  claimed_by        TEXT,
  last_heartbeat_at TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  error_message     TEXT
);

-- Pickup query: highest-priority queued task first
CREATE INDEX task_queue_pickup_idx
  ON public.task_queue (status, priority ASC, created_at ASC);

-- Stale-claim reclaim: claimed/running tasks with stale heartbeat
CREATE INDEX task_queue_stale_idx
  ON public.task_queue (status, last_heartbeat_at)
  WHERE status IN ('claimed', 'running');

-- Observability: tasks by source, newest first
CREATE INDEX task_queue_source_idx
  ON public.task_queue (source, created_at DESC);

ALTER TABLE public.task_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_queue_authenticated" ON public.task_queue
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Rollback: DROP TABLE IF EXISTS public.task_queue;
```

### 4.2 RLS

RLS is enabled. The service role bypasses RLS automatically — no explicit policy is needed
for the pickup cron or coordinator. Authenticated users get full access (single-user app).
SPRINT5-GATE: tighten to `profiles.id` when multi-user ships.

### 4.3 Adding tasks (v0 write path)

Colin inserts tasks directly via Supabase Studio or a one-liner:

```sql
INSERT INTO task_queue (task, priority, source, metadata)
VALUES (
  'Sprint 4 Chunk A — SP-API integration + Today Live / Yesterday',
  1,
  'manual',
  '{"sprint": 4, "chunk": "A", "plan_path": "docs/sprint-4/plan.md"}'
);
```

This is the entire v0 write path. No UI, no API endpoint, no Telegram parser. Add those
in future versions when the queue has proven its value.

---

## 5. Pickup cadence

### Cron schedule: once per day at 10:00 MT (16:00 UTC)

One pickup check per day for v0. Rationale:

- Sprint chunks take hours to execute; daily granularity is sufficient for the observation
  window (§11 clean-running criteria).
- 10:00 MT is early in Colin's active window — if coordinator is invoked on pickup, there
  is still time for a grounding checkpoint within the same day.
- Well-separated from existing crons (see table below).

Upgrade path: move to every 30 minutes on Vercel Pro once the queue is proven stable.
That requires changing one line in `vercel.json` and verifying the claim logic holds under
faster cadence (§6 covers idempotency).

### Coexistence with existing crons

| UTC | MT (MDT) | Route | What |
| --- | --- | --- | --- |
| 06:00 | 00:00 | `/api/knowledge/nightly` | Knowledge rollup |
| 08:00 | 02:00 | `/api/cron/night-tick` | Night watchman |
| 12:00 | 06:00 | `/api/cron/morning-digest` | Telegram digest |
| 13:00 | 07:00 | `/api/metrics/digest` | Metrics rollup |
| **16:00** | **10:00** | **`/api/cron/task-pickup`** | **← new** |
| 18:00 | 12:00 | `/api/cron/daytime-tick` | Step 6.5 (deferred) |

Three-hour gap before and after. No scheduling conflicts.

### What a pickup run does (in order)

1. **Stale claim recovery** — reset any `claimed` or `running` tasks where
   `COALESCE(last_heartbeat_at, claimed_at) < NOW() - INTERVAL '10 minutes'` back to
   `queued`, increment `retry_count`. If `retry_count >= max_retries` after reset, move to
   `cancelled` and send Telegram alert. Using `last_heartbeat_at` (not `claimed_at`) means
   a legitimately long-running coordinator chunk is never falsely stale as long as it keeps
   heartbeating.
2. **Claim the top task** — atomic UPDATE of the highest-priority `queued` task. If 0 rows
   updated (race or empty queue), return `{claimed: null, reason: "queue-empty"}` cleanly.
3. **Validate the task** — confirm `task` field is non-empty, `metadata` is parseable if
   present. On failure: mark `failed`, send Telegram, stop.
4. **Write the handoff file** — write `docs/harness-tasks/active-task.md` with the task
   details in coordinator-readable format (see §6).
5. **Send Telegram notification** — alert Colin that a task has been claimed and the handoff
   is written. Include the one-word invocation: "Reply 'go' to start coordinator."
6. **Write `agent_events` row** — `task_type: 'task_pickup'`, result includes claimed task
   id and handoff path.

---

## 6. Claim semantics

### Atomic claim (preventing double-claim)

The claim is a single UPDATE with a condition:

```sql
UPDATE task_queue
SET
  status     = 'claimed',
  claimed_at = NOW(),
  claimed_by = $run_id      -- UUID generated at pickup run start
WHERE id = (
  SELECT id FROM task_queue
  WHERE status = 'queued'
  ORDER BY priority ASC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED    -- concurrent-safe; skips rows locked by other transactions
)
RETURNING id, task, metadata;
```

`FOR UPDATE SKIP LOCKED` ensures two concurrent pickup runs (e.g., a manual invocation
racing the cron) cannot claim the same task. If the row is locked, the second run skips it
and finds zero rows — returns `{claimed: null, reason: "queue-empty"}` without error.

`claimed_by` stores the pickup `run_id`. If two runs somehow claim different tasks
simultaneously (both find different rows), each run owns its task exclusively. Coordinator
reads `claimed_by` from the handoff to confirm it's processing the right run.

### Idempotency

The pickup route is not idempotent by design: each call to the route produces at most one
new claim. Invoking the route twice when no task is queued is safe (both return
`{claimed: null}`). Invoking twice when one task is queued: first call claims it, second
finds it `claimed` (not `queued`) and returns `{claimed: null}`.

No `Idempotency-Key` header is needed — Vercel crons invoke exactly once per schedule slot,
and manual invocations are one-shot by operator intent.

### Status lifecycle

```text
queued → claimed → running → (completed | failed)   (happy path)
       → claimed → cancelled                          (max_retries hit on stale reset)
       → failed                                       (validation failure at claim time)
queued → cancelled                                    (manual cancellation via SQL)
failed → queued                                       (if retry_count < max_retries)
```

`running` distinguishes a task that has been claimed but not yet started (coordinator
hasn't invoked yet) from one that is actively executing with a live heartbeat. In v0,
coordinator transitions status to `running` and begins writing `last_heartbeat_at` every
5 minutes. Stale detection covers both states: `status IN ('claimed','running')`.

### Stale claim recovery

A task stays `claimed` indefinitely if coordinator is never invoked (Colin saw the Telegram
but didn't act). The recovery logic runs at the start of each pickup run:

```text
FOR EACH task WHERE status IN ('claimed', 'running')
  AND COALESCE(last_heartbeat_at, claimed_at) < NOW() - INTERVAL '10 minutes':
  retry_count += 1
  IF retry_count >= max_retries:
    status = 'cancelled', error_message = 'stale claim: max retries exhausted'
    → Telegram alert: "Task [id] cancelled after [N] stale claims"
  ELSE:
    status = 'queued'   -- re-queue for next pickup
    claimed_at = NULL, claimed_by = NULL, last_heartbeat_at = NULL
```

**Why `COALESCE(last_heartbeat_at, claimed_at)` and not a flat claimed-age rule:**
Real LepiOS build chunks routinely run longer than 30 minutes. A flat `claimed_at + 30min`
threshold would falsely stale-cancel a coordinator that is actively working. The heartbeat
column solves this: coordinator writes `last_heartbeat_at = NOW()` every 5 minutes while
running. Stale detection sees a fresh heartbeat and leaves the task alone. A truly abandoned
task (Colin closed the session, coordinator died) stops heartbeating and trips the 10-minute
window. With `max_retries: 2`, a task gets three total pickup attempts before cancellation.

**Heartbeat write path (v0):** In v0, the heartbeat is a manual convention — the coordinator
agent is expected to `UPDATE task_queue SET last_heartbeat_at = NOW() WHERE id = $task_id`
via the Supabase service client every 5 minutes during a long run. This is documented in
`coordinator.md` (to be updated as part of the build step). In v1, the remote invocation
wrapper handles heartbeating automatically.

---

## 7. Failure modes

### 7.1 No queued tasks (normal condition, not a failure)

**Detection:** The claim UPDATE returns 0 rows.

**Behavior:** Route returns `{ok: true, claimed: null, reason: "queue-empty"}`. One
`agent_events` row written with `status: 'success'`, `output_summary` includes the reason.
No Telegram notification — an empty queue is not an alert condition.

### 7.2 Claim race condition (two concurrent pickup runs)

**Detection:** The `FOR UPDATE SKIP LOCKED` causes the second run's UPDATE to return 0 rows.

**Behavior:** Second run returns `{ok: true, claimed: null, reason: "queue-empty"}` — it
cannot distinguish an empty queue from a race. This is correct: the second run has nothing
to claim. No error, no alert. Both runs write `agent_events` rows; the second shows
`claimed: null`.

### 7.3 Task validation failure (malformed task row)

**Detection:** After claim, validation checks `task` is non-empty and `metadata` is valid
JSON if present. Either fails.

**Behavior:**

- Task moved to `status: 'failed'`, `error` field populated with validation message
- `active-task.md` is NOT written — no partial handoff for coordinator
- Telegram alert: "Harness pickup: task [id] failed validation — [error]. Inspect
  task_queue."
- Route returns HTTP 200 (the pickup cron itself ran fine; the task was bad)

### 7.4 Handoff file write failure (filesystem / git issues)

**Detection:** Write to `docs/harness-tasks/active-task.md` throws or Supabase storage
write fails.

**Behavior:**

- Task remains `claimed` (not reverted — the claim is durable)
- Error logged to `agent_events`
- Telegram alert includes the error and the raw task content (so Colin can manually create
  the handoff if needed)
- Stale claim recovery (§6) will re-queue the task after 30 minutes

### 7.5 Telegram notification failure

**Detection:** Telegram API returns non-200 or throws.

**Behavior:** Swallowed — the task IS claimed and the handoff IS written. The pickup run
succeeded. Colin can discover the active task by querying Supabase or reading
`active-task.md` directly. Log the Telegram failure to `agent_events` under the pickup row.

### 7.6 Task loop (infinite retry / poisoned task)

**Detection:** A task re-queues repeatedly — `retry_count` climbs toward `max_retries`.

**Behavior:** Stale claim recovery (§6) enforces `max_retries: 2` (default). After the
third stale claim, the task is cancelled and Colin is notified. The task content is
preserved in the `task_queue` row for post-mortem. The queue unblocks and proceeds
to the next task.

**Prevention:** `max_retries` is per-row and can be overridden at insert time for tasks
that are expected to take longer (e.g., a multi-hour chunk might use `max_retries: 5`
and a longer stale threshold via metadata).

### 7.7 Queue poisoning (bad tasks blocking good ones)

**Detection:** The highest-priority task repeatedly fails validation or hits stale claim.
All tasks behind it are blocked because pickup always claims the top task first.

**Behavior:** Once the bad task reaches `cancelled` (after `max_retries`), the next task
in priority order is claimable. No manual intervention required — the cancellation unblocks
the queue automatically.

**If urgency requires earlier unblocking:** Colin runs:

```sql
UPDATE task_queue SET status = 'cancelled' WHERE id = '[poison-task-id]';
```

This is a documented escape hatch, not an automated behavior.

### 7.8 Pickup cron silently not firing

**Detection:** Expected `agent_events` rows with `task_type: 'task_pickup'` are absent.
The `event_log_consistency` night_tick check should be extended to flag "expected 1
task_pickup row in last 24h, found 0" — same pattern as the §7.6 note in the Step 6.5
design doc.

**Behavior:** No automated recovery in v0. Colin checks Vercel cron logs. The task queue
is unaffected — tasks accumulate in `queued` state until the cron resumes.

---

## 8. Integration with coordinator/builder

### v0: handoff-file integration

When a task is claimed, the pickup run writes
`docs/harness-tasks/active-task.md` in coordinator-readable format:

```markdown
# Harness Task — Active

**Claimed at:** 2026-04-21T16:00:05Z
**Claimed by:** {run_id}
**Task ID:** {uuid}
**Source:** colin
**Priority:** 10

## Task

Sprint 4 Chunk A — SP-API integration + Today Live / Yesterday

## Description

(from description column if populated)

## Metadata

sprint: 4
chunk: A
plan_path: docs/sprint-4/plan.md

## Coordinator instruction

Read docs/sprint-4/plan.md and docs/sprint-state.md.
Proceed with Phase 2 (acceptance doc) for Chunk A.
Follow coordinator.md escalation rules.
Cache-match is disabled for Sprint 4 — escalate all acceptance docs to Colin.

## Invocation

Use coordinator sub-agent. Active task at docs/harness-tasks/active-task.md.
```

The Telegram notification to Colin reads:

```text
[LepiOS Harness] Task claimed — Sprint 4 Chunk A

Priority: 10 | Source: colin
Handoff: docs/harness-tasks/active-task.md

Start coordinator: Use coordinator sub-agent. Active task at docs/harness-tasks/active-task.md.
```

Colin copies the last line into Claude Code. That is the only thing he needs to type.

### v0 limitation — what coordinator does NOT do automatically

In v0, coordinator does not write back to `task_queue` when a chunk completes. The task
stays `claimed` until:

- Colin manually sets `status = 'completed'` after confirming the sprint grounding checkpoint,
  OR
- The next pickup run's stale recovery re-queues it (if Colin forgets)

This is acceptable for v0. The queue's value is task selection automation, not lifecycle
tracking. Full lifecycle tracking (coordinator writes `done` on chunk completion, next chunk
auto-queues) is v1 behavior.

### v1: remote invocation (out of scope, documented for continuity)

In v1, the pickup route calls the Claude Code remote trigger API after writing the handoff:

```text
POST https://api.anthropic.com/v1/... (Claude Code remote trigger endpoint)
Authorization: Bearer {CLAUDE_CODE_API_KEY}
Body: { agent: "coordinator", context_file: "docs/harness-tasks/active-task.md" }
```

Coordinator runs autonomously. Escalations and grounding checkpoints are surfaced via
Telegram (coordinator.md already defines Telegram as the escalation notification path).
Colin only types when coordinator explicitly asks.

This requires `CLAUDE_CODE_API_KEY` in Vercel env and the remote trigger API being
available. Neither is in scope for v0.

---

## 9. Acceptance criteria

Machine-checkable. Tests written and passing before any v0 code merges.

### AC-1: task_queue table exists with correct schema

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'task_queue'
ORDER BY ordinal_position;
```

Expected columns: `id` (uuid, not null), `task` (text, not null), `description` (text,
nullable), `priority` (smallint, not null, default 5), `status` (text, not null, default
'queued'), `source` (text, not null, default 'manual'), `metadata` (jsonb, not null,
default '{}'), `result` (jsonb, nullable), `retry_count` (smallint, not null, default 0),
`max_retries` (smallint, not null, default 2), `created_at` (timestamptz, not null),
`claimed_at` (timestamptz, nullable), `claimed_by` (text, nullable),
`last_heartbeat_at` (timestamptz, nullable), `completed_at` (timestamptz, nullable),
`error_message` (text, nullable).

### AC-2: Task insert succeeds and defaults are correct

```sql
INSERT INTO task_queue (task) VALUES ('test task') RETURNING *;
```

Expected: `status = 'queued'`, `priority = 5`, `retry_count = 0`, `max_retries = 2`,
`source = 'manual'`, `metadata = '{}'`, `claimed_at IS NULL`, `claimed_by IS NULL`,
`last_heartbeat_at IS NULL`.

### AC-3: Pickup route claims highest-priority queued task atomically

Setup: insert two tasks — priority 10 and priority 80.

```text
GET /api/cron/task-pickup  (authorized)
→ HTTP 200
→ body.claimed.id = ID of the priority-10 task
→ that row in task_queue: status = 'claimed', claimed_at IS NOT NULL,
    claimed_by = body.run_id
→ the priority-80 task: status = 'queued' (untouched)
```

### AC-4: Empty queue returns clean no-op

Setup: no `queued` tasks in `task_queue`.

```text
GET /api/cron/task-pickup  (authorized)
→ HTTP 200
→ body = { ok: true, claimed: null, reason: "queue-empty" }
→ no task_queue rows mutated
→ no Telegram notification sent
```

### AC-5: Stale claim recovery re-queues on no-heartbeat for 10 minutes

Setup: insert a task, claim it manually with `claimed_at = NOW() - INTERVAL '11 minutes'`,
`last_heartbeat_at = NULL`, `retry_count = 0`.

```text
GET /api/cron/task-pickup  (authorized)
→ that task's status = 'queued', retry_count = 1, claimed_at = NULL,
    last_heartbeat_at = NULL
→ if a queued task existed with higher priority, that was claimed instead
```

Contrast — a task with a fresh heartbeat is NOT stale:
setup same task but `last_heartbeat_at = NOW() - INTERVAL '4 minutes'`.

```text
GET /api/cron/task-pickup  (authorized)
→ that task's status = 'claimed' (unchanged) — heartbeat is fresh
```

### AC-6: max_retries exhaustion → cancelled + Telegram alert

Setup: task with `status = 'claimed'`, `claimed_at = NOW() - INTERVAL '11 minutes'`,
`last_heartbeat_at = NULL`, `retry_count = 2` (at max_retries default).

```text
GET /api/cron/task-pickup  (authorized)
→ task status = 'cancelled', error_message contains 'stale claim: max retries exhausted'
→ Telegram alert sent (verify via mock or log)
→ task does NOT re-enter queued state
```

### AC-7: Dry-run mode — no DB mutations, Telegram prefixed

```text
With TASK_PICKUP_DRY_RUN=1:
GET /api/cron/task-pickup  (authorized, queue has one task)
→ HTTP 200
→ body.dry_run = true
→ no task_queue rows mutated (task remains status = 'queued')
→ docs/harness-tasks/active-task.md NOT written
→ Telegram message (if sent) includes "[DRY RUN]" prefix
```

### AC-8: Feature flag gates entirely

```text
With TASK_PICKUP_ENABLED unset or empty:
GET /api/cron/task-pickup  (authorized)
→ HTTP 200
→ body = { ok: false, reason: "task-pickup-disabled", duration_ms: 0 }
→ no task_queue mutations
→ no Telegram notification
→ no agent_events row written
```

### AC-9: Unauthorized requests rejected, no side effects

```text
GET /api/cron/task-pickup  (no Authorization header, CRON_SECRET set)
→ HTTP 401
→ no task_queue mutations
→ no active-task.md written
```

### AC-10: agent_events row written per pickup run (heartbeat)

After any authorized invocation (queue empty or task claimed):

```sql
SELECT task_type, status, meta
FROM agent_events
WHERE task_type = 'task_pickup'
ORDER BY occurred_at DESC LIMIT 1;
```

Expected: row present with `task_type = 'task_pickup'`, `status` is `'success'` or
`'warning'`. `meta` contains `run_id` (uuid) and `claimed_task_id` (uuid or null).

### AC-11: vercel.json cron entry is present and correct

```text
Read vercel.json. Assert crons array contains:
  { "path": "/api/cron/task-pickup", "schedule": "0 16 * * *" }
```

### AC-12: Existing harness unaffected

```text
→ npm test passes (all 370 existing tests green)
→ night_tick, morning_digest continue to write agent_events rows at expected rate
→ event_log_consistency check does not produce new flags
→ KNOWN_EVENT_DOMAINS in lib/orchestrator/config.ts includes 'orchestrator'
    (task_pickup rows use domain 'orchestrator' — no config change needed)
```

### AC-13: Heartbeat column present; fresh heartbeat prevents stale recovery

```sql
-- Verify column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'task_queue' AND column_name = 'last_heartbeat_at';
-- Expected: row returned, data_type = 'timestamp with time zone', is_nullable = 'YES'
```

```text
Setup: task with status = 'claimed', claimed_at = NOW() - 11 minutes,
       last_heartbeat_at = NOW() - 4 minutes, retry_count = 0.

GET /api/cron/task-pickup  (authorized)
→ task status = 'claimed' (unchanged) — heartbeat within 10-minute window
→ retry_count = 0 (unchanged)
→ no Telegram stale alert

Then: set last_heartbeat_at = NOW() - 11 minutes. Run again.
→ task status = 'queued', retry_count = 1 — now stale
```

---

## 10. Rollout

### Feature flag

`TASK_PICKUP_ENABLED` environment variable.

- **Truthy** (`1`, `true`, any non-empty string): pickup runs normally
- **Absent or empty**: route returns `{ok: false, reason: "task-pickup-disabled"}` immediately.
  No DB reads, no Telegram, no agent_events write.

Fast-disable: set `TASK_PICKUP_ENABLED=` in Vercel env → effective on next invocation,
no redeploy required.

### Dry-run mode

`TASK_PICKUP_DRY_RUN` environment variable. When truthy: full logic runs (queue read,
stale recovery evaluated, validation run) but no DB mutations, no file writes, no live
Telegram notifications. All outputs prefixed `[DRY RUN]`. Use this to verify the pickup
logic before enabling live operation.

### Rollout order

1. **Migration** — apply `0015_add_task_queue.sql` to production Supabase.
   Verify table exists via Studio.

2. **Code merged, both flags off** — merge PR with `TASK_PICKUP_ENABLED` unset.
   Existing behavior unchanged. Route exists but is inert.

3. **Dry-run canary** — set `TASK_PICKUP_DRY_RUN=1`, `TASK_PICKUP_ENABLED=1`.
   Insert one test task (priority 99, source 'manual', task 'dry-run test').
   Invoke route manually. Verify: HTTP 200, `dry_run: true` in body, no DB mutations,
   active-task.md not written, Telegram shows `[DRY RUN]`.

4. **Live canary** — clear `TASK_PICKUP_DRY_RUN`. Insert a real task (low-stakes,
   priority 90). Invoke manually. Verify: task claimed, active-task.md written, Telegram
   received, `agent_events` row present.

5. **Enable cron** — verify `vercel.json` entry and confirm Vercel cron is scheduled.
   Monitor `agent_events` for `task_pickup` rows daily. Observe for 3+ days (§11).

6. **First real coordinator invocation via pickup** — insert Sprint 4 Chunk A task.
   Wait for pickup cron or invoke manually. Receive Telegram. Invoke coordinator from
   the handoff. Verify coordinator runs Phase 2 and produces an acceptance doc.

### Fast disable

1. Set `TASK_PICKUP_ENABLED=` in Vercel env (fastest, no redeploy)
2. Remove from `vercel.json` (removes cron schedule, requires deploy)
3. `UPDATE task_queue SET status = 'cancelled' WHERE status = 'queued'` (drains queue
   without disabling pickup)

---

## 11. Resume-Sprint-4 criteria

Sprint 4 is paused awaiting this component per `docs/sprint-state.md`
(`awaiting: "harness-task-pickup"`).

### Required (all must be true simultaneously)

1. **Migration applied and verified** — `task_queue` table exists in production Supabase
   with correct schema (AC-1 passes against production).

2. **Three consecutive days of pickup crons completing cleanly** — `agent_events` rows
   with `task_type = 'task_pickup'` and `status = 'success'` for three calendar days (MT),
   with no `status = 'error'` rows in the same window. An empty-queue result
   (`claimed: null`) counts as clean — it means the cron fired and found nothing, which is
   correct behavior.

3. **At least one real coordinator invocation via pickup** — a task was claimed, the
   active-task.md handoff was written, Telegram notification received, and coordinator
   was successfully invoked from the handoff. Coordinator completed at least one phase
   (any phase) before returning. This proves the end-to-end path, not just the queue
   infrastructure.

4. **Existing harness unaffected** — AC-12 holds; 370 tests still passing on main.

### Not required

- Three days of claimed tasks. Empty-queue clean runs count. The stability signal is "does
  the cron fire and handle all cases gracefully," not "is there always work queued."
- Zero stale claim recoveries. Stale recovery working correctly is itself a health signal —
  a task that re-queued and was re-claimed on the next run is a success, not a failure.

### How to verify

```sql
SELECT
  date_trunc('day', occurred_at AT TIME ZONE 'America/Denver') AS day_mt,
  count(*)                                               AS pickups,
  count(*) FILTER (WHERE status = 'success')             AS clean,
  count(*) FILTER (WHERE status != 'success')            AS dirty
FROM agent_events
WHERE task_type = 'task_pickup'
  AND occurred_at > now() - interval '4 days'
GROUP BY 1
ORDER BY 1 DESC;
```

Three rows with `pickups >= 1, dirty = 0` = infrastructure criteria met.

Confirm coordinator invocation separately: check `docs/handoffs/cost-log.md` for an entry
with a timestamp after component #5 deployment. That is the end-to-end proof.

When criteria are met: update `docs/sprint-state.md` — set `awaiting` to `active`,
clear `paused_reason`, set `status` to the appropriate sprint status, update
`last_updated_at`.
