# Acceptance Doc — Work-Budget Mode

**Feature:** `/budget` command + budget-aware harness scheduling
**Date:** 2026-04-25
**Status:** ready for builder
**task_queue id:** 3eaba964 (priority 1 — blocks Tier 1 batch beyond diag_coverage + utils)

---

## 1. Overview

Work-budget mode lets Colin give the harness a time window (`/budget 2h30m`) and
let it run autonomously: claim tasks, complete them, pick self-generated follow-up
work when the queue empties, isolate escalations without pausing throughput, and
stop cleanly when time is up.

The budget window is a Telegram text command. The harness picks work greedy-by-priority
within the window, estimates task cost before claiming, and sends a Telegram summary
when the window closes.

---

## 2. /budget Command Parser + State Machine

### Text command format

```
/budget 2h30m    → 150 minutes
/budget 90m      → 90 minutes
/budget 2h       → 120 minutes
/budget stop     → cancel active session
/budget status   → show remaining time + task count
```

Parser regex: `/^\/budget\s+((\d+)h((\d+)m)?|(\d+)m|stop|status)$/i`

Extracted `budget_minutes`:

- `{N}h` → N \* 60
- `{N}h{M}m` → N \* 60 + M
- `{N}m` → N
- Cap: 480 minutes (8h). If over cap, reject with message:
  "8h max per budget window. Use /budget 8h or split across sessions."
- Minimum: 10 minutes. Below 10m, reject:
  "10 minute minimum — not enough time to complete a task."

### State machine

States: `active | drained | stopped`. No active session = idle.

| Current state   | Command          | Action                                                                                                     |
| --------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| idle            | `/budget Xh`     | Insert `work_budget_sessions` row, status=`active`. Reply: "Budget window open: Xh. Starting now."         |
| active          | `/budget Xh`     | Reject: "Budget already active. Use /budget status or /budget stop first."                                 |
| active          | `/budget stop`   | Set session status=`stopped`, completed_at=NOW(). Reply: "Budget stopped. N tasks completed in M minutes." |
| active          | `/budget status` | No state change. Reply: status message (§2a below).                                                        |
| drained/stopped | `/budget Xh`     | Insert new `work_budget_sessions` row, status=`active`.                                                    |

### §2a — Status message format

```
⏱ Budget: {used}m used / {total}m — {remaining}m remaining
✅ Completed: {completed_count} tasks
🔄 In progress: {in_progress_count}
⏳ Queued: {queued_count}
📋 Next: {next_task_title or 'queue empty'}
```

---

## 3. Estimator Module

**File:** `lib/work-budget/estimator.ts`

### Input

`task_queue` row: `task TEXT`, `description TEXT`, `metadata JSONB`

### Algorithm

Step 1 — extract signals from task + description text:

| Signal pattern                     | Minutes added   |
| ---------------------------------- | --------------- |
| `migration`                        | +10             |
| `test` / `tests`                   | +15             |
| `study doc` / `phase 1a`           | +20             |
| `acceptance doc` / `phase 1d`      | +25             |
| `multi-file` / `multiple files`    | +15             |
| `fix` / `cleanup` / `update` alone | −10 (from base) |
| `port` / `streamlit port`          | +30             |
| base                               | 20              |

Step 2 — map total to bucket:

| Bucket | Range   | Estimated minutes (point estimate) |
| ------ | ------- | ---------------------------------- |
| XS     | < 30    | 15                                 |
| S      | 30–60   | 45                                 |
| M      | 60–120  | 90                                 |
| L      | 120–180 | 150                                |
| XL     | > 180   | 210 + Ollama refinement            |

Step 3 — XL only: call Ollama ANALYSIS (qwen2.5:32b) with:

```
Given this task description, estimate how long it will take to complete
(coordinator + builder phases, in minutes). Reply with a single integer only.

Task: {task}
Description: {description}
```

If Ollama unreachable or circuit OPEN: use heuristic XL point estimate (210).

### Output

```typescript
interface EstimateResult {
  bucket: 'XS' | 'S' | 'M' | 'L' | 'XL'
  estimated_minutes: number
  method: 'heuristic' | 'ollama' | 'heuristic_fallback'
}
```

Store result in `task_queue.estimated_minutes` (new column, migration 0027).

### Calibration loop

**On task completion** (in pickup-runner.ts `onTaskComplete` hook):

1. Compute `actual_minutes = ROUND(EXTRACT(EPOCH FROM (completed_at - claimed_at)) / 60)`
2. Write to `task_queue.actual_minutes`
3. If `estimated_minutes IS NOT NULL`: compute
   `estimation_error_pct = ROUND(((actual - estimated) / estimated::float) * 100)`
   and write to `task_queue.estimation_error_pct`
4. Log to `agent_events`:
   - domain: `'work_budget'`
   - action: `'estimation.complete'`
   - meta: `{ estimated_minutes, actual_minutes, estimation_error_pct, bucket, keywords_hit: string[], method }`

**Weight adjustment (run after every 10 completions OR weekly cron)**

File: `lib/work-budget/calibrator.ts`

Algorithm:

1. Query last 50 `agent_events` rows where action=`'estimation.complete'` and `meta.keywords_hit` is non-empty
2. For each keyword that appears in ≥3 of those rows, compute:
   `avg_error = mean(estimation_error_pct)` across tasks where that keyword contributed
3. Apply gradient:
   - `avg_error > +15%` (consistently undershooting): raise keyword weight by 5min
   - `avg_error < -15%` (consistently overshooting): lower keyword weight by 5min
   - Otherwise: no change
4. Bound each adjustment: weight change ≤ ±20% of current weight per cycle
5. Write updated weights to `work_budget_keyword_weights` table (migration 0027)
6. Log calibration run to `agent_events`:
   - action: `'estimation.calibration_run'`
   - meta: `{ keywords_adjusted: string[], weights_before: Record<string,number>, weights_after: Record<string,number>, samples_used: number }`

**Weight storage** (`work_budget_keyword_weights` table, migration 0027):

```
keyword TEXT PK, weight_minutes INTEGER, last_updated TIMESTAMPTZ
```

Seeded with initial values from §3 algorithm table. Estimator reads from this
table at runtime (falls back to hardcoded defaults if table is empty).

---

## 4. Budget Tracker

**File:** `lib/work-budget/tracker.ts`

State lives in `work_budget_sessions` table (migration 0027). Updated
transactionally after each task completes or is abandoned.

### Budget check logic (called in pickup-runner.ts before each claim)

```typescript
function canClaimNextTask(session: WorkBudgetSession, nextTaskEstimate: number): boolean {
  const used = session.used_minutes
  const total = session.budget_minutes
  const remaining = total - used
  // Do not claim if estimated task cost exceeds remaining time.
  // Exception: remaining > 0 but no tasks are smaller → claim smallest available.
  return remaining >= nextTaskEstimate || remaining >= MIN_CLAIMABLE_MINUTES
}
const MIN_CLAIMABLE_MINUTES = 10
```

### Update on task complete

```sql
UPDATE work_budget_sessions
SET used_minutes = used_minutes + $actual_minutes
WHERE status = 'active'
  AND id = $session_id;
```

### Drain detection

After every task completion: if `used_minutes >= budget_minutes` OR no tasks
remain and self-generated work pipeline is exhausted (§5), set
`status='drained', completed_at=NOW()`. Fire Telegram summary (§4a below).

### §4a — Budget close summary

```
⏱ Budget window closed: {used}m / {total}m used.
✅ {completed_count} tasks completed
⏸ {awaiting_review_count} escalations pending your reply
🗂 {queued_count} tasks remain in queue
```

If `awaiting_review_count > 0`, append:
"Reply to pending escalations to unblock queued work."

---

## 5. Self-Generated Work Source Pipeline

Activated when task_queue has no eligible `queued` rows (excluding
improvement_proposal and budget_session type tasks, which are handled normally).

**Phase 1 — improvement proposals (already queued)**

These are in task_queue already (`metadata->>'task_type_label' = 'improvement_proposal'`).
No generation step. Pickup claims them in normal priority order.

**Phase 2 — doc gaps (generated)**

Scan `docs/` for markdown files containing `TODO`, `PENDING`, `TBD`, `[ ]` (unchecked
checkbox):

```bash
grep -rl 'TODO\|PENDING\|TBD\|\[ \]' docs/ --include='*.md'
```

For each hit file, generate one task_queue row:

```
task: "Complete doc gaps in {file_path}"
description: "{N} incomplete items found: {first 3 TODO lines}"
metadata: { task_type_label: 'doc_gap', source_file: file_path }
priority: 7
```

Cap: 5 doc gap tasks per budget window.

**Phase 3 — test gaps (generated)**

Find TypeScript source files changed in last 20 commits that lack a corresponding
test file:

```bash
git log --name-only --format='' -20 | grep '\.ts$' | grep -v '\.test\.' | sort -u
```

Cross-reference against `tests/` directory. Missing coverage → one task per file:

```
task: "Add missing tests for {file_path}"
description: "No test file found. Changed in last 20 commits."
metadata: { task_type_label: 'test_gap', source_file: file_path }
priority: 8
```

Cap: 3 test gap tasks per budget window.

**Phase 4 — halt**

If all three tiers exhausted: set session status=`drained`, fire §4a summary with
note: "Queue fully drained — all eligible work completed."

---

## 6. Escalation Isolation Logic

When coordinator hits a decision requiring Colin input (a `pending_colin_q`):

1. Coordinator writes question to `task_queue.metadata.pending_colin_qs` (array)
2. Coordinator sets `task_queue.status = 'awaiting_review'`
3. Coordinator sends Telegram notification:
   ```
   ❓ Escalation: {task_title}
   Q: {question_text}
   This task is paused. Budget continues on next task.
   Reply /review {task_id} {answer} to unblock.
   ```
4. Coordinator exits (stops heartbeating)
5. Pickup cron detects `awaiting_review` (not stale, not failed) → skips → claims next task
6. Budget tracker does NOT charge used_minutes for time spent awaiting Colin reply

**No waiting.** The budget window does not pause for escalations.

**Unblocking:** When Colin replies, the coordinator is re-invoked on that task
(existing task-pickup mechanism). Resumes from the paused phase using
`pending_colin_qs` answers in `metadata`.

---

## 7. Overrun Handling

**Rule: soft stop. Complete in-flight task, then stop.**

The budget check runs before claiming each new task. Once `remaining < MIN_CLAIMABLE_MINUTES`,
no new tasks are claimed. The currently-running task completes normally. Then
the session transitions to `drained` (§4).

No 10% grace. The in-flight completion IS the grace. If the in-flight task
itself overshoots its estimate, it still completes — never abort a running task
mid-phase for budget reasons.

---

## 8. Required Migrations

### Migration 0027 — work_budget_sessions, keyword weights, task_queue columns

```sql
-- work_budget_sessions table
CREATE TABLE public.work_budget_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'drained', 'stopped')),
  budget_minutes INTEGER NOT NULL CHECK (budget_minutes BETWEEN 10 AND 480),
  used_minutes INTEGER NOT NULL DEFAULT 0 CHECK (used_minutes >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'telegram',
  telegram_chat_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'
);

-- calibration weight table (seeded with initial heuristic values)
CREATE TABLE public.work_budget_keyword_weights (
  keyword TEXT PRIMARY KEY,
  weight_minutes INTEGER NOT NULL,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.work_budget_keyword_weights (keyword, weight_minutes) VALUES
  ('migration', 10),
  ('test', 15),
  ('tests', 15),
  ('study doc', 20),
  ('phase 1a', 20),
  ('acceptance doc', 25),
  ('phase 1d', 25),
  ('multi-file', 15),
  ('multiple files', 15),
  ('port', 30),
  ('streamlit port', 30),
  ('fix', -10),
  ('cleanup', -10),
  ('update', -10);

-- task_queue: estimation + calibration columns
ALTER TABLE public.task_queue
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS actual_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS estimation_error_pct INTEGER;
```

---

## 9. F17 — Behavioral Ingestion

Every budget session is a behavioral signal about Colin's work prioritization:

| Event                                        | Signal type         | Path engine use                                               |
| -------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `/budget Xh`                                 | Work commitment     | Budget window length → how much work Colin thinks needs doing |
| Task completed within budget                 | Priority validation | These task types are worth Colin's budget                     |
| Task skipped (budget exhausted before claim) | De-prioritization   | These tasks can wait                                          |
| Escalation count per session                 | Coordination need   | High escalation → specs are under-specified                   |

Log every budget event to `agent_events`:

- domain: `'work_budget'`
- action: `'work_budget.{opened|task_completed|task_escalated|drained|stopped}'`
- actor: `'colin'` (opened/stopped) or `'system'` (drained)
- meta: `{ session_id, budget_minutes, used_minutes, completed_count, task_id? }`

---

## 10. F18 — Metrics + Benchmarks

| Metric                       | Captured                                                                                  | Benchmark                             | Surface                |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------- |
| Estimation accuracy p50/p95  | `task_queue.estimation_error_pct` across completed tasks                                  | p50 abs error < 20%, p95 < 50%        | `/api/harness/metrics` |
| Calibration drift            | Rolling 7-day avg of `estimation_error_pct`; target trending toward 0                     | Within ±10% avg after 50 tasks        | morning_digest         |
| Cycle-over-cycle improvement | `avg_error` this calibration cycle vs previous cycle                                      | Improving each cycle until ±10% floor | morning_digest         |
| Budget utilization           | `used_minutes / budget_minutes` per session                                               | Target: 70–95%                        | morning_digest         |
| Self-generated work ratio    | % tasks where `metadata.task_type_label` IN ('improvement_proposal','doc_gap','test_gap') | Baseline: first 10 sessions           | morning_digest         |
| Escalation isolation success | % sessions with escalation where subsequent tasks still completed                         | Target: >90%                          | morning_digest         |
| Throughput per session       | `completed_count / used_minutes` (tasks/minute)                                           | Baseline: first 10 sessions           | morning_digest         |

---

## 11. F20 — Design System Enforcement

No new TSX UI for this feature (Telegram-only interface). F20 does not apply.
If a status dashboard page is added later, apply F20 at that point.

---

## 12. Attribution

Record attribution for every budget session open and close:

```typescript
void recordAttribution(
  { actor_type: 'colin', actor_id: 'telegram' },
  { type: 'work_budget_sessions', id: session_id },
  'budget_session_opened',
  { budget_minutes, source: 'telegram' }
)

void recordAttribution(
  { actor_type: 'system', actor_id: 'harness' },
  { type: 'work_budget_sessions', id: session_id },
  'budget_session_closed',
  { used_minutes, completed_count, close_reason: 'drained' | 'stopped' | 'overrun' }
)
```

---

## 13. Tests

| Test                                                                  | What it verifies                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `work-budget.test.ts` — parser: valid formats                         | `2h`, `90m`, `2h30m` → correct minutes                                            |
| `work-budget.test.ts` — parser: invalid formats                       | `0m`, `9h` (over cap), `abc` → rejected                                           |
| `work-budget.test.ts` — state machine: open session                   | Inserts `work_budget_sessions` row, status=active                                 |
| `work-budget.test.ts` — state machine: duplicate open                 | Rejects if active session exists                                                  |
| `work-budget.test.ts` — estimator: heuristic buckets                  | "fix config" → XS, "port + study doc + migration" → L                             |
| `work-budget.test.ts` — estimator: Ollama fallback                    | Ollama unreachable → heuristic point estimate                                     |
| `work-budget.test.ts` — budget check: can claim                       | used=50, total=120, estimate=45 → true                                            |
| `work-budget.test.ts` — budget check: exhausted                       | used=110, total=120, estimate=45 → false                                          |
| `work-budget.test.ts` — overrun: in-flight completes                  | Task running when budget exhausted → allowed to finish                            |
| `work-budget.test.ts` — escalation isolation                          | awaiting_review task skipped, next task claimed                                   |
| `work-budget.test.ts` — drain: Telegram summary sent                  | Session drains → outbound_notifications row inserted                              |
| `work-budget.test.ts` — self-generated: doc gaps                      | grep finds TODO → task_queue row inserted                                         |
| `work-budget.test.ts` — self-generated: test gaps                     | git log cross-ref → test gap task inserted                                        |
| `work-budget.test.ts` — calibration: completion writes actual_minutes | Task completes → actual_minutes + estimation_error_pct written to task_queue      |
| `work-budget.test.ts` — calibration: agent_events row on completion   | estimation.complete event has estimated, actual, error_pct, bucket, keywords_hit  |
| `work-budget.test.ts` — calibration: weight adjustment fires          | 5 tasks with consistent undershoot on keyword 'migration' → weight raised by 5min |
| `work-budget.test.ts` — calibration: weight adjustment bounded        | Adjustment capped at ±20% of current weight even when avg_error is large          |
| `work-budget.test.ts` — calibration: no adjustment below threshold    | avg_error < 15% → no weight change                                                |

All tests use mocks. No real Telegram API, Ollama, or git calls.

---

## 14. Acceptance Criteria

- [ ] Migration 0027: `work_budget_sessions`, `work_budget_keyword_weights`, `task_queue.estimated_minutes`, `task_queue.actual_minutes`, `task_queue.estimation_error_pct`
- [ ] `/budget Xh` text command parsed in `app/api/telegram/webhook/route.ts`
- [ ] `/budget stop` and `/budget status` commands handled
- [ ] `work_budget_sessions` state machine: active/drained/stopped transitions
- [ ] `lib/work-budget/estimator.ts`: heuristic buckets + Ollama XL refinement + fallback
- [ ] `estimated_minutes` written to task_queue on claim
- [ ] `lib/work-budget/tracker.ts`: budget check before claim, used_minutes update on complete
- [ ] Pickup-runner.ts: budget-aware claim (skip if no active session; check budget if active)
- [ ] Self-generated work pipeline: improvement proposals → doc gaps (5 cap) → test gaps (3 cap) → halt
- [ ] Escalation isolation: `awaiting_review` tasks skipped in budget mode, Telegram notification sent
- [ ] Overrun: soft stop (in-flight task completes, no new claims after budget exhausted)
- [ ] Budget close summary: Telegram message with counts + pending escalations
- [ ] F17: every budget event logged to `agent_events`
- [ ] Calibration loop: `actual_minutes` + `estimation_error_pct` written on task completion
- [ ] Calibration loop: `agent_events` row logged per completion (estimation.complete)
- [ ] Calibration loop: `calibrator.ts` adjusts keyword weights after every 10 completions; ±20% bound enforced
- [ ] Calibration loop: `work_budget_keyword_weights` table seeded; estimator reads from it at runtime
- [ ] F18: estimation accuracy p50/p95, calibration drift, cycle-over-cycle improvement queryable
- [ ] Attribution: session open + close recorded
- [ ] All 18 tests pass
- [ ] No inline `style=` in any new TSX (F20 — N/A here, but assert clean)

---

## 15. New Files / Changed Files

| File                                       | Change                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `supabase/migrations/0027_work_budget.sql` | New migration                                                                             |
| `lib/work-budget/estimator.ts`             | New: heuristic + Ollama XL estimator                                                      |
| `lib/work-budget/tracker.ts`               | New: budget session state + claim check                                                   |
| `lib/work-budget/parser.ts`                | New: `/budget` text command regex + state dispatch                                        |
| `lib/work-budget/index.ts`                 | New: re-export                                                                            |
| `app/api/telegram/webhook/route.ts`        | Add text command dispatch before purpose-review text handler                              |
| `lib/harness/pickup-runner.ts`             | Add budget check in claim loop; write actual_minutes + estimation_error_pct on completion |
| `lib/work-budget/calibrator.ts`            | New: weight adjustment loop (run-after-10 + weekly cron hook)                             |
| `app/api/cron/budget-calibrate/route.ts`   | New: weekly cron endpoint calling calibrator                                              |
| `tests/work-budget.test.ts`                | New: 18 tests                                                                             |

---

## 16. Downstream Impact

The budget-aware claim in `pickup-runner.ts` wraps the existing claim path. When
no active budget session exists, behavior is identical to today. When a session is
active, a pre-claim check gates new work. Zero risk to existing task scheduling
when `/budget` has not been invoked.

Tier 1 batch (`diag_coverage.py`, `utils/__init__.py`) is unblocked once this
acceptance doc is approved and the task is built — those tasks do not depend on
budget mode to run, but the task_queue row (3eaba964) at priority=1 will be claimed
first, blocking the batch if not built. Builder should build and complete 3eaba964
before the Tier 1 batch coordinator picks up.
