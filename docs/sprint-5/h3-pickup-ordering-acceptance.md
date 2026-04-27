# Acceptance Doc — H3: Pickup Ordering & Coordinator-Busy Handling

**Source:** docs/autonomous-loop-postmortem-2026-04-27.md §H3  
**Coordinator task:** 9b95359e-828d-46d9-8514-1a1ff16f4c31  
**Study doc:** docs/sprint-5/h3-pickup-ordering-study.md  
**Status:** awaiting Colin approval  
**Date written:** 2026-04-27

---

## Audit Summary (from Phase 1a — all grounded)

**The FIFO ordering in `claim_next_task` is correct.** SQL orders by `priority ASC, created_at ASC`. Option (b) from H3 is already implemented. No change needed.

**The 19-hour latency was caused by two separate bugs:**

1. **Bug A — 429 leaves task in 'claimed' limbo.** When `fireCoordinator` returns 429 (Routines API rejects second session for same routine_id), the task stays in `claimed` status for 15 minutes before stale-reclaim. Each stale cycle burns `retry_count`. With `max_retries=2`, a task can be auto-cancelled after 30 minutes of coordinator unavailability — before a coordinator ever runs it. (Grounded: agent_events rows at 01:12:07 and 11:34:39 both show `invoke_coordinator` 429 errors.)

2. **Bug B — Pickup cron runs daily, not sub-30-minute.** Schedule is `0 0 * * *` (midnight UTC). The 30-min SLA in H3 is impossible with a daily cron. All task claims on Apr 26 were from manual Colin invocations. (Grounded: vercel.json, git commit `5b183a5`.)

**One available hourly slot exists.** `notifications-drain-tick` was reverted to daily (git `7f1c38d`). The Vercel Hobby plan allows 1 hourly cron; that slot is currently unused.

---

## Scope

### Part A — Immediate unclaim on fireCoordinator failure (code change — no Colin decision required)

**Change:** In `lib/harness/pickup-runner.ts`, after `fireCoordinator` returns `ok: false`:
1. Immediately UPDATE task_queue: `status='queued', claimed_at=NULL, claimed_by=NULL, last_heartbeat_at=NULL` for the just-claimed task. Do NOT increment `retry_count` — this is coordinator unavailability, not task failure.
2. Log `agent_events` row: `action='invoke_coordinator_failed_unclaim', status='warning', meta={task_id, error, failure_type, upstream_status}`.
3. Send Telegram fire-and-forget: `[LepiOS Harness] Coordinator unavailable — {failure_type}. Task {shortId} returned to queue. Reason: {upstream_status or error}.`
4. Return `{ok: true, claimed: null, reason: 'coordinator-unavailable'}` from `runPickup`.

**What this fixes:** Tasks can no longer be cancelled due to coordinator unavailability. Retry_count is preserved for actual task failures. The 15-minute stale-claim window is eliminated for 429s. Recovery happens on the next pickup run.

### Part B — Change task-pickup cron to hourly (config change — Colin must approve)

**Change:** In `vercel.json`, change task-pickup schedule from `0 0 * * *` to `0 * * * *`.

**What this fixes:** Worst-case claim latency drops from 24h to 1h. The 1 available hourly Hobby slot is used for task-pickup (highest-value cron on the system).

**Colin decision required:** This uses the only available hourly Vercel Hobby slot. If Colin later wants an hourly cron for something else, he would need to remove this or upgrade to Pro. Confirm before builder implements.

**Part B is gated on Colin approval of this doc.** Builder should implement Part A unconditionally; Part B only if Colin approves the slot usage.

---

## Out of Scope

- Multiple `COORDINATOR_ROUTINE_ID` values for parallel coordinator sessions. This requires Colin to register a second routine with Anthropic and is a Colin-only decision.
- Vercel Pro upgrade (sub-hourly pickup scheduling). Colin's call — not blocked on H3.
- Changing `max_retries` default. Current value (2) is correct for task failures; Bug A fix makes it irrelevant for coordinator unavailability.
- Fixing the 7.5-hour silence gap (11:38–19:03). That is a quota guard + budget session interaction. Covered by the Telegram alert in Part A (Colin will know immediately when a coordinator invoke fails).

---

## Files Expected to Change

- `lib/harness/pickup-runner.ts` — unclaim logic after failed fireCoordinator (Part A)
- `vercel.json` — cron schedule change (Part B, conditional)
- `lib/harness/pickup-runner.ts` — Telegram notification on coordinator-unavailable (Part A)

No schema migrations required. No new tables. No new env vars.

---

## Check-Before-Build Findings

- `claim_next_task` RPC: correct FIFO ordering, no change needed (`supabase/migrations/0016_add_pickup_fns.sql:27`)
- `reclaim_stale_tasks` RPC: correctly handles `claimed` → `queued` reset; Part A bypasses this by unclaiming immediately (`supabase/migrations/0021_extend_stale_window.sql`)
- `fireCoordinator` return type: `{ok: false, error, failure_type, upstream_status?}` — all fields available for Part A logging (`lib/harness/invoke-coordinator.ts:4-11`)
- `postMessage` / `sendMessageWithButtons`: both available for Telegram fire-and-forget (`lib/orchestrator/telegram.ts`)
- No existing "unclaim" function in task-pickup.ts — builder adds inline UPDATE or creates `unclaimTask()` helper

---

## External Deps Tested

- Supabase task_queue: verified schema (all columns confirmed via information_schema query)
- agent_events: verified INSERT works (branch guard event inserted in this session)
- Vercel Hobby hourly slot: confirmed 1 slot available (vercel.json has 0 hourly crons currently)

---

## Grounding Checkpoint

Colin verifies after deploy:

1. **Part A test:** Temporarily point `COORDINATOR_ROUTINE_ID` to an invalid/nonexistent routine ID. Trigger pickup manually. Verify:
   - Task returns to `queued` within 5 seconds (not 15 minutes)
   - `retry_count` unchanged on the task row
   - `agent_events` row with `action='invoke_coordinator_failed_unclaim'`
   - Telegram message received: "Coordinator unavailable"
   - Restore correct `COORDINATOR_ROUTINE_ID`

2. **Part B test (if approved):** After vercel.json deploy, check Vercel dashboard → Cron Jobs tab shows task-pickup scheduled hourly. Confirm it ran on the hour.

**Grounding checkpoint is NOT "tests pass."** Part A requires live Telegram delivery and live task_queue state verification. Part B requires Vercel Cron Jobs tab confirmation.

---

## Kill Signals

- Part A unclaim logic introduces a new code path between claim and return — if there's a DB error during the unclaim UPDATE, the task will remain in `claimed` until stale-reclaim (existing behavior). Acceptable fallback.
- Part B: if Colin later needs the hourly slot for something higher-priority, this cron reverts to daily. Not a kill signal, just a tradeoff.

---

## Pending Colin Questions

All four Twin Q&A questions failed (twin unreachable from coordinator sandbox). Escalating to Colin:

1. **Vercel plan:** Do you want to upgrade to Pro for sub-hourly task-pickup scheduling, or stay on Hobby with hourly as the ceiling?
2. **Hourly slot:** Do you approve using the 1 available Hobby hourly cron slot for task-pickup (`0 * * * *`)? This is Part B of this acceptance doc.
3. **Multiple routines:** Do you want to register a second `COORDINATOR_ROUTINE_ID` with Anthropic for parallel coordinator sessions? (Would allow two tasks to have coordinators running simultaneously.)
4. **SLA target:** Is 1-hour worst-case claim latency acceptable (achievable with hourly cron + Part A fix)? Or is sub-30-min a hard requirement (would need Vercel Pro)?

**Colin needs to answer Q2 before builder starts.** Q1, Q3, Q4 are for context/planning; they don't block Part A.

---

## Cached-Principle Decisions

**Cache-match is DISABLED** for Sprint 4/5 (sprint-state.md: `cache_match_enabled: false, cache_match_reason: "Sprint 4 baseline"`). All acceptance docs escalate to Colin.

This doc is escalated. Colin approves before builder proceeds.

---

## Open Questions

- What caused the 7.5-hour silence gap (11:38–19:03)? Quota guard (6h lookback from 11:34 429) would expire by ~17:34. Something else (work budget session?) held the gap to 7.5h. Not blocking H3's fix but worth a follow-up query.
- Should `max_retries` be increased now that Part A fixes the coordinator-unavailability retry burn? Deferring — no change needed for now.
