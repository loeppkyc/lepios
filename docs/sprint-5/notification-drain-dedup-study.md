# notification-drain-dedup — Streamlit Study

> This feature has no Streamlit predecessor. This study covers the existing LepiOS
> notification drain implementation and the identified gaps. Phase 1a is applied to
> the LepiOS codebase itself (existing code = reference baseline).

---

## What it does

The `outbound_notifications` table plus the `/api/harness/notifications-drain` route
form the coordinator's messaging pipeline. Coordinator inserts rows; the drain route
delivers them to Telegram via `sendMessage`; the inbound webhook writes responses back
for `requires_response=true` flows. The coordinator polls the row by `id` until
`status='response_received'`.

## How it does it

**Schema** (`0017_add_outbound_notifications.sql`):
- `id UUID PK`, `channel TEXT`, `chat_id TEXT nullable`, `payload JSONB`, `correlation_id TEXT nullable`
- `requires_response BOOLEAN`, `response JSONB`, `status TEXT` (`pending|sent|failed|response_received`)
- `attempts INT DEFAULT 0`, `last_error TEXT`, `created_at TIMESTAMPTZ`, `sent_at TIMESTAMPTZ`
- Index `outbound_notifications_correlation_idx` on `(correlation_id)` WHERE NOT NULL — non-unique
- Index `outbound_notifications_drain_idx` on `(status, attempts, created_at ASC)` WHERE `status='pending'`

**Drain route** (`app/api/harness/notifications-drain/route.ts`):
- Auth: `Authorization: Bearer $CRON_SECRET`
- Fetches up to 20 `pending` rows with `attempts < 5`, oldest first
- Per row: resolves `chat_id` (row field or `TELEGRAM_CHAT_ID` env fallback)
- Calls `https://api.telegram.org/bot{TOKEN}/sendMessage` with row payload
- Success: UPDATE status=`sent`, `sent_at=now()`, merges `message_id` into payload (strategy B correlation)
- Failure (non-200): increments `attempts`; if attempts ≥ 5, sets `status='failed'`
- Side-effect: triggers improvement engine for recently-completed task_queue rows via `after()`

**No cron trigger exists.** The drain is only called when the coordinator explicitly POSTs to it
after inserting a notification row (Step 3 in coordinator.md). There is no Vercel cron covering the drain.

## Domain rules embedded

1. `correlation_id` links a notification to the task_queue row that created it (first 8 hex chars of task_id).
2. `requires_response=true` rows: coordinator polls until `status='response_received'`.
3. `message_id` from Telegram is merged into `payload` so inbound webhook can match replies by `reply_to_message.message_id`.
4. Fallback: if `chat_id` is null on the row, the drain uses `TELEGRAM_CHAT_ID` env var.
5. Exhaustion: 5 failed attempts → `status='failed'`; row is abandoned.

## Edge cases

- Parallel coordinator runs could insert two rows with the same `correlation_id` (same task_id),
  causing duplicate Telegram messages to Colin. Nothing in the schema prevents this.
- If the drain curl in Step 3 (coordinator.md) fails silently, the pending row will never be
  delivered — no recovery path exists because there is no cron fallback.
- Delivery latency from row creation to `sent_at` is not captured anywhere; no way to audit
  whether Colin was notified within acceptable time (30-second target).

## Fragile or improvable points

1. **No deduplication**: `correlation_id` is indexed but not UNIQUE. A coordinator bug, retry,
   or parallel claim can insert duplicate notifications silently.
2. **No drain cron**: the drain is self-triggered only. A coordinator crash mid-Step-3 leaves
   a pending row stranded forever.
3. **No delivery latency observability**: `sent_at` exists but latency vs. `created_at` is never
   computed or surfaced. F18 benchmark (P95 < 30 seconds) cannot be verified.

---

## Twin Q&A

Twin endpoint was unreachable (host not in allowlist). All questions escalated to Colin.

```
Q: Should we add a UNIQUE partial constraint on correlation_id to prevent duplicate notifications?
A: YES — UNIQUE constraint on correlation_id
Confidence: direct Colin answer

Q: Should we add a daily safety-net drain cron to vercel.json as a fallback?
A: YES — daily drain cron in vercel.json as safety net
Confidence: direct Colin answer

Q: Should we log delivery_latency_ms to agent_events per successful send for F18 observability?
A: YES — log delivery_latency_ms to agent_events per send
Confidence: direct Colin answer
```

---

## 20% Better

| Category      | Streamlit/Current gap                         | Proposed improvement                                         | Status    |
|---------------|-----------------------------------------------|--------------------------------------------------------------|-----------|
| Correctness   | Duplicate notifications possible on parallel  | UNIQUE partial index on correlation_id (WHERE NOT NULL)      | Approved  |
|               | coordinator claims                            | → DB rejects duplicates at insert                            |           |
| Performance   | No cron fallback; stranded rows never retry   | Daily safety-net cron at `/api/harness/notifications-drain`  | Approved  |
| Observability | Delivery latency unmeasured; F18 unverifiable | Log `delivery_latency_ms` to agent_events per successful     | Approved  |
|               |                                               | send; enables P95 query                                      |           |

F18 benchmark: `notification_delivery_latency_p95_target_30s` (Colin-defined).

---

## Pending Colin Questions

All answered via task_queue metadata at 2026-04-26T00:08:12Z:
- Q1: YES — UNIQUE constraint on correlation_id
- Q2: YES — daily drain cron in vercel.json as safety net
- Q3: YES — log delivery_latency_ms to agent_events per send
