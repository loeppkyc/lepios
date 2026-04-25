# Sprint 5 — Chunk: notification-drain-routing — Study Doc

**Chunk ID:** notification-drain-routing
**Status:** study complete — awaiting Colin approval on acceptance doc
**Phase:** 1a (system study), 1b (twin Q&A — blocked), 1c (20% Better)
**Date:** 2026-04-25
**Bug surfaced on task:** fdf5a51e-28ca-4584-88f2-e922046ee276 (purpose-review-correctness)
**Bug surfaced at:** 2026-04-25T19:31:00Z

---

## What this chunk is

This is a greenfield/harness chunk — no Streamlit predecessor. It fixes two bugs in the
coordinator Telegram notification routing system and adds F18 measurement instrumentation.

---

## Phase 1a — System Study

### Current notification system architecture

The coordinator sends Telegram notifications via an async queue:

1. **Insert** — Coordinator inserts a row into `outbound_notifications` (migration 0017) with:
   - `channel: 'telegram'`
   - `chat_id: TELEGRAM_CHAT_ID`
   - `correlation_id: task_id[:8]` (first 8 hex chars)
   - `requires_response: true` (for approval requests) or `false` (FYI)
   - `payload.text`: message body
   - `payload.reply_markup.inline_keyboard`: buttons with JSON callback data
     format `{"correlation_id":"<corr_id>","action":"approve"|"reject"}`

2. **Drain** — `/api/harness/notifications-drain` reads `status='pending'` rows and
   calls Telegram `sendMessage`. On success: sets `status='sent'`, stores Telegram's
   `message_id` in `payload.message_id`.

3. **Poll** — Coordinator polls `outbound_notifications?id=eq.<ROW_ID>&select=status,response`
   every 15 seconds for up to 30 minutes waiting for `status='response_received'`.

4. **Webhook routing** — `/api/telegram/webhook` receives Telegram callback_query updates.
   `findMatchingRow` tries three strategies:
   - Strategy A: parse `callback_data` as JSON, look for `correlation_id` key,
     find row with `.eq('correlation_id',...).eq('requires_response',true).eq('status','sent')`
   - Strategy B: match via `reply_to_message.message_id` stored in `payload.message_id`
   - Strategy C: most recent `requires_response=true, sent` row in last 24h for this chat
   If matched: update row to `status='response_received'`, store response JSON.

### Bug 1 — Drain not scheduled (root cause of 29-minute latency)

`vercel.json` lists cron jobs but `/api/harness/notifications-drain` is **absent** from
the schedule. The coordinator is expected to manually trigger the drain after inserting each
notification (coordinator.md Step 3 "best-effort"). If this trigger fails or is skipped,
the notification sits indefinitely.

**Observed:** Row `87ad9e70` created at 19:01:25 UTC, sent at 19:30:01 UTC — 28 min 36 sec
delay. The drain trigger from the coordinator session either failed or was not executed in
that run.

**Impact:** F18 target `approval_to_builder_latency_p95 < 60s` cannot be met if the drain
is not running reliably. Worst case with no cron = indefinite delay.

**Evidence:**
- `vercel.json` — 9 cron entries, none for `/api/harness/notifications-drain`
- `outbound_notifications` row `87ad9e70`: `created_at=19:01:25, sent_at=19:30:01`
- `app/api/harness/notifications-drain/route.ts` — no self-scheduling mechanism

### Bug 2 — Double-tap generates agent_event_id=null warning

**Observed:** At 19:31:16, a second webhook callback arrived for `correlation_id="fdf5a51e"`.
The `outbound_notifications` row was already `status='response_received'` (from the first
tap at 19:30:47). `findMatchingRow` Strategy A checks `.eq('status','sent')` — no match.
Strategies B and C also fail (no reply_to_message, and the row is already `response_received`
not `sent`). The callback falls through to legacy handlers:

```
parsed = parseCallbackData('{"correlation_id":"fdf5a51e","action":"approve"}')
  → null (expects tf:up/dn:uuid format)
parsedGate = parseGateCallbackData(...)
  → null (expects dg:... format)
parsedImprove = parseImproveCallbackData(...)
  → null (expects improve_...: format)
parsedPurposeReview = parsePurposeReviewCallback(...)
  → null (expects purpose_review:...: format)
```

All parsers return null → `logWebhookEvent` is called with `agent_event_id=null`,
`status='warning'`. The `agent_events` row records `meta.agent_event_id=null` with
`status='warning'`.

**Impact:** Spurious warning log confuses operator (coordinator session) into thinking
the notification routing failed, when in fact the first tap already succeeded. This is
the "notification.agent_event_id=null" in the bug description — it's the warning log entry,
not a missing column in the schema.

**Evidence:**
- `agent_events` row at `2026-04-25 19:31:16.444338+00`: action=telegram_callback,
  status=warning, meta.agent_event_id=null, meta.callback_data={"correlation_id":"fdf5a51e"...}
- `app/api/telegram/webhook/route.ts:logWebhookEvent` — logs warning when `parsed == null`
- `lib/harness/telegram-buttons.ts:parseCallbackData` — only matches `tf:up|dn:uuid` format

### Existing code that is correct and must not change

- `findMatchingRow` Strategy A logic for `status='sent'` — works correctly for first tap
- Coordinator drain trigger mechanism (coordinator.md Step 3) — correct design, just not a fallback
- The coordinator polling loop (poll for `response_received`) — works when drain runs promptly
- `outbound_notifications` schema (migration 0017) — correct, no schema change needed

---

## Phase 1b — Twin Q&A

**Endpoint unreachable** (production URL: `https://lepios-one.vercel.app/api/twin/ask`,
returned connection refused).

### Pending Colin Questions

All twin questions escalate to Colin:

1. **Vercel plan** — "Is there a plan to upgrade from Vercel Hobby to Pro? Pro supports
   sub-minute cron jobs (every 1 minute). Hobby supports daily only. If upgrade is planned,
   the fix would be a 1-minute cron; if not, the safety net is daily + manual trigger."
   → [twin: unreachable, endpoint error]

2. **Double-tap preference** — "When Colin taps an approve button twice (common on mobile),
   should the second tap silently no-op (preferred: no noise), or show a brief 'already recorded'
   acknowledgment?" → [twin: unreachable, endpoint error]

3. **F18 measurement surface** — "The F18 target is `approval_to_builder_latency_p95 < 60s`.
   Should this metric be surfaced in the Business Review dashboard, or just queryable via
   `agent_events`?" → [twin: unreachable, endpoint error]

---

## Phase 1c — 20% Better

Evaluating against the 6 categories:

| Category      | Finding |
| ------------- | ------- |
| Correctness   | Bug 1 and Bug 2 are correctness issues. Daily cron fallback prevents indefinite delay. Graceful double-tap no-op prevents false warning logs. Both are required fixes. |
| Performance   | The 29-minute drain delay is the dominant latency component. Daily cron doesn't improve p95 — it only prevents ∞ latency. Real improvement requires Pro plan or a polling loop. Deferred until plan decision. |
| UX            | Spurious `warning` logs with `agent_event_id=null` create alert fatigue for the coordinator operator. Fixing to graceful no-op reduces noise. |
| Extensibility | The `correlation_id` routing mechanism is the right long-term design. No change needed. The drain should be moved to a dedicated endpoint that can eventually support retry policies. Already done. |
| Data model    | No schema change needed. The routing is entirely in application logic. |
| Observability | **Gap:** drain currently does not log per-message latency. F18 requires `drain_latency_ms` and `approval_to_builder_latency_ms` in `agent_events` so Colin can query "how fast is the approval loop?" without reading code. |

**Proposed improvements:**

1. **F1** — Add `/api/harness/notifications-drain` to `vercel.json` cron at daily frequency
   as a minimum safety net. If Colin upgrades to Pro, change to `* * * * *` (every minute).
   Reversible: changing cron schedule.

2. **F2** — Extend `findMatchingRow` to add Strategy A': after Strategy A fails (no `sent`
   row), check if a `response_received` row with the same `correlation_id` exists. If found,
   return a sentinel `'__already_processed__'`. In the webhook dispatch block, if `matchedId`
   is the sentinel, return 200 without logging a warning. Zero DB schema change; ~10 lines.
   Reversible with grep.

3. **F3** — When the drain successfully sends a message, log an `agent_events` row with
   `action='notification_sent'`, `meta.notification_id`, `meta.drain_latency_ms`,
   `meta.requires_response`. When the webhook writes `response_received`, log
   `action='notification_response_received'`, `meta.total_approval_latency_ms`
   (= `response_received_at - created_at`). This gives Colin queryable F18 data.

Items F1–F3 are all small, non-destructive changes. No schema migration. No breaking changes.
