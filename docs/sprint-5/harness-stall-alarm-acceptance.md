# Acceptance Doc — Harness Stall Alarm
**Feature:** `checkHarnessStall` — detects stalled `task_queue` rows and alerts Colin
**Date:** 2026-04-25
**Status:** awaiting Colin approval (cache_match_enabled: false)
**task_queue id:** 40b1aa4b-c969-4d94-93f7-49ce29f3fc26
**Greenfield:** yes — no Streamlit predecessor

---

## 1. Scope

**One sentence:** Add a `checkHarnessStall` night_tick check that detects task_queue rows stuck in `queued` (T3) or `awaiting_review` (T4) past their expected processing window, logs stall events to `agent_events`, and fires an immediate Telegram alert for T3.

**One acceptance criterion:** After deploy, a T3 task (queued, retry_count=0, created_at > 8h ago) produces (a) an `agent_events` row with `domain='harness_stall'`, `action='stall_alarm.t3'`, and (b) an `outbound_notifications` row for Telegram delivery within the next night_tick run.

---

## 2. Out of Scope

- **T5 tier** — no confirmed definition; deferred until first 30 days of T3/T4 data surfaces a pattern
- **Real-time polling** — stall check runs at night_tick cadence (02:00 MT), not continuously
- **Auto-remediation** — alarm only; no automated re-queue or escalation beyond Telegram
- **Task-pickup-100 dependency** — the 8h T3 threshold is valid at hourly pickup cadence; at current daily cadence it will also fire on tasks queued after the last daily run (acceptable — a 4+ year-old queued task that survived a pickup is still worth flagging)
- **Pickup-aware detection** (created_at < last_successful_pickup_at) — cleaner signal, deferred to a follow-on; hardcoded age-based detection is sufficient for v1

---

## 3. Stall Tiers

### T3 — Pickup stall (infrastructure signal)

```sql
SELECT id, task, created_at, retry_count
FROM task_queue
WHERE status = 'queued'
  AND retry_count = 0
  AND created_at < NOW() - INTERVAL '8 hours'
```

- **Threshold:** 8h — per Colin's purpose_notes (2026-04-25)
- **Interpretation:** Task was never picked up. With hourly pickup (task-pickup-100): 8 missed cycles = broken. With current daily pickup: task survived at least one daily run unclaimed = stall or intentional hold.
- **Alert path:** Immediate `outbound_notifications` insert (fire-and-forget, `requires_response: false`). Does NOT wait for morning_digest.
- **Message format:**
  ```
  ⚠️ Harness stall (T3): {count} task(s) queued > 8h, never claimed
  Oldest: {id[:8]} — "{task[:60]}" — {age_hours}h old
  Check task_queue for head-of-line blocking or broken pickup cron.
  ```

### T4 — Review stall (Colin backlog signal)

```sql
SELECT id, task, created_at, last_heartbeat_at
FROM task_queue
WHERE status = 'awaiting_review'
  AND COALESCE(last_heartbeat_at, created_at) < NOW() - INTERVAL '24 hours'
```

- **Threshold:** 24h — early warning before 72h auto-timeout fires
- **Interpretation:** Colin hasn't responded to a Telegram purpose review inline keyboard for 24h.
- **Alert path:** night_tick flag only (`severity: 'warn'`) — surfaces in morning_digest, no separate immediate Telegram. Colin sees it in the next morning digest.
- **Dependency:** `awaiting_review` status requires migration 0026 — **confirmed applied to production** (version 20260425140031).

---

## 4. Architecture

### New file: `lib/orchestrator/checks/harness-stall.ts`

Exports `checkHarnessStall(): Promise<CheckResult>` following the existing `CheckResult` interface (`lib/orchestrator/types.ts`).

Responsibility:
1. Run T3 SQL query
2. If T3 count > 0: insert `outbound_notifications` row (fire-and-forget, never throws), log `agent_events` row per stalled task
3. Run T4 SQL query
4. If T4 count > 0: push `warn` flags to CheckResult
5. Return `CheckResult` with name `'harness_stall'`, status `'pass'` / `'warn'`, flags array, counts (`{ t3_stalled, t4_stalled }`)

### Modified: `lib/orchestrator/tick.ts`

Add `checkHarnessStall` as the 4th check in `runNightTick()`:

```typescript
checks.push(await safeCheck('harness_stall', checkHarnessStall))
```

No other changes to tick.ts. The 15s `CHECK_TIMEOUT_MS` applies.

### Modified: `lib/orchestrator/digest.ts`

`formatHarnessStall(check: CheckResult)` — adds one line to the morning_digest Telegram message for `check.name === 'harness_stall'`:

```
⚠️ Harness stall: {t3} T3 + {t4} T4 tasks stuck
```

Or if both zero, no line (silence is healthy).

---

## 5. F17 — Behavioral Ingestion Signal

Every stall event is a coordinator-behavior signal for the path probability engine.

Log to `agent_events` per stalled task (not per check run):

| Field | Value |
|---|---|
| domain | `'harness_stall'` |
| action | `'stall_alarm.t3'` or `'stall_alarm.t4'` |
| actor | `'system'` |
| status | `'warning'` |
| meta | `{ task_id, task_preview: task[:80], age_hours, tier: 'T3'|'T4', retry_count }` |
| task_type | `'night_tick'` |

If a task stalls repeatedly across multiple night_tick runs, this is logged each run — giving the path engine a frequency signal on chronic stalls.

---

## 6. F18 — Metrics + Benchmark

**Primary metric:** `alert_to_resolution_latency_p50_p95`

Derived by joining:
- `agent_events` where `action = 'stall_alarm.t3' OR 'stall_alarm.t4'` → alert timestamp
- `task_queue` where `status IN ('running','completed','cancelled')` → resolution timestamp (use `completed_at` or `last_heartbeat_at` as proxy)

Surface via:
```sql
SELECT
  meta->>'tier' AS tier,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY resolution_lag_hours) AS p50_h,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY resolution_lag_hours) AS p95_h
FROM (
  SELECT
    ae.meta->>'tier' AS tier,
    EXTRACT(EPOCH FROM (
      tq.completed_at - ae.occurred_at
    ))/3600 AS resolution_lag_hours
  FROM agent_events ae
  JOIN task_queue tq ON tq.id::text = ae.meta->>'task_id'
  WHERE ae.action IN ('stall_alarm.t3','stall_alarm.t4')
    AND tq.completed_at IS NOT NULL
) sub
GROUP BY tier;
```

**Benchmark:** No prior baseline. First 30 days = baseline. Target after 60 days: p50 < 24h (one day to resolve), p95 < 72h (before auto-timeout fires).

**Surface path:** `/api/harness/metrics` or morning_digest weekly rollup. Colin asks "how is harness stall resolution doing?" → run query above.

---

## 7. Files Expected to Change

| File | Change |
|---|---|
| `lib/orchestrator/checks/harness-stall.ts` | **new** — T3/T4 detection logic |
| `lib/orchestrator/tick.ts` | +1 line: add `checkHarnessStall` to checks |
| `lib/orchestrator/digest.ts` | +format section for `harness_stall` check in digest message |
| `tests/orchestrator/harness-stall.test.ts` | **new** — unit tests (see §8) |

No migrations required. No env var changes required. No schema changes required.

---

## 8. Check-Before-Build Findings

- `lib/orchestrator/checks/`: three existing checks (site-health, scan-integrity, event-log-consistency). Pattern is reusable verbatim. ✓ Beef-up.
- `outbound_notifications` insert pattern: established in `lib/ollama/client.ts:73` and `lib/harness/improvement-engine.ts:749`. Use same fire-and-forget wrapper. ✓ Reuse.
- `agent_events` logging: existing pattern throughout codebase. ✓ Reuse.
- No stall detection logic exists anywhere in the codebase. ✓ Build-new (within existing check framework).

---

## 9. Tests

| Test | Assertion |
|---|---|
| T3: no stalled tasks → pass | `checkHarnessStall()` returns `{status:'pass', counts:{t3_stalled:0,t4_stalled:0}}` |
| T3: 1 stalled task → warn + alert | `status:'warn'`, `counts.t3_stalled=1`, outbound_notifications insert called once |
| T3: task with retry_count=1 NOT flagged | count=0 even if created_at > 8h (retry_count=0 filter) |
| T4: awaiting_review < 24h → not flagged | count=0 |
| T4: awaiting_review > 24h → warn flag | `counts.t4_stalled=1`, flag in result, no outbound_notifications insert |
| DB error → CheckResult fail | Returns `{status:'fail', flags:[{severity:'critical'}]}`, no throw |
| safeCheck timeout → fail | Existing tick timeout wrapper handles; check itself must not hang |

All tests use mocked Supabase client. No live DB calls.

---

## 10. Grounding Checkpoint

**What Colin will verify:** The morning after deploy, run:

```sql
-- Healthy baseline (no stalls): expect 0 rows
SELECT id, meta FROM agent_events
WHERE domain = 'harness_stall'
ORDER BY occurred_at DESC
LIMIT 10;

-- night_tick check ran: expect harness_stall in the checks array
SELECT meta->'checks' FROM agent_events
WHERE task_type = 'night_tick'
ORDER BY occurred_at DESC LIMIT 1;
```

If queue is healthy (no T3/T4 tasks): expect `harness_stall` in checks with `status:'pass'`.
If a stall existed: expect `agent_events` stall_alarm rows + Telegram message received.

Either outcome passes grounding. Failure condition: `harness_stall` absent from night_tick checks entirely (wiring bug).

---

## 11. Kill Signals

- T3 fires every night because Colin intentionally holds tasks in `queued` for review → tune threshold up to 26h, or add a `metadata.no_stall_alarm` bypass flag
- night_tick duration exceeds 60s with 4 checks → stall check may need separate cron; monitor `duration_ms` in first week

---

## 12. Cached-Principle Decisions

cache_match_enabled: false (Sprint 4/5 baseline override). No cache-match applied. Escalating to Colin for approval per Phase 0 rule 4.

---

## 13. Open Questions

All open questions resolved at acceptance doc time:

| Q | Question | Resolution |
|---|---|---|
| Q1 | T3 threshold — age-based, confirmed? | **Resolved:** Colin specified "Use 8h. T3 definition: queued AND retry_count=0 AND created_at > 8h ago" in purpose_notes. |
| Q2 | T4 requires migration 0026 | **Resolved:** migration 0026 (`task_queue_review_statuses`) confirmed applied to prod (version 20260425140031). T4 enabled. |
| Q3 | Cron placement: new cron vs integrate into night_tick | **Resolved:** Integrate into night_tick. Same observability path, no new vercel.json entry, consistent with existing check pattern. |
| Q4 | T5 threshold: dynamic vs hardcoded | **Resolved:** T5 deferred entirely. T3 and T4 thresholds hardcoded (8h, 24h). Revisit if false alarm rate > 0 after 30 days. |
| Q5 | F18 resolution definition | **Resolved:** Resolution = task moves to `completed` or `cancelled` (completed_at IS NOT NULL). p50/p95 latency from stall alert to that transition. |
