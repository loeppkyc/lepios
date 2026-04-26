# button-data-invalid — Acceptance Doc

Sprint 5 · chunk: button-data-invalid
Coordinator task: 915d1fee-18bd-4718-bde5-8a6956a72084
Colin approval: pre-staged with defaults, review_via=pre_staged_with_defaults, 2026-04-26

---

## Scope

Telegram enforces a 64-byte limit on `callback_data`. The current coordinator sends JSON like
`{"correlation_id":"40b1aa4b-c969-4d94-93f7-49ce29f3fc26","action":"approve"}` (72 bytes),
causing buttons to be silently stripped and approval routing to fail.

Switch `callback_data` to a short format with DB prefix-lookup to stay under 64 bytes on all
current and foreseeable task IDs.

**Acceptance criterion:**
(a) All outbound Telegram messages with inline keyboards use the short format
(`ap:{8}` / `re:{8}`) and do NOT throw `BUTTON_DATA_INVALID`,
(b) a real approval tap on a live message routes to the correct task and triggers the approval
flow, and
(c) the prefix-collision guard logs `callback_collision_detected` to `agent_events` when
two tasks share the same 8-char prefix.

---

## Short format spec

| Button | callback_data | Max bytes |
|--------|--------------|-----------|
| Approve | `ap:{first_8_chars_of_correlation_id}` | 11 bytes ✓ |
| Reject / revise | `re:{first_8_chars_of_correlation_id}` | 11 bytes ✓ |
| Grounding pass | `gp:{first_8_chars_of_correlation_id}` | 11 bytes ✓ |
| Grounding partial | `gpart:{first_8_chars_of_correlation_id}` | 14 bytes ✓ |
| Grounding fail | `gf:{first_8_chars_of_correlation_id}` | 11 bytes ✓ |

All well under 64 bytes. No other actions currently exist.

---

## Lookup logic on callback receive

```typescript
const [prefix, id8] = callbackData.split(':')  // e.g. ['ap', '40b1aa4b']

const { data: matches } = await supabase
  .from('task_queue')
  .select('id')
  .like('id', `${id8}%`)

if (matches.length === 0) { /* log error, return */ }
if (matches.length > 1) {
  // log callback_collision_detected to agent_events, return error
}
const fullTaskId = matches[0].id
// proceed with approval using fullTaskId + prefix mapping
```

---

## Out of scope

- Changing the outbound notification text format
- Migrating historical messages (already sent, buttons already stripped)
- Expanding to actions beyond approve/reject/grounding buttons

---

## Files expected to change

| File | Change |
|------|--------|
| Telegram send helper (find via grep for `callback_data` or `inline_keyboard`) | Replace JSON callback_data construction with short format |
| Telegram callback handler (find via grep for `callback_data` in `app/api/telegram/`) | Add prefix-lookup + collision guard |
| `tests/integrations/telegram/` or similar | New unit tests for serialize/parse + collision detection |

Builder must grep to confirm exact file paths before editing.

---

## Check-Before-Build findings

Builder must verify before coding:

| Item | Action |
|------|--------|
| Current callback_data construction | `grep -r "callback_data" app/ lib/ --include="*.ts"` |
| Telegram callback handler route | `grep -r "callback_data\|telegram.*webhook" app/api/ --include="*.ts"` |
| All existing button action strings | Enumerate every `action:` value used in callback_data |
| `task_queue.id` type | UUID — first 8 chars of UUID hex are sufficient (collision probability ~10⁻⁹ at current queue size) |

---

## F18 metric

Log to `agent_events` after each callback received:

```json
{
  "action": "button_callback_received",
  "domain": "telegram",
  "actor": "callback-handler",
  "status": "success|collision|not_found",
  "meta": {
    "prefix": "ap",
    "id8": "40b1aa4b",
    "resolved_task_id": "<full UUID or null>",
    "delivery_latency_ms": "<ms from message sent_at to callback received_at>"
  }
}
```

Also log `callback_collision_detected` separately when `matches.length > 1`.

**Benchmark:** zero `BUTTON_DATA_INVALID` errors in `outbound_notifications.last_error`
after this ships.

---

## Grounding checkpoint

1. Deploy to production.
2. Trigger a coordinator task that sends an approval button (or inject one manually).
3. Confirm the outbound Telegram message arrives with working buttons (no silent strip).
4. Tap Approve — confirm `outbound_notifications` response is recorded and task status
   transitions correctly.
5. Confirm `agent_events` row with `action='button_callback_received'` and
   `meta.resolved_task_id` non-null.
6. Confirm no `BUTTON_DATA_INVALID` in `outbound_notifications.last_error` for the new message.

---

## Open questions

All defaults accepted (pre-staged):

- Q1: 8 chars or 12? **8 chars** (collision ~10⁻⁹ at current queue size; bump to 12 if
  `callback_collision_detected` ever fires in production).
- Q2: Reject ambiguous prefix or pick newest? **REJECT** — safer, surfaces real bugs.

---

## Cached-principle decisions

`cache_match_enabled: false` for Sprint 5. Pre-staged by Colin 2026-04-26 with defaults accepted.

- Principle 17: no new tables; uses existing task_queue prefix-lookup ✓
- Principle 18: `button_callback_received` F18 event with latency + resolution status ✓
- Principle 19: no UI changes, backend handler only ✓
