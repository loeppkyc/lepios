# Acceptance Doc — Notification Drain Routing Fix

**Feature:** `notification-drain-routing`
**Sprint:** 5
**Date:** 2026-04-25
**Status:** awaiting-colin-approval
**Task:** 7c73784d-ca3a-4e27-b1b9-25fa9cc7746a
**Study doc:** docs/sprint-5/notification-drain-routing-study.md
**Bug surfaced on:** fdf5a51e-28ca-4584-88f2-e922046ee276 (purpose-review-correctness)

---

## 1. Scope

Fix two correctness bugs in coordinator Telegram notification routing, and add F18
measurement instrumentation:

- **F1** — Add `/api/harness/notifications-drain` to `vercel.json` cron schedule
  (daily fallback: `0 * * * *`) so messages are never stuck indefinitely if the
  coordinator's manual drain trigger fails.
- **F2** — Handle duplicate coordinator-format callbacks gracefully: when Colin
  double-taps an approve/reject button and the `outbound_notifications` row is
  already `response_received`, return 200 silently without logging a
  `telegram_callback warning` with `agent_event_id=null`.
- **F3** — Add latency instrumentation to the drain and webhook: log
  `notification_sent` (with `drain_latency_ms`) and `notification_response_received`
  (with `total_approval_latency_ms`) in `agent_events` so the F18 target
  (`approval_to_builder_latency_p95 < 60s`) is measurable.

**Acceptance criterion:** After build, Colin can trigger the drain manually, confirm
it delivers pending messages, double-tap a coordinator approval button with no spurious
warning log, and query `agent_events` to see `drain_latency_ms` and
`total_approval_latency_ms` values.

---

## 2. Out of scope

- Sub-minute drain cron (requires Vercel Pro — deferred until plan decision; daily fallback is v1)
- Changing coordinator polling interval or 30-minute timeout window
- Any schema migration (no new columns or tables)
- Retry policy changes in the drain
- Any other callback format (purpose_review, tf thumbs, deploy gate) — only coordinator
  JSON format callbacks are affected

---

## 3. Files expected to change

| File | Change |
| ---- | ------ |
| `vercel.json` | F1: add cron entry for `/api/harness/notifications-drain` at `0 * * * *` (hourly; Hobby-plan safe). Note: if Colin upgrades to Pro, change to `* * * * *`. |
| `app/api/harness/notifications-drain/route.ts` | F3: log `agent_events` row per successful send with `drain_latency_ms` |
| `app/api/telegram/webhook/route.ts` | F2: extend `findMatchingRow` with Strategy A' for already-processed rows; update dispatch block to silently return on `__already_processed__` sentinel |
| `tests/api/telegram-webhook.test.ts` | F2: add test case for double-tap scenario — coordinator-format callback when row is `response_received` returns 200 without warning log |

No migrations. No new files. No UI changes.

---

## 4. Check-Before-Build findings

- **`vercel.json`** — 9 cron entries; no entry for `notifications-drain`. **Build new entry.**
- **`notifications-drain/route.ts`** — drain loop sends messages but logs no per-message
  latency in `agent_events`. **Beef up.**
- **`app/api/telegram/webhook/route.ts`** — `findMatchingRow` only checks `status='sent'`
  in Strategy A. No graceful path for already-processed coordinator callbacks. **Beef up.**
- **`tests/api/telegram-webhook.test.ts`** — no test covering coordinator JSON callback format.
  **Add new test.**

---

## 5. External deps tested

None. All changes internal TypeScript. No new API calls.

---

## 6. Precise implementation notes

### F1 — vercel.json cron entry

Add to `crons` array in `vercel.json`:

```json
{
  "path": "/api/harness/notifications-drain",
  "schedule": "0 * * * *"
}
```

Note for builder: hourly (`0 * * * *`) is within Hobby plan limits and provides a safety
net if the coordinator's manual trigger fails. After Colin upgrades to Pro, this can be
changed to `* * * * *` (every minute) for p95 < 60s guarantee.

### F2 — `findMatchingRow` Strategy A' + dispatch silent return

In `findMatchingRow` in `app/api/telegram/webhook/route.ts`, after Strategy A fails
(no `sent` row found), add Strategy A':

```typescript
// A': coordinator-format callback for already-processed row (double-tap / stale re-send)
// Return sentinel to allow graceful no-op without logging a warning.
if (rawCallbackData) {
  try {
    const parsed2 = JSON.parse(rawCallbackData) as Record<string, unknown>
    if (typeof parsed2.correlation_id === 'string') {
      const { data: alreadyDone } = await db
        .from('outbound_notifications')
        .select('id')
        .eq('correlation_id', parsed2.correlation_id)
        .eq('requires_response', true)
        .eq('status', 'response_received')
        .maybeSingle()
      if (alreadyDone) return '__already_processed__'
    }
  } catch {
    // not JSON — fall through
  }
}
```

Update `findMatchingRow` return type to `Promise<string | null>` (unchanged — `'__already_processed__'`
is a valid non-null string).

In the dispatch block (after `matchedId = await findMatchingRow(...)`):

```typescript
if (matchedId === '__already_processed__') {
  // Coordinator-format double-tap: row already response_received — graceful no-op
  return NextResponse.json({ ok: true })
}
```

This must come BEFORE the existing `if (matchedId) { ... }` block.

### F3 — drain latency instrumentation

In `notifications-drain/route.ts`, in the successful send path (after `status: 'sent'` update),
add `agent_events` insert:

```typescript
const drainLatencyMs = new Date().getTime() - new Date(row.created_at).getTime()
// Note: PendingRow type needs created_at added
await db.from('agent_events').insert({
  domain: 'orchestrator',
  action: 'notification_sent',
  actor: 'notifications_drain',
  status: 'success',
  task_type: 'notification_drain',
  output_summary: `notification ${row.id.slice(0, 8)} sent after ${drainLatencyMs}ms`,
  meta: {
    notification_id: row.id,
    correlation_id: row.correlation_id,
    drain_latency_ms: drainLatencyMs,
    requires_response: row.requires_response,
    message_id: result.messageId ?? null,
  },
  tags: ['notifications', 'harness', 'f18'],
}).catch(() => {}) // logging failure is non-fatal
```

`PendingRow` type update: add `created_at: string` and `correlation_id: string | null`
and `requires_response: boolean` to the interface; update the `select` query to include
these fields.

In `app/api/telegram/webhook/route.ts`, after the successful `response_received` update
(in the `if (matchedId) { ... }` block), add:

```typescript
// F18 instrumentation: log total approval latency
try {
  const { data: notifRow } = await db
    .from('outbound_notifications')
    .select('created_at, correlation_id')
    .eq('id', matchedId)
    .maybeSingle()
  if (notifRow) {
    const totalMs = new Date().getTime() - new Date(notifRow.created_at).getTime()
    await db.from('agent_events').insert({
      domain: 'orchestrator',
      action: 'notification_response_received',
      actor: 'telegram_webhook',
      status: 'success',
      task_type: 'notification_drain',
      output_summary: `notification ${matchedId.slice(0, 8)} response received after ${totalMs}ms`,
      meta: {
        notification_id: matchedId,
        correlation_id: notifRow.correlation_id,
        total_approval_latency_ms: totalMs,
      },
      tags: ['notifications', 'harness', 'f18'],
    })
  }
} catch {
  // swallow — do not block response_received update
}
```

---

## 7. Grounding checkpoint

**Scenario 1 — Drain delivery:** Colin inserts a test notification row (or the next
coordinator run sends one naturally). Colin verifies the notification arrives within
the next drain run (hourly at worst, manually triggerable via cron-secret POST to
`/api/harness/notifications-drain`).

**Scenario 2 — Double-tap no-op:** Colin taps an approve button on any coordinator
message twice within 30 seconds. Queries `agent_events` for `action='telegram_callback'`
and `status='warning'` in the past 5 minutes — confirms no new row.

**Scenario 3 — F18 measurement:** Colin queries:
```sql
SELECT meta->>'drain_latency_ms' AS drain_ms,
       meta->>'total_approval_latency_ms' AS total_ms
FROM agent_events
WHERE action IN ('notification_sent', 'notification_response_received')
  AND occurred_at > NOW() - INTERVAL '24 hours'
ORDER BY occurred_at DESC LIMIT 10;
```
Expects rows with numeric values (not null).

"Tests pass" is NOT a grounding checkpoint per Principle 14. All three scenarios
require real behaviour.

---

## 8. Kill signals

- `vercel.json` cron entry causes a Vercel deployment error → back off to manual trigger only
- `__already_processed__` sentinel causes TypeScript error → rename to a UUID sentinel value
  (e.g., `'already_processed'`) to avoid confusion with production UUIDs
- Drain F3 instrumentation causes drain to fail on db insert → the `catch(() => {})` prevents
  this, but verify drain still delivers messages in test

---

## 9. Cached-principle decisions

Cache-match is **disabled** sprint-wide (`cache_match_enabled: false`,
`cache_match_reason: "Sprint 4 baseline"`). This acceptance doc requires Colin's explicit
approval before going to builder.

---

## 10. Open questions (pending Colin answers)

These twin questions were unanswerable (twin endpoint unreachable):

1. **Vercel plan** — Is an upgrade to Pro planned? If yes, change F1 cron from
   hourly to every-minute after upgrade. If no, hourly is the v1 safety net.
   **Coordinator default: hourly (conservative, doesn't require plan change).**

2. **Double-tap UX** — Should the second button tap edit the Telegram message to say
   "already recorded" (visible feedback), or just silently return 200? 
   **Coordinator default: silent no-op (less noise).**

3. **F18 surface** — Should `approval_to_builder_latency_p95` be surfaced in a dashboard
   tile, or is a SQL query sufficient for now?
   **Coordinator default: SQL-queryable only (v1); dashboard in Sprint 6+.**

Colin: if you have no objection to the defaults above, just approve. If any default
needs to change, note it in your rejection.

---

## 11. F18 measurement definition

| Metric | Definition | Target | Where logged |
| ------ | ---------- | ------ | ------------ |
| `drain_latency_ms` | `sent_at - created_at` for an `outbound_notifications` row | p95 < 60,000 (60s) with Pro plan; p95 < 3,600,000 (1h) with Hobby hourly cron | `agent_events.action='notification_sent'` |
| `total_approval_latency_ms` | `response_received_at - created_at` | p95 < 60s after Pro + human reaction time | `agent_events.action='notification_response_received'` |

Benchmark: Pro plan 1-minute cron + average 15s human tap = ~75s end-to-end.
With hourly cron + 15s tap = worst case ~3,615s. Manual trigger + 15s tap = ~30s.
v1 target: Colin taps approve within 30 min of message appearing → latency dominated
by drain delivery, not human response.
