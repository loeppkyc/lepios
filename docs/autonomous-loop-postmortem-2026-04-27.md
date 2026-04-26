# Post-Mortem: First Proven Autonomous Loop — Task 915d1fee

**Date written:** 2026-04-27  
**Task:** Fix Telegram callback_data BUTTON_DATA_INVALID  
**Task ID:** 915d1fee-18bd-4718-bde5-8a6956a72084  
**Session:** session_01Rorvswq1K3FakNz2P5xXFA  
**Coordinator commit:** 9f0bc4d (branch: harness/task-915d1fee-18bd-4718-bde5-8a6956a72084)

---

## What This Was

First confirmed end-to-end autonomous loop in production:

```
task_queue (queued) → task_pickup_cron (claimed) → invoke_coordinator (remote trigger)
  → coordinator session (6 min) → acceptance doc + builder task queued → task completed
```

No Colin touch between claim and completion. This is the proof-of-concept that the harness claim → invoke → complete chain works.

**Note:** The user said "19:03 UTC 2026-04-27" but DB timestamps show 2026-04-26. All timestamps below are UTC as recorded in Supabase. Colin was likely writing from April 27 local time about April 26 UTC events.

---

## Timeline (UTC)

| Time (UTC)          | Event                               | Detail                                                              |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| 2026-04-26 00:02:01 | Task created                        | Manual, priority=2, status=queued                                   |
| 2026-04-26 01:11:35 | Stall alert T3 fired                | Notification row created (cce1c002) — never delivered               |
| 2026-04-26 11:34:39 | Stall alert T3 re-fired             | 11h 32min stall. Second notification row — also never delivered     |
| 2026-04-26 11:34:39 | Task 8cba5a75 picked up instead     | queue_depth=23, 915d1fee skipped                                    |
| 2026-04-26 19:03:02 | **Task 915d1fee claimed**           | latency_ms=68,461,375 (~19h). queue_depth=21                        |
| 2026-04-26 19:03:03 | invoke_coordinator fired            | routine trig_01AC9K3asFWrHZpK7HrRBhak, session started              |
| 2026-04-26 19:03:59 | Last heartbeat                      | Only heartbeat in the entire 6-min session                          |
| 2026-04-26 19:06:53 | branch_guard_triggered              | `claude/vibrant-heisenberg-ZTuUH` → `harness/task-915d1fee-...`     |
| 2026-04-26 19:06:56 | heartbeat_skipped                   | Endpoint not in allowlist; no further heartbeats                    |
| 2026-04-26 19:09:03 | Task marked completed               | Builder task 6d4f2276 queued                                        |
| 2026-04-26 19:09:06 | Completion notification created     | id: 1579a94c — status=pending, 0 attempts                           |
| 2026-04-26 19:09:22 | drain_trigger_failed                | 403 returned. Notification deferred to next cron cycle. Never sent. |
| 2026-04-26 19:09:41 | Coordinator commit pushed           | 9f0bc4d on task branch                                              |
| 2026-04-26 19:27:52 | Colin thumbs-up'd task_pickup event | Manual Telegram interaction 18 min after completion                 |

**Active execution time:** 19:03 → 19:09 = **6 minutes**  
**Queue latency:** 00:02 → 19:03 = **19 hours 1 minute**

---

## What Worked

**1. Claim-to-invoke chain is proven**  
`task_pickup_cron` claimed the task autonomously and `invoke_coordinator` fired without any Colin input. This is the core harness loop working end-to-end for the first time.

**2. Branch guard held (S-L3)**  
Coordinator started on `claude/vibrant-heisenberg-ZTuUH` (random Claude Code default) and the branch guard caught it, switched to `harness/task-915d1fee-...`, and logged `branch_guard_triggered` to `agent_events`. The S-L3 pattern held.

**3. Pre-staged acceptance doc + defaults = zero review round-trip**  
The acceptance doc was pre-staged with defaults pre-approved (`review_action=approved`, `q_defaults_accepted=true`). Coordinator skipped the review loop entirely and went straight to phase 1d → 3 (delegate to builder). This is the correct fast path for well-understood tasks.

**4. Coordinator output was complete and structured**  
Result field contains: acceptance_doc path, builder_task_id, check-before-build audit (key files verified, no schema migration needed, callback family audit, coordinator.md inline keyboard note). Everything a builder needs to proceed.

**5. Branch isolation held**  
Coordinator commit landed on `harness/task-915d1fee-...` only. Main was not touched.

---

## Friction

**1. 19-hour queue latency**  
Task was created at 00:02 UTC and not claimed until 19:03 UTC — despite `task_pickup_cron` running throughout. Other tasks (40b1aa4b x3, 87bc8578, 7c73784d, c622d367 x2, 8cba5a75) were claimed during that window while 915d1fee sat. Queue depth held at 21–23 throughout, so the cron was running but consistently skipping 915d1fee. Most likely cause: ROUTINE_ID `trig_01AC9K3asFWrHZpK7HrRBhak` can only have one active session at a time — while a prior coordinator session was still claimed/stale, 915d1fee was blocked.

**2. Stall notifications never delivered**  
Two stall alert rows were created (01:11 and 11:34) with `status=pending, attempts=0, sent_at=null`. Both still undelivered at time of writing. Colin received no warning that the task was stuck. The stall detection system is working; the delivery pipeline is not.

**3. Completion notification also never delivered**  
The 19:09 completion notification (1579a94c) is `pending, 0 attempts, sent_at=null`. The drain fired immediately after task completion, returned 403, and deferred. Colin got no Telegram confirmation. He only knew it completed by watching the DB manually (evidenced by the 19:27 thumbs-up on the task_pickup event — 18 minutes after the task was done).

**4. Branch guard fires on every session**  
The branch guard is working correctly, but every coordinator session starts on the wrong branch and requires correction. This is a warning-level event on each run — not a failure, but wasted startup steps.

**5. Only one heartbeat in a 6-minute session**  
`last_heartbeat_at = 19:03:59` (57 seconds after claim). The coordinator attempted one heartbeat, got `endpoint_not_in_allowlist`, and sent no further heartbeats. The task completed in 6 minutes so the stale-reclaim window didn't expire — but the gap was 5 minutes. Any task >15 minutes with this behavior would be vulnerable.

---

## Fragility

**1. Drain 403 = all notifications silent**  
The notifications pipeline requires a working drain with the correct `CRON_SECRET`. The 403 suggests the coordinator is calling the drain endpoint without the correct auth header. This isn't a new bug — the stall alert from 01:11 was also never delivered, meaning drain has been broken since at least early morning. Every coordinator completion, every stall alert, every improvement suggestion is silently queued and not sent. Colin is flying blind on system events.

**2. Pickup serialization is a single-lane bottleneck**  
If one routine ID can only invoke one coordinator session at a time, the queue can only process tasks sequentially. With a queue depth of 21, tasks at the back can wait indefinitely. This is the most likely explanation for the 19-hour latency. The system has no parallelism at the coordinator level.

**3. Heartbeat allowlist gap**  
The heartbeat endpoint (`/api/harness/task-heartbeat`) is not in the coordinator's tool allowlist. Every coordinator session will have this gap. A 6-minute task escaped stale-reclaim by luck. A 20-minute task would be reclaimed at ~15 minutes (assuming a 10-15min stale window) mid-execution.

**4. No session log preservation**  
The coordinator's 6 minutes of work inside `session_01Rorvswq1K3FakNz2P5xXFA` are inaccessible. There is no step-by-step record of what the coordinator decided, what it read, what branches it considered, or what warnings it encountered. The only artifacts are the commit and the `result` field in `task_queue`. If a future coordinator session produces bad output, there is no audit trail to diagnose it.

**5. Branch guard is the only branch safety net**  
The guard caught the branch mismatch this time. If the guard is bypassed (e.g., if the coordinator writes a file before the guard check runs), the branch rule fails silently. There is no upstream enforcement — nothing prevents the session from starting on the wrong branch in the first place.

---

## Hardening Recommendations

### H1 — Fix drain 403 (delivery pipeline)

**Scope:** The notifications-drain endpoint is returning 403 when called from coordinator context. Diagnose whether this is a missing `CRON_SECRET` header in the coordinator's drain call, a wrong endpoint URL, or a Vercel auth policy. Fix the coordinator's drain invocation so pending notifications are delivered. Verify the two stuck notifications (cce1c002, 1579a94c) either drain or are explicitly superseded.  
**Weight:** 2  
**Acceptance:** A coordinator completion notification reaches Telegram within 60s of task completion.

### H2 — Heartbeat endpoint in coordinator allowlist

**Scope:** Add `POST /api/harness/task-heartbeat` to the coordinator's allowed tool calls. Verify the endpoint URL used in coordinator.md matches the production route. Confirm heartbeats fire every ~3 minutes during a coordinator session, not just once at startup.  
**Weight:** 1  
**Acceptance:** A 15-minute coordinator session shows ≥4 `heartbeat` events in `agent_events` with `status=success`.

### H3 — Pickup ordering: FIFO guarantee within priority tier

**Scope:** Audit why task 915d1fee (priority=2, created 00:02) sat 19h while lower-priority or equal-priority tasks were serviced. Check whether ROUTINE_ID serialization is the bottleneck (one active session at a time). If so, determine whether the fix is: (a) multiple routine slots, (b) FIFO enforcement within the pickup SELECT, or (c) a priority-weighted claim that deprioritizes in-flight tasks. Implement and verify.  
**Weight:** 3  
**Acceptance:** A priority=2 task with no blocking dependencies is claimed within 30 minutes of creation when the cron is running.

### H4 — Coordinator session summary to agent_events

**Scope:** At coordinator session end, write a summary event to `agent_events` containing: session_id, task_id, phases completed, files read, files written, warnings encountered (branch_guard, heartbeat_skipped, drain failures), and outcome. This makes every coordinator run auditable without accessing the claude.ai session URL.  
**Weight:** 2  
**Acceptance:** Querying `SELECT * FROM agent_events WHERE action = 'coordinator_session_summary' AND meta->>'task_id' = '...'` returns a complete decision log for the session.

### H5 — Branch pre-configuration on coordinator trigger

**Scope:** When `invoke_coordinator` fires, the session should start on or immediately switch to `harness/task-{id}` before any file access. Options: (a) include a startup instruction in the remote trigger payload that sets the branch before the coordinator prompt runs, (b) add a `git checkout -b harness/task-{id} 2>/dev/null || git checkout harness/task-{id}` as the first coordinator step before any Read/Write tool call, (c) configure the Claude Code session to start on a specific branch via trigger config. The branch guard remains as the catch layer, but this eliminates the "start wrong, correct" pattern that generates a warning on every run.  
**Weight:** 2  
**Acceptance:** Zero `branch_guard_triggered` events after the fix ships (guard still active, but never needs to fire).

---

## Summary

The claim → invoke → complete chain works. Six minutes, clean output, correct branch isolation, no Colin intervention required. The harness loop is real.

What's broken around it: the notification pipeline (drain 403 means Colin is blind to all system events), the pickup ordering (19-hour latency for a queued task is not acceptable), and the heartbeat gap (a single uncaught window makes longer sessions vulnerable to stale-reclaim). These are infrastructure failures, not harness-loop failures. The loop itself held.

The builder task (6d4f2276) for the actual BUTTON_DATA_INVALID fix is queued and waiting. The coordinator's work — acceptance doc + handoff — is the deliverable from this run.
