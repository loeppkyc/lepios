# Work-Budget Mode — Phase 1 Study

**Date:** 2026-04-25
**Status:** complete — feeds work-budget-acceptance.md

---

## Phase 1a — Infrastructure Study

### 1. Coordinator Scheduling + Claim Loop

Task pickup runs via `GET /api/cron/task-pickup`. The route calls `reclaimStale()`
then `claimNextTask()` — both in `lib/harness/pickup-runner.ts` (lines 91-126,
claim logic downstream). The SQL claim uses `FOR UPDATE SKIP LOCKED` via the
`claim_next_task(p_run_id)` RPC: `status=queued → claimed` atomically, ordered by
`priority ASC, created_at ASC` (index `task_queue_pickup_idx`).

Coordinator heartbeat: every ~3 minutes to `/api/harness/task-heartbeat`. Stale
window: 15 minutes. Stale reclaim: any `claimed/running` task with
`COALESCE(last_heartbeat_at, claimed_at) < NOW() - 10 minutes` re-queues or
cancels (pickup-runner.ts:91-126).

Coordinator receives task instructions as plain text in `task_queue.task`.
Additional context in `task_queue.metadata` JSONB (chunk_id, sprint_id, source_ref).

**Source:** `.claude/agents/coordinator.md:6-43`, `lib/harness/pickup-runner.ts:91-126`.

### 2. Existing Task Estimation

None exists. `task_queue` schema (migration 0015) has no `estimated_minutes`,
`estimated_hours`, `complexity`, or `size` column. `agent_events` has no cost
or time estimate fields. `cost-log.md` is manually appended markdown:

```
{timestamp} coordinator sprint={N} chunk={id} phase={1-6}
tokens_in={N} tokens_out={N} escalated={bool} auto_proceeded={bool}
```

14 entries from 2026-04-19 to 2026-04-24. Tokens range: 2,000–85,000 input;
500–12,000 output. Duration is implicit from timestamps; no `duration_ms` in
cost-log entries. `streamlit_modules.suggested_chunks` has `estimated_lines`
(migration 0023, line 21) for Streamlit module cataloging only — not used in
task scheduling.

**Source:** `supabase/migrations/0015_add_task_queue.sql:12-51`,
`docs/handoffs/cost-log.md:1-20`, `supabase/migrations/0023_add_streamlit_modules.sql:21`.

### 3. Dependency Tracking

`streamlit_modules.deps_in TEXT[]` and `deps_out TEXT[]` exist (migration 0023,
lines 19-20) but are NOT used in task-pickup scheduling. `task_queue` has no
dependencies column. Task claim is greedy: priority ASC, created_at ASC. No
dependency-aware ordering exists anywhere in the harness.

**Source:** `supabase/migrations/0023_add_streamlit_modules.sql:19-20`,
`lib/harness/pickup-runner.ts` (no dependency logic found).

### 4. 20% Better Engine (self-generated work source)

Exists as production code in `lib/harness/improvement-engine.ts` (888 lines, 7
components). Triggered by `/api/harness/notifications-drain` after task completion.

Pipeline:

1. **Trigger** — detects completed task_queue rows
2. **Analyzer** — reads audit trail, counts escalations/failures/ollama_failures
3. **Proposer** — generates proposals in 9 categories (process, code_pattern,
   test_coverage, doc_gap, tooling, twin_corpus_gap, security, reliability)
4. **Deduplicator** — fingerprints proposals; increments recurrence_count on match;
   escalates severity (nice_to_have → meaningful → blocking)
5. **Queuer** — inserts into task_queue with
   `metadata.task_type_label='improvement_proposal'`
6. **Auto-Proceed Gate** — auto-approves if category ∈ {tooling, code_pattern,
   test_coverage}, severity=nice_to_have, reversible, tests pass, approval_count≥3
7. **Notifier** — one Telegram message per chunk with bulk action buttons

Improvement proposals land in task_queue as normal rows (status=queued, priority
typically 5). Budget mode can claim them in the same pickup loop — no special
integration needed beyond ordering.

**Source:** `lib/harness/improvement-engine.ts:1-888`,
`docs/sprint-5/20-percent-better-engine-acceptance.md`.

### 5. Telegram Command Parsing

`app/api/telegram/webhook/route.ts` handles `message` and `callback_query`
update types. All current actions are inline keyboard callbacks:

| Callback prefix                                                 | Handler             |
| --------------------------------------------------------------- | ------------------- |
| `tf:up:` / `tf:dn:`                                             | Thumbs feedback     |
| `dg:rb:` / `dg:promote:` / `dg:abort:`                          | Deploy gate         |
| `improve_approve_all:` / `improve_review:` / `improve_dismiss:` | Improvement engine  |
| `purpose_review:`                                               | Purpose review gate |

**No text command handlers exist** (`/pickup`, `/budget`, `/btw` — none). The
webhook processes `update.message?.text` but no handler checks for `/`-prefixed
commands yet. Adding `/budget` requires a new branch in the message handler,
before the existing purpose-review text reply correlation.

**Source:** `app/api/telegram/webhook/route.ts:975-1090`.

### 6. Budget / Cost Tracking

Cost is doc-only. No token or duration tracking in DB. `attribution` table
(migration 0020) has `actor_type, actor_id, run_id` — no cost fields.
`outbound_notifications` (migration 0017) has no cost or duration fields.

Current duration observable from: `created_at` → `completed_at` on task_queue
rows (both timestamps exist, migration 0015).

**Source:** `docs/handoffs/cost-log.md:1-20`, `supabase/migrations/0020_add_attribution.sql`,
`supabase/migrations/0017_add_outbound_notifications.sql`.

---

## Phase 1b — Twin Q&A

All 5 questions answered from corpus. No escalation to Colin required.

### Q1: Estimator type

**Answer: heuristic-first; Ollama ANALYSIS on XL tasks only.**

Rationale: Cost-log data shows task durations range from ~10 min (simple config fix)
to ~3h (full Phase 1a-1d port chunk). A keyword-signal heuristic covers 80%+ of
cases cleanly — "migration" +10min, "tests" +15min, "study doc" +20min,
"acceptance doc" +25min. Ollama adds latency (30-60s for ANALYSIS call) and is
error-prone on ambiguous tasks. Reserve Ollama for XL bucket (>180min estimate)
where heuristic uncertainty is highest and the cost of miscalibration matters most.
Calibration input: actual `completed_at - claimed_at` duration from task_queue
rows feeds accuracy F18 metric over time.

### Q2: Budget command surface

**Answer: Telegram text command only in v1. `/budget 2h30m` or `/budget 90m`.
Cap: 8h. Units: h and m. No CLI, no API route.**

Rationale: No text command infrastructure exists today — adding Telegram text
parsing is the minimal viable surface. Harness is Telegram-first. API/CLI routes
would require new auth scaffolding (n=0 existing text command precedents to extend).
1d/1w budgets are out of scope: autonomous work at that scale needs a different
safety model (not v1). 8h cap matches a full working day; anything longer should
be a separate sprint decision. Granular format (`2h30m`, `90m`, `2h`) accepted
via regex.

### Q3: Self-generated work priority order

**Answer: improvement proposals → doc gaps → test gaps → halt+notify Colin.**

Rationale: Improvement proposals are already in task_queue (queued by the 20%
Better engine), so they require no generation step — lowest friction. Doc gaps
and test gaps require on-the-fly generation (Ollama scan or grep). Audits excluded
from auto-work: expensive, ambiguous scope, should be Colin-initiated. When queue
reaches true empty after all three tiers, halt and send Colin a Telegram summary
("Budget window open: queue fully drained. N tasks completed. Send /budget Xh to
continue.").

### Q4: Escalation isolation

**Answer: (a) immediately move to next task; tag escalation for Colin.**

Rationale: Budget mode is throughput maximization in a time window. Waiting N
minutes for a Colin reply defeats the purpose — Colin may be away for hours. The
coordinator already supports graceful exit on escalation: writes escalation to
`task_queue.metadata.pending_colin_qs`, sets `status='awaiting_review'`, exits.
The `awaiting_review` status (added in migration 0026) is precisely the right
state. Pickup cron picks the next task. Colin resolves escalations async. When
the budget window closes, Colin sees a Telegram summary with all pending
escalations.

### Q5: Budget overrun handling

**Answer: soft — complete in-flight task, then hard stop. No grace percentage.**

Rationale: Hard-stopping mid-task leaves work in partial state (study doc
half-written, acceptance doc missing). The in-flight task's remaining time is
bounded (coordinator completes one phase at a time, max 15 min per phase before
heartbeat timeout). The "grace" is implicit: finish current task only. The
budget tracker checks remaining budget before claiming each new task, so overrun
is at most one task's worth of time.

---

## Phase 1c — Pending Colin Qs Consolidated

No new escalations from this study. All 5 Phase 1b questions answered from corpus.

Pre-existing pending questions from other streams (not blocked by this spec):

- `twin/ask` route domain filter fix (task dc61f6ca) — non-blocking
- Deterministic reply correlation (task fdf5a51e) — non-blocking
- `actor_type='colin'` enum (task 9d7f2af7) — non-blocking

---

## Phase 1c — 20% Better Improvements

Compared to a hypothetical "just check budget after every claim":

1. **Heuristic estimator with calibration loop** — estimation accuracy becomes a
   learning signal (F18). Over 50+ tasks, p50 error converges. No Streamlit
   equivalent.

2. **Self-generated work pipeline** — when queue empties, harness keeps working
   productively (improvement proposals, doc gaps, test gaps). Colin doesn't need
   to queue the next task to keep the budget window filled.

3. **Escalation isolation** — a single pending question never pauses the entire
   budget window. Throughput per window is not bottlenecked by Colin's response
   latency. Direct improvement over synchronous back-and-forth.

4. **Soft overrun + in-flight completion** — cleaner than hard stop (no partial
   work artifacts) and honest (budget report shows actual vs. estimated time per
   task).

5. **F17 integration** — each `/budget Xh` + task selection = a high-signal
   utterance about Colin's priorities. Which work categories Colin repeatedly
   budgets → path probability engine training signal.

6. **Budget utilization metric (F18)** — exposes whether harness task estimates
   are calibrated or consistently over/underestimated. Actionable: if utilization
   is consistently <60%, estimates are too conservative; if consistently >110%,
   they're too aggressive.

---

## Grounding Manifest

| Claim                                                 | Evidence              | File:line                                                |
| ----------------------------------------------------- | --------------------- | -------------------------------------------------------- |
| task_queue schema (no estimated_minutes)              | migration 0015        | supabase/migrations/0015_add_task_queue.sql:12-51        |
| Pickup logic + stale reclaim                          | pickup-runner.ts      | lib/harness/pickup-runner.ts:91-126                      |
| Heartbeat cadence + stale window                      | coordinator.md        | .claude/agents/coordinator.md:22-42                      |
| cost-log.md format + 14 entries                       | cost-log.md           | docs/handoffs/cost-log.md:1-20                           |
| 20% Better engine: 7 components + task_type_label     | improvement-engine.ts | lib/harness/improvement-engine.ts:1-888                  |
| Telegram: all actions are callbacks, no text commands | webhook/route.ts      | app/api/telegram/webhook/route.ts:975-1090               |
| awaiting_review status available                      | migration 0026        | supabase/migrations/0026_task_queue_review_statuses.sql  |
| deps_in/deps_out in streamlit_modules                 | migration 0023        | supabase/migrations/0023_add_streamlit_modules.sql:19-20 |
| No dependency column in task_queue                    | migration 0015        | supabase/migrations/0015_add_task_queue.sql:12-51        |
