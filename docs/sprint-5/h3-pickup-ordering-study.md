# H3 Study — Pickup Ordering: FIFO Guarantee within Priority Tier

**Coordinator task:** 9b95359e-828d-46d9-8514-1a1ff16f4c31  
**Source postmortem:** docs/autonomous-loop-postmortem-2026-04-27.md  
**Date written:** 2026-04-27

---

## What It Does

The `task_pickup` cron (`/api/cron/task-pickup`) claims one queued task per run and fires a coordinator session via the Anthropic Routines API. The claim is atomic via PostgreSQL RPC `claim_next_task`. Tasks are ordered by `priority ASC, created_at ASC` — lowest priority number first, then oldest creation time (FIFO within priority).

The postmortem observed that task `915d1fee` (priority=2, created 2026-04-26 00:02 UTC) sat unclaimed for 19 hours while other tasks were serviced. H3's mandate: audit why, verify or fix FIFO ordering, achieve a 30-min claim SLA for unblocked priority-2 tasks.

---

## How It Does It — Code Path

**Claim SQL** (`supabase/migrations/0016_add_pickup_fns.sql:18–33`):
```sql
UPDATE public.task_queue
SET status = 'claimed', claimed_at = NOW(), claimed_by = p_run_id
WHERE id = (
  SELECT id FROM public.task_queue
  WHERE status = 'queued'
  ORDER BY priority ASC, created_at ASC
  LIMIT 1 FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

**Pickup runner** (`lib/harness/pickup-runner.ts:88–385`):
1. `reclaimStale()` — reset tasks where `COALESCE(last_heartbeat_at, claimed_at) < NOW() - 15min`
2. Budget session check — if active session is exhausted → return `budget-exhausted`, no claim
3. Quota guard (`lib/harness/quota-guard.ts`) — if 429 from Routines API within last 6h → return `quota-guard`, no claim
4. `claimTask(runId)` — atomically claims top-priority task
5. `fireCoordinator({task_id, run_id})` — calls `POST /v1/claude_code/routines/{COORDINATOR_ROUTINE_ID}/fire`
6. On success: Telegram notification, return `{ok: true, claimed: task}`
7. **On fireCoordinator failure (429 or other error):** task remains in `claimed` status with no coordinator running

---

## Domain Rules Embedded (grounded)

1. **FIFO within priority tier is correct.** `claim_next_task` orders `priority ASC, created_at ASC`. This is the right ordering.
2. **One task claimed per cron run.** No batching, no parallel claims.
3. **Stale-reclaim window: 15 minutes.** Tasks without heartbeats are returned to queue after 15 min (migration 0021).
4. **max_retries=2.** A task can be stale-reclaimed twice before being cancelled.
5. **Quota guard: 6-hour lookback.** After a 429, quota guard blocks ALL pickup for up to 6h (or until retry-after expires).
6. **Cron schedule: `0 0 * * *`.** Task pickup runs ONCE per day at midnight UTC (vercel.json). Manual/automated triggers call the endpoint during the day.

---

## Audit Findings (grounded)

### Finding 1: FIFO ordering is correct — NOT the root cause

All tasks claimed before 915d1fee were created BEFORE it:
- `40b1aa4b` — created Apr 25 16:53 (created before 915d1fee ✓)
- `c622d367` — created Apr 25 19:54 (created before 915d1fee ✓)
- `8cba5a75` — created Apr 25 19:54 (created before 915d1fee ✓)

915d1fee was created Apr 26 00:02 — correctly last in FIFO order among this cohort.

**Postmortem's FIFO hypothesis (option b) is ruled out.** The SQL ordering is correct.

### Finding 2: 429 serialization is the confirmed bottleneck

From `agent_events` (grounded, queried directly):

| Time (UTC) | Event |
|---|---|
| 2026-04-26 01:11:36 | `task_pickup` warning (stall check) + success (claim) |
| 2026-04-26 01:11:37 | `invoke_coordinator` **SUCCESS** → c622d367 coordinator fired |
| 2026-04-26 01:12:07 | `task_pickup` success (8cba5a75 claimed) → `invoke_coordinator` **ERROR 429** |
| 2026-04-26 11:34:39 | `task_pickup` success (8cba5a75 re-claimed after stale) → `invoke_coordinator` **ERROR 429** |
| 2026-04-26 11:38:27 | `invoke_coordinator` **ERROR 429** (standalone attempt) |
| 2026-04-26 19:03:03 | `task_pickup` success (915d1fee claimed) → `invoke_coordinator` SUCCESS ✅ |

**At 01:12:** c622d367's coordinator session was fired 1 second earlier (01:11:37). The Routines API enforces **one active session per routine_id**. When pickup immediately claimed 8cba5a75 and attempted to fire another coordinator, it got 429.

**At 11:34 and 11:38:** Two more 429s. The coordinator for some session was still active.

**7.5-hour gap (11:38–19:03):** Quota guard (6h lookback) blocked pickups after 11:34 429. Likely also a budget session exhaustion. System was dark for 7.5 hours — Colin had no Telegram signal this was happening.

### Finding 3: 429 leaves task in 'claimed' limbo — burns retry_count

When `invoke_coordinator` returns 429, the pickup runner exits with the task in `claimed` status and no coordinator running. After 15 minutes, `reclaimStale()` resets it to `queued` with `retry_count++`. With `max_retries=2`, a task can survive only 2 such cycles before being cancelled.

`40b1aa4b` and `c622d367` both show `retry_count=1` — they were stale-reclaimed once before successful claim. The system is burning retry slots on coordinator unavailability.

### Finding 4: Once-daily cron prevents any SLA guarantee

Current schedule: `0 0 * * *` (midnight UTC daily). The 30-min SLA from H3 is unachievable with a once-daily cron. All claims during April 26 were from **manual endpoint invocations** by Colin. The git history confirms the cron was reverted from hourly (`5b183a5`) because Vercel Hobby allows only 1 hourly cron and notifications-drain-tick was already using that slot (later also reverted). Current vercel.json has 12 daily crons and 0 hourly crons — there is now capacity for 1 hourly cron.

---

## Edge Cases (grounded in code)

1. **429 + max_retries=2:** A task claimed during a 429 window burns retry_count each stale cycle. After 2 burns → cancelled. Tasks can be cancelled before a coordinator ever runs.
2. **Quota guard = silent block:** When guard is active, `claimTask()` is never called — task stays queued safely. But Colin receives no Telegram notification that pickup is blocked. The guard operates silently.
3. **Budget session exhaustion:** If `canClaimNextTask` returns false, pickup drains and stops for the session. Colin knows via drain-summary Telegram but not specifically that pickup is paused.
4. **SKIP LOCKED concurrency:** If two pickup cron runs execute simultaneously (possible), only one wins the claim. The other returns `null` gracefully. Not a bug.

---

## Fragile or Improvable Points

1. **No immediate unclaim on 429.** When fireCoordinator fails, the task should be immediately returned to `queued` (not left in `claimed` for 15 min of wasted stale window). This would preserve retry_count and speed up recovery.
2. **No Telegram alert on pickup blocked.** Quota guard and budget exhaustion are silent. Colin has no mobile signal that pickup is paused for hours.
3. **Cron frequency is the SLA blocker.** Once-daily prevents any sub-24h SLA guarantee. The fix is Vercel Pro (allows up to 1-minute crons) or changing the 1 available hourly slot to task-pickup.
4. **No diagnostic endpoint.** Colin cannot query "why was my task waiting 19 hours?" without reading raw agent_events. There's no `/api/harness/queue-diagnostics` endpoint.

---

## 20% Better (Phase 1c)

| Category | Streamlit analog | Improvement for H3 |
|---|---|---|
| Correctness | n/a (no Streamlit equivalent) | Fix 429-→-unclaim logic: when fireCoordinator returns ok:false, immediately unclaim task (zero retry_count burn on coordinator unavailability) |
| Performance | n/a | Change task-pickup cron from daily to hourly (1 hourly slot is now available). Reduces worst-case claim latency from 24h to 1h at zero code cost |
| UX | n/a | Telegram alert when quota guard blocks ≥1 consecutive pickup: "Coordinator unavailable — 429 active, retry in N min. Task {id} waiting." Colin knows what's blocking on mobile |
| Observability | n/a | Log `pickup_skipped_coordinator_busy` event when 429 fires so morning digest can surface "N pickups blocked by Routines API yesterday" |
| Data model | n/a | Add `blocked_reason` to task_pickup agent_events meta so historical analysis is trivial |

**Proposed improvements to carry forward to acceptance doc:**
- P1 (high impact): Immediate unclaim on fireCoordinator failure (any error, not just 429) — zero retry_count burn, task returns to front of queue within seconds rather than 15 min
- P2 (high impact): Hourly cron (use available slot) — SLA drops from 24h to ≤1h worst case
- P3 (medium impact): Telegram alert when consecutive pickup blocked — Colin knows when to intervene

**Improvement 20% math:**
- Current worst-case claim latency: 24h (daily cron) + up to 6h quota guard = 30h
- Improved worst-case: 1h (hourly cron) + 15-min unclaim fix + quota-guard Telegram alert
- Improvement: ~30× faster worst case. Well beyond 20% better.

---

## Twin Q&A (Phase 1b)

Batch questions flagged during Phase 1a:

1. Has Colin expressed a preference on Vercel plan (stay on Hobby vs. upgrade to Pro)?
2. Does Colin want task-pickup to run hourly (uses the 1 available hourly slot)?
3. Has Colin approved using multiple COORDINATOR_ROUTINE_IDs for parallel sessions?
4. What is Colin's tolerance for task queue latency — is 1h acceptable or does he want sub-30min?
