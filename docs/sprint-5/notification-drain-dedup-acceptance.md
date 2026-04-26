# notification-drain-dedup — Acceptance Doc

Sprint 5 · chunk: notification-drain-dedup
Coordinator task: c622d367-704d-4838-83bf-15a196c8c074
Colin approval: review_action=approved, review_received_at=2026-04-26T00:08:12Z

---

## Scope

Add three targeted improvements to the notification drain system:
1. UNIQUE partial constraint on `outbound_notifications.correlation_id` to prevent duplicate
   Telegram messages from parallel coordinator runs.
2. Daily safety-net drain cron in `vercel.json` (`0 1 * * *`) as fallback if coordinator
   self-trigger fails.
3. Log `delivery_latency_ms` to `agent_events` per successful Telegram send for F18
   observability (P95 < 30s benchmark target).

**Acceptance criterion:** After the migration is applied and code is deployed,
(a) inserting two rows with the same non-null `correlation_id` raises a unique-violation error,
(b) vercel.json contains the daily notifications-drain cron, and
(c) `agent_events` rows with `action='notification_delivered'` and `meta.delivery_latency_ms`
appear after a drain run that successfully sends at least one message.

---

## Out of scope

- Per-minute drain cron (Colin approved daily safety-net only; per-minute would require Vercel Pro plan cron limits review — defer to Sprint 6 if needed)
- Inbound webhook changes
- Response-polling latency (separate from send latency)
- Dedup window logic in application layer (DB-level UNIQUE constraint is Colin's approved approach)

---

## Files expected to change

| File | Change |
|------|--------|
| `supabase/migrations/0030_notification_drain_dedup.sql` | New migration: drop old correlation_id index, add UNIQUE partial index |
| `app/api/harness/notifications-drain/route.ts` | Add delivery latency logging to agent_events on successful send |
| `vercel.json` | Add daily notifications-drain cron entry |
| `tests/harness/notifications-drain.test.ts` | Add tests for latency logging; note: UNIQUE constraint testing is DB-level, covered by grounding checkpoint |

---

## Check-Before-Build findings

| Item | Status |
|------|--------|
| `correlation_id` column | EXISTS — TEXT, nullable, non-unique INDEX only |
| UNIQUE constraint on correlation_id | MISSING — needs migration 0030 |
| Drain cron in vercel.json | MISSING — no entry for `/api/harness/notifications-drain` |
| Delivery latency logging | MISSING — `sent_at` exists but latency vs. `created_at` never computed or stored |
| `agent_events` table | EXISTS — `action TEXT`, `meta JSONB`, `occurred_at TIMESTAMPTZ` |

---

## External deps tested

None. This chunk touches only internal Supabase schema, an existing Vercel cron config,
and an existing route. No new external API calls.

---

## Migration spec (0030)

```sql
-- Drop the existing non-unique partial index (it will be replaced by the unique one)
DROP INDEX IF EXISTS public.outbound_notifications_correlation_idx;

-- Create a UNIQUE partial index: prevents duplicate correlation_id values while
-- allowing unlimited NULL rows (coordinator fire-and-forget notifications)
CREATE UNIQUE INDEX outbound_notifications_correlation_uniq
  ON public.outbound_notifications (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Rollback:
--   DROP INDEX IF EXISTS public.outbound_notifications_correlation_uniq;
--   CREATE INDEX outbound_notifications_correlation_idx
--     ON public.outbound_notifications (correlation_id)
--     WHERE correlation_id IS NOT NULL;
```

---

## Route change spec (delivery latency logging)

In `route.ts`, after a successful `sendTelegram` call, insert an `agent_events` row:

```typescript
// After: await db.from('outbound_notifications').update({ status: 'sent', ... }).eq('id', row.id)
await db.from('agent_events').insert({
  action: 'notification_delivered',
  status: 'success',
  meta: {
    notification_id: row.id,
    correlation_id: row.correlation_id ?? null,
    delivery_latency_ms: Date.now() - new Date(row.created_at).getTime(),
    channel: row.channel,
  },
  occurred_at: new Date().toISOString(),
})
```

The drain `select` query must also fetch `created_at` and `correlation_id` fields (add them to the
`.select('id, channel, chat_id, payload, attempts')` call).

The `PendingRow` interface must be extended: `created_at: string; correlation_id: string | null`.

---

## vercel.json change spec

Add a daily safety-net cron for the notification drain:

```json
{
  "path": "/api/harness/notifications-drain",
  "schedule": "0 1 * * *"
}
```

Place after the `budget-calibrate` entry (maintaining alphabetic/functional grouping).

---

## F18 — Measurement

- **Metric captured:** `delivery_latency_ms` per notification in `agent_events` with `action='notification_delivered'`
- **Benchmark:** P95 < 30 seconds (Colin-defined `notification_delivery_latency_p95_target_30s`)
- **Surfacing query:**
  ```sql
  SELECT
    percentile_cont(0.95) WITHIN GROUP (ORDER BY (meta->>'delivery_latency_ms')::int) AS p95_ms,
    COUNT(*) AS total_sent,
    MAX((meta->>'delivery_latency_ms')::int) AS max_ms
  FROM agent_events
  WHERE action = 'notification_delivered'
    AND occurred_at > now() - interval '7 days';
  ```

---

## Grounding checkpoint

Colin verifies after migration + deploy:

1. **Dedup constraint:**
   ```sql
   -- Attempt duplicate insert; confirm unique-violation error:
   INSERT INTO outbound_notifications (channel, payload, correlation_id)
   VALUES ('telegram', '{"text":"test"}', 'test-corr-1');
   INSERT INTO outbound_notifications (channel, payload, correlation_id)
   VALUES ('telegram', '{"text":"test2"}', 'test-corr-1');
   -- Second insert must fail with unique_violation (23505)
   ```

2. **vercel.json cron:** Confirm `/api/harness/notifications-drain` appears in Vercel project's
   Cron Jobs tab after next deploy.

3. **Latency logging:**
   ```sql
   -- After triggering a manual drain run with one pending row:
   SELECT meta FROM agent_events
   WHERE action = 'notification_delivered'
   ORDER BY occurred_at DESC LIMIT 3;
   -- Expect: rows with meta.delivery_latency_ms > 0
   ```

---

## Kill signals

- If the UNIQUE constraint causes errors for legitimate multi-send coordinator flows
  (e.g., retry-after-failure with same correlation_id) → constraint design is wrong, revisit
- If `agent_events` insert in drain route causes meaningful latency increase → separate
  the logging into an `after()` background task

---

## Cached-principle decisions

None. cache_match_enabled = false (Sprint 4 baseline carry-forward). Colin approved directly.

---

## Open questions

None. All three questions answered by Colin via task_queue metadata (2026-04-26T00:08:12Z).
