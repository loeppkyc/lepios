# Sprint 5 — stall-alert Acceptance Doc

**Status:** Colin-approved (callback `2026-04-25T23:21:57Z`, task `40b1aa4b-c969-4d94-93f7-49ce29f3fc26`)
**Recovery note:** Original file not committed to disk. Reconstructed from coordinator result + Colin's explicit spec in session handoff. Content matches the approved design.

---

## Scope

Add harness stuck-state detection to the existing task-pickup cron, plus a summary line in
morning_digest. When the harness stalls, Colin gets a Telegram alert describing what's stuck,
why, and what to do.

**Acceptance criterion:** With a synthetically stuck task in the queue (status=`running`,
`last_heartbeat_at` > 30min ago), the next task-pickup cron run produces an
`outbound_notifications` row with `status='sent'` and text describing the stuck task —
and a second run within 24h does NOT produce a duplicate alert.

---

## Stall triggers

Five distinct conditions. T1–T3 and T5 fire real-time Telegram alerts from pickup-runner.
T4 is morning_digest only.

| ID  | Condition                                                            | Detection query                                                                                                        |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| T1  | Coordinator stuck on same task >30 min, no heartbeat                 | `task_queue WHERE status='running' AND last_heartbeat_at < now() - interval '30 minutes'`                              |
| T2  | Active budget session, no task completed in 30 min                   | `work_budget_sessions WHERE status='active'` + check `task_queue.completed_at` window                                  |
| T3  | Task stale in queue — `queued AND retry_count=0 AND created_at > 8h` | `task_queue WHERE status='queued' AND retry_count=0 AND created_at < now() - interval '8 hours'`                       |
| T4  | Tasks blocked on awaiting_review >24h                                | Morning-digest summary only — `task_queue WHERE status='awaiting_review' AND created_at < now() - interval '24 hours'` |
| T5  | Pickup cron missed >2 expected runs (>48h gap)                       | `agent_events WHERE action='task_pickup' ORDER BY occurred_at DESC LIMIT 1` — if most recent > 48h ago                 |

---

## Integration: pickup-runner primary + morning_digest summary line

### pickup-runner (`app/api/cron/task-pickup/route.ts`, cron 00:00 UTC)

Call a new `runStallCheck()` function **before** the task-claim logic. Checks T1, T2, T3, T5.
Fires Telegram alerts for each failing condition that passes the 24h dedup check.
If no task is available to claim, the cron still runs the stall check before returning 200.

Hobby plan note: cron fires once per day (midnight UTC). T1/T2 are "30 min" thresholds but
detection is daily — acceptable for v1. Hobbyplan upgrade path: extract to a separate
`/api/cron/stall-check` route if Pro-plan sub-hour crons are enabled later.

### morning_digest (`app/api/cron/morning-digest/route.ts`, cron 06:00 UTC)

Add a summary line near the top of the daily Telegram message:

```
⚠️ {count} stalled — {comma-separated task descriptions}
```

Omit the line entirely if count = 0. Sources: T3 tasks + T4 tasks (both queries run fresh).

---

## Deduplication: 24h window

Before firing any real-time alert (T1, T2, T3, T5) for a given trigger + correlation:

```sql
SELECT id FROM agent_events
WHERE action = 'stall_alert_sent'
  AND meta->>'trigger' = $1      -- 'T1' | 'T2' | 'T3' | 'T5'
  AND meta->>'correlation_id' = $2  -- task_id or session_id
  AND occurred_at > now() - interval '24 hours'
LIMIT 1
```

If a row exists → skip alert. If none → fire and log `stall_alert_sent` event.

Morning-digest T3/T4 summary line is NOT deduped — it always reflects current state.

---

## Alert message format

```
⚠️ [LepiOS Harness] {trigger label}
Stuck: {description}
Since: {human duration, e.g. "47 min"}
Action: {suggested action}
```

Suggested actions per trigger:

| Trigger | Suggested action text                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| T1      | `Reset task: UPDATE task_queue SET status='queued', claimed_at=null, last_heartbeat_at=null WHERE id='{id}'` |
| T2      | Budget session will expire naturally — or send /stop to budget bot                                           |
| T3      | `Cancel or reprioritize: UPDATE task_queue SET status='cancelled' WHERE id='{id}'`                           |
| T5      | Check Vercel cron logs — cron may be paused or misconfigured                                                 |

---

## F18 metric

Log an `agent_events` row for each alert fired:

```json
{
  "action": "stall_alert_sent",
  "domain": "orchestrator",
  "actor": "stall-check",
  "status": "success",
  "meta": {
    "trigger": "T1|T2|T3|T5",
    "correlation_id": "<task_id or session_id>",
    "stuck_since": "<ISO timestamp>",
    "alert_latency_ms": <ms from stuck_since to now>
  }
}
```

**Benchmark:** alert-to-resolution latency p50 < 24h, p95 < 48h.
Revisit after 30 days of `stall_alert_sent` data.
Surface path: `SELECT meta->>'trigger', percentile_cont(0.5) WITHIN GROUP (ORDER BY (meta->>'alert_latency_ms')::int) FROM agent_events WHERE action='stall_alert_sent' GROUP BY 1`.

---

## Files expected to change

| File                                   | Action                                                       |
| -------------------------------------- | ------------------------------------------------------------ |
| `lib/harness/stall-check.ts`           | Create new — detection queries + alert helpers + dedup logic |
| `app/api/cron/task-pickup/route.ts`    | Update — call `runStallCheck()` before claim logic           |
| `app/api/cron/morning-digest/route.ts` | Update — add T3/T4 summary line                              |

No migrations. No new tables. Uses existing `task_queue`, `work_budget_sessions`,
`agent_events`, `outbound_notifications`.

---

## Check-Before-Build findings

- `task_queue.last_heartbeat_at`: **confirmed exists** (schema verified via `information_schema.columns` 2026-04-26)
- `work_budget_sessions` table: builder must verify schema before coding T2
- `app/api/cron/morning-digest/route.ts`: builder must verify file path exists before editing
- `app/api/cron/task-pickup/route.ts`: builder must verify entry point before editing
- `outbound_notifications` insert pattern: follow existing pattern in `notifications-drain/route.ts`

---

## Grounding checkpoint

Colin verifies after deploy:

1. Synthetic stuck task:
   ```sql
   UPDATE task_queue SET last_heartbeat_at = now() - interval '35 minutes'
   WHERE status = 'running' LIMIT 1
   ```
2. Trigger pickup:
   ```
   curl -s GET https://lepios-one.vercel.app/api/cron/task-pickup \
     -H "Authorization: Bearer {CRON_SECRET}"
   ```
3. Confirm alert inserted:
   ```sql
   SELECT id, status, payload->>'text' as text
   FROM outbound_notifications ORDER BY created_at DESC LIMIT 3
   ```
   → New row with T1 alert text.
4. Confirm dedup event logged:
   ```sql
   SELECT meta FROM agent_events WHERE action='stall_alert_sent'
   ORDER BY occurred_at DESC LIMIT 1
   ```
   → Correct trigger + correlation_id.
5. Confirm dedup fires: trigger pickup again immediately → no second notification row.

---

## Out of scope

- Sub-minute cron scheduling (Hobby plan; daily pickup is the v1 cadence)
- Auto-recovery actions (alerts only — Colin resolves manually)
- UI for viewing stall history
- Alerting on task completion rate trends (deferred to Tier 2)

---

## Kill signals

- If stall check adds >2s to task-pickup route → extract to dedicated `/api/cron/stall-check`
- If T3 fires on intentionally-parked low-priority tasks (noise) → add `priority >= 2` filter

---

## Cached-principle decisions

`cache_match_enabled: false` for Sprint 5 (explicit override).

**Colin approved this chunk** via task_queue callback `2026-04-25T23:21:57Z`. Direct Colin
ratification — not a cache-match proceed.

Principles cited:

- Principle 17 (no speculative infrastructure): no new tables; uses existing schema ✓
- Principle 18 (F18 measurement): `stall_alert_sent` events + p50/p95 benchmark defined ✓
- Principle 19 (no inline styles): lib function + cron routes only, no UI ✓

---

## Open questions

None.

- Q1 (integration point): pickup-runner primary + morning_digest summary line — **Colin approved**
- Q2 (dedup window): 24h — **Colin confirmed**
