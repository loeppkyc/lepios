# Autonomous Harness — Component #2: Telegram Thumbs Feedback

**Status:** Design — pending Colin review
**Author:** Colin + Claude, 2026-04-21
**Scope:** Inline 👍/👎 buttons on Telegram pickup and completion messages that write to `task_feedback`, closing the human-signal loop for the feedback-loop scorer
**Rationale:** The signal_quality dimension of every agent_events score uses a 50/70 placeholder (no-flag → 50, flag-raised → 70) because there is no ground truth to score against. These thumbs are that ground truth. Without them, the scorer is measuring its own guesses, not reality.
**Estimated scope:** 2–3 hours (per `docs/feedback-loop-scoring.md §11.1`)
**Sequencing:** After component #5 (task pickup) stabilizes. Task pickup notifications are the primary v0 message type getting buttons; completion messages are the secondary type.
**v0 scope:** Data collection only — writes `task_feedback` rows on tap. Scorer calibration (reading thumb ratios to adjust signal_quality heuristics) is a deferred follow-on task, gated on ≥20 thumbs collected per task_type. Do not build calibration here.

---

## 1. Goal

The feedback-loop scorer (docs/feedback-loop-scoring.md) scores every `agent_events` row on four dimensions. Signal quality — did the output surface anything useful? — is the most important dimension and also the least measurable without human input. The rule-based scorer cannot know at scoring time whether a flag it raised was real or noise; that knowledge only exists in Colin's head after the fact.

Component #2 closes that loop. When LepiOS sends a Telegram notification for a task pickup or completion, it attaches 👍/👎 inline keyboard buttons. Colin taps once. That tap writes a `task_feedback` row. Over time, the accumulated thumb history becomes the calibration dataset that makes signal_quality scores meaningful.

**Why this is the supervisor signal:** Every other scoring dimension (completeness, efficiency, hygiene) is objectively measurable from the data. Signal quality is not — it requires a judge who can evaluate whether a flag mattered. Colin is that judge. Without thumbs, the scorer is flying partially blind. With 20+ thumbs per task type, the scorer knows its own precision and can adjust accordingly.

**What thumbs do not do:** They do not make decisions, trigger actions, or block anything. A 👎 does not re-queue a task or send an alert. They are calibration data, not control signals. The control plane remains Colin typing into Claude Code.

---

## 2. Scope

### In scope

- 👍/👎 inline keyboard buttons on **task pickup notifications** (the `✅ Task claimed:` Telegram sent by `pickup-runner.ts`)
- 👍/👎 inline keyboard buttons on **task completion messages** (the Telegram sent when a coordinator marks a task `completed` — message type to be defined in this component)
- Telegram webhook endpoint to receive callback queries: `POST /api/webhooks/telegram-callbacks`
- Webhook authentication via `X-Telegram-Bot-Api-Secret-Token` header
- `task_feedback` writes on tap (using the table from migration 0014 — schema below)
- Idempotency: second tap from same user on same message is deduplicated
- Message edit after tap: buttons replaced with a one-line acknowledgment (e.g., `✅ Feedback recorded`)
- `answerCallbackQuery` call (required by Telegram API to dismiss loading spinner)
- Feature flag: `TELEGRAM_THUMBS_ENABLED` env var
- New helper in `lib/orchestrator/telegram.ts`: `sendMessageWithButtons()` and `editMessageReplyMarkup()`
- One-time webhook registration via Telegram `setWebhook` API (manual step, documented in §10)

### Explicitly out of scope

- **Multi-reaction types** (⭐, ❓, custom emoji): `task_feedback.feedback_type` only supports `thumbs_up`, `thumbs_down`, `signal_validation` — stay within that constraint
- **Reply-with-text feedback**: Telegram `message` events (free-text replies) are not parsed. Only `callback_query` events from inline keyboard taps are handled.
- **Threaded discussions**: No Telegram thread/topic branching
- **Morning digest thumbs**: Explicitly a separate message type (feedback-loop §11.1 mentions digest buttons, but this component scopes to pickup and completion only). Morning digest buttons are deferred to a follow-on task.
- **Retrospective thumbs** (`signal_validation` type): this component only writes `thumbs_up` and `thumbs_down` from live button taps
- **Undo / change-mind flow**: No button to retract a tap in v0
- **Dashboard integration**: Thumb data accumulates in `task_feedback`; dashboard visualization of thumb ratios is deferred (feedback-loop §11.2)
- **Any write to `agent_events.quality_score`**: thumbs are stored separately and used by the scorer as calibration input, not as direct score mutations (see §7 for the design reasoning)

---

## 3. Scope rationale: why pickup + completion, not morning digest

Morning digest is the most natural place for a daily quality review — Colin reads it every morning. But the granularity is wrong for calibration. A morning digest covers multiple agent_events rows at once; a single 👍/👎 on the digest cannot indicate which sub-run was good or bad.

Pickup notifications and completion messages are one-to-one with a specific agent_events row. A thumb on a pickup notification means: "this task was worth claiming." A thumb on a completion message means: "this run's output was useful." These map cleanly to the `signal_quality` dimension for that specific row.

Morning digest thumbs are still valuable (as an aggregate quality signal for the whole digest run) and should be built, but as a separate task with a different `source` value and different `feedback_type` semantics.

---

## 4. Source of truth: `task_feedback` table

Schema from `supabase/migrations/0014_add_quality_scoring.sql` — do not redesign:

```sql
CREATE TABLE public.task_feedback (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_event_id   UUID        NOT NULL REFERENCES public.agent_events(id) ON DELETE CASCADE,
    feedback_type    TEXT        CHECK (feedback_type IN ('thumbs_up', 'thumbs_down', 'signal_validation')),
    value            TEXT,
    source           TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    meta             JSONB
);

CREATE INDEX ON public.task_feedback (agent_event_id);
```

### Field usage for this component

| Field | Used value | Notes |
|---|---|---|
| `agent_event_id` | UUID of the pickup or completion `agent_events` row | This is the linkage — one thumb per run |
| `feedback_type` | `'thumbs_up'` or `'thumbs_down'` | Directly from `callback_data` decode |
| `value` | `null` (no text capture in v0) | Reserved for future text replies |
| `source` | `'telegram_pickup_button'` or `'telegram_completion_button'` | Distinguishes message types |
| `meta` | `{ "telegram_user_id": ..., "message_id": ..., "callback_query_id": ... }` | For audit / dedup |

### No migration needed

Migration 0014 already created the table. This component adds no new columns or tables.

---

## 5. Message shape

### 5.1 Which messages get buttons

**Pickup notification** (currently sent by `lib/harness/pickup-runner.ts`):

```
✅ Task claimed: task-uuid
Sprint 4 Chunk A — SP-API integration...

To run: paste `Run task <full-uuid>` into Claude Code

[👍]  [👎]
```

The inline keyboard is appended to every pickup notification when `TELEGRAM_THUMBS_ENABLED` is set. The buttons are omitted when the env var is absent (safe fallback — message sends without buttons).

**Completion message** (new, defined here):

```
✅ Task completed: task-uuid
Sprint 4 Chunk A — SP-API integration...

Coordinator marked this done. Was the output useful?

[👍]  [👎]
```

This message type does not currently exist. The coordinator (or a future pickup route update) sends it when `completeTask()` is called. Defining the format here so the scorer integration is clear before the message is built.

### 5.2 Which messages do NOT get buttons

- Stale cancellation alerts (`[LepiOS Harness] Task cancelled — stale claim exhausted...`): informational only, no feedback meaningful at this stage
- Validation failure alerts: the task failed before meaningful work happened
- Queue-empty runs: nothing to evaluate
- Error/crash alerts: not a signal-quality scoring opportunity

### 5.3 `callback_data` format

Each button carries a `callback_data` string encoding the action and the linked agent_events row:

```
tf:{action}:{agent_event_id}
```

- `tf` — fixed prefix, disambiguates from other potential callback sources
- `{action}` — `up` (thumbs up) or `dn` (thumbs down)
- `{agent_event_id}` — full UUID of the `agent_events` row (36 chars)

Examples:
- `tf:up:885ff1e3-baed-4512-8e7a-8335995ea057` (42 chars — within Telegram's 64-byte limit)
- `tf:dn:885ff1e3-baed-4512-8e7a-8335995ea057` (42 chars)

### 5.4 Linking messages to agent_events rows

**Pickup notification linkage:** `pickup-runner.ts` currently calls `logEvent()` after sending the Telegram. The order must be reversed for v0 thumbs: generate the `agent_events` UUID before insertion, insert the row first (to get a durable ID), then send the Telegram with that UUID embedded in the button `callback_data`.

**Completion message linkage:** When `completeTask()` is called, look up the most recent `agent_events` row for this run (via `claimed_by = run_id`) or pass the event ID explicitly through the coordinator call chain.

### 5.5 What renders on tap

After Colin taps either button:

1. Telegram receives the `callback_query` event at the webhook
2. Webhook verifies auth (secret header + user ID — see §6)
3. Webhook writes `task_feedback` row
4. Webhook calls `answerCallbackQuery(callback_query_id)` — required to dismiss the spinner
5. Webhook calls `editMessageText` on the original message: the original body is preserved, the inline keyboard is removed, and one line is appended:
   ```
   👍 recorded at 10:03 MT
   ```
   or
   ```
   👎 recorded at 10:03 MT
   ```
   The emoji matches the tapped button. Timestamp is formatted as `HH:MM MT` (America/Denver). This makes the tap visible in the Telegram history without requiring Colin to remember what he tapped.

The edit is fire-and-forget after the `task_feedback` write. If the edit fails (Telegram API flaky), the feedback row is still written — correctness is the write, not the cosmetic edit.

---

## 6. Webhook endpoint

### Path

```
POST /api/webhooks/telegram-callbacks
```

New route, distinct from any existing webhook paths. Registered with Telegram via `setWebhook` (one-time setup per §10).

### Authentication

Telegram supports a `secret_token` parameter in `setWebhook`. When set, Telegram includes the value in every callback delivery as:

```
X-Telegram-Bot-Api-Secret-Token: <value>
```

This is compared against `process.env.TELEGRAM_WEBHOOK_SECRET`. Requests without this header or with a mismatched value return HTTP 403 immediately — no processing.

The secret must be 1–256 characters, only `A-Z`, `a-z`, `0-9`, `_`, and `-`. Use a random 32-character alphanumeric string, stored in Vercel as `TELEGRAM_WEBHOOK_SECRET`.

### User ID allowlist

Passing the webhook secret proves the request came from Telegram's infrastructure, but it does not prove the tap came from Colin. An attacker who can inject a message into the bot's chat (or who can craft a callback_query payload) could write arbitrary `task_feedback` rows without knowing the webhook secret.

After parsing the `callback_query` payload, verify:

```typescript
const allowedUserId = Number(process.env.TELEGRAM_ALLOWED_USER_ID)
if (callbackQuery.from.id !== allowedUserId) {
  await answerCallbackQuery(callbackQuery.id)  // dismiss spinner silently
  return NextResponse.json({ ok: false }, { status: 403 })
}
```

`TELEGRAM_ALLOWED_USER_ID` is Colin's Telegram numeric user ID (find it via `@userinfobot` or from existing bot logs). Stored in Vercel as an env var. Requests from any other `from.id` are rejected with HTTP 403 after answering the callback query (to prevent Telegram from retrying indefinitely).

The two-layer auth (webhook secret + user ID allowlist) together ensure: (1) the request came from Telegram's servers, and (2) the tap came from Colin specifically.

### Payload parsing

Telegram POSTs JSON. The webhook only processes `callback_query` events; all other event types are acknowledged (HTTP 200) and dropped immediately to avoid surprises if Telegram expands the webhook delivery scope.

```typescript
type TelegramUpdate = {
  update_id: number
  callback_query?: {
    id: string
    from: { id: number; username?: string }
    message: { message_id: number; chat: { id: number } }
    data: string   // "tf:up:<uuid>" or "tf:dn:<uuid>"
  }
}
```

Parse `callback_data` as: split on `:`, verify prefix is `tf`, action is `up` or `dn`, remaining segment is a valid UUID. On parse failure: answer the callback query (clears the spinner), log to `agent_events` with `status: 'warning'`, return HTTP 200 — do not crash.

### Idempotency

Telegram may deliver the same `callback_query` more than once (at-least-once delivery). A user may also tap the same button twice before the message edit removes the keyboard.

**Deduplication strategy:** Before inserting into `task_feedback`, check for an existing row with the same `agent_event_id` AND the same `source`. If one exists, skip the insert, still call `answerCallbackQuery`, return HTTP 200. This means only the first tap per `(agent_event_id, source)` pair is recorded.

No `UNIQUE` constraint is added to the schema (would be a migration) — the deduplication is done in application code via a `SELECT` before `INSERT`. This is acceptable for a one-user system with no concurrency concerns on the feedback path.

### Response contract

The webhook must return HTTP 200 to every Telegram delivery within 10 seconds, or Telegram will retry. All processing (DB write, message edit) must complete within that window. If the DB write is expected to be slow, answer the callback query synchronously and fire the edit as a background promise with `.catch(() => {})`.

---

## 7. Integration with the scorer — chosen approach: (c)

> **v0 boundary:** This component ships data collection only. The calibration layer that reads thumb ratios and adjusts signal_quality heuristics in `scoring.ts` is explicitly deferred — it is a follow-on task, not part of this build. See §1 status header and §7 "Calibration is not built in this component."

### The three options

**(a) Thumbs override signal_quality for the scored run**
A 👍 on a pickup event rewrites `agent_events.quality_score.dimensions.signal_quality` to a high value (e.g. 90); a 👎 sets it to 10. Simple to implement.

**(b) Thumbs adjust signal_quality by a fixed delta**
A 👍 adds +20 to the existing signal_quality score; a 👎 subtracts -20. Slightly less destructive than (a).

**(c) Thumbs stored separately; scorer reads rolling thumb ratio as calibration input**
Historical scores are immutable. The scorer function gains a calibration layer that reads thumb history per `task_type` and adjusts its signal_quality heuristics for *future* runs accordingly.

### Why (c)

**Against (a) and (b):** Both mutate historical `agent_events` rows. The score computed at time T by the rule-based scorer is a measurement of that scorer's behavior on that run. Retroactively changing it loses the measurement — the historical record no longer reflects what the scorer actually said. This matters because the scorer itself is supposed to improve; you can only measure improvement if past scores are stable.

Additionally, a single thumb should not have veto power over a multi-dimensional score. A 👍 means "this run surfaced something useful," which is signal_quality input only — it says nothing about completeness, efficiency, or hygiene. Letting it rewrite the aggregate is semantically wrong.

**For (c):** Thumbs become ground truth about the scorer's precision on the signal_quality dimension. The calibration works as follows:

1. For a given `task_type`, maintain a rolling ratio of thumbed runs: `👍 / (👍 + 👎)` over the last 30 days.
2. When that ratio is available (>= 20 thumbs), use it to adjust the signal_quality base rule for *new* scoring runs of the same task type:
   - If 80% of past runs got 👍 → the scorer is surfacing real signal. The "flag raised → 70" base score can move up toward 80.
   - If 30% of past runs got 👍 → the scorer is producing noise. The "flag raised → 70" score should be discounted toward 50 or below.
3. Below 20 thumbs, calibration factor defaults to 1.0 (no adjustment — placeholder scores unchanged). This prevents early outliers from distorting the curve.
4. Historical `agent_events.quality_score` rows are never mutated. A new field `quality_score.scored_by` value of `rule_based_v1_calibrated` will distinguish calibrated scoring runs from uncalibrated ones.

**Colin's intuition ("keeps rule-based scoring deterministic and treats human signal as calibration data over time, not per-task veto") is exactly right.** This preserves the scorer as a reliable instrument while giving thumbs their proper role: teaching the instrument to be more accurate, not overriding it case-by-case.

### Calibration is not built in this component

This component ships the *data collection* side (write to `task_feedback`). The *use* side (the calibration layer in `scoring.ts`) is a follow-on task, gated on >= 20 thumbs being collected. Collecting thumbs with no calibration yet is intentional — you need the data before you can calibrate.

The follow-on task: update `lib/orchestrator/scoring.ts` to read thumb ratios from `task_feedback` and adjust `signal_quality` scoring heuristics per task_type. This is deferred explicitly; do not build it here.

---

## 8. Failure modes

### 8.1 Webhook not reachable (Telegram delivery fails)

**What happens:** Telegram retries at increasing intervals (5s, 30s, 5min, ...) for up to 1 hour. If all retries fail, the callback is dropped.

**Impact:** Thumb is not recorded. The message continues to show the inline keyboard. Future taps will re-attempt delivery.

**Behavior:** No automated recovery. Colin can re-tap if the keyboard is still visible. If the webhook is persistently down, the buttons are cosmetic debris — they won't break anything.

**Detection:** Telegram sends an error count to `getWebhookInfo`. The night_tick check should poll `getWebhookInfo` and raise a flag if `pending_update_count` is high.

### 8.2 Duplicate callback delivery (Telegram retries)

**What happens:** Telegram delivers the same `callback_query` twice (network failure between delivery and 200 response).

**Behavior:** Application-level dedup (§6) catches this. Second write is skipped. `answerCallbackQuery` is called for both deliveries (safe to call twice). Second message edit is a no-op (buttons already removed).

### 8.3 User taps before task completes

**Pickup notification** has buttons even before the coordinator runs. A 👍 here means "this task was worth claiming," not "the work was good." This is intentional — the pickup agent_events row tracks the pickup quality, not the execution quality. Completion message buttons track execution quality separately.

Both are valid calibration signals for different things. The `source` field disambiguates.

### 8.4 User taps on an old message (days or weeks later)

Telegram inline keyboard buttons remain tappable unless edited away. If Colin taps a button on a 2-week-old pickup notification, the callback is delivered and the `task_feedback` write proceeds normally. Old thumbs are still valid calibration signal — the task's outcome is known by then, making the thumb more accurate, not less.

The `task_feedback.created_at` timestamp captures when the thumb was given. Calibration queries can window by `created_at` if recency weighting is desired.

### 8.5 User taps then changes mind

No undo in v0. The first tap's `task_feedback` row stands. For calibration purposes, one misclick in 50 thumbs changes the ratio by ~2 percentage points — statistically negligible. If the signal is genuinely wrong, the user can note it and the calibration layer's 30-day window will naturally discount it as more correct thumbs accumulate.

If undo is needed in v1: add a second tap on the opposite button, and the calibration query takes only the most recent `task_feedback` row per `agent_event_id`.

### 8.6 `agent_event_id` in callback_data references a deleted row

`task_feedback` has `ON DELETE CASCADE` on `agent_event_id`. If the referenced `agent_events` row was deleted before the tap, the INSERT will FK-violation. 

**Behavior:** Catch the FK violation, answer the callback query, return HTTP 200 (no crash). Log to console. The thumb is lost — this is acceptable since deleted rows are already gone from the scoring system.

### 8.7 Callback spoofing (unauthorized user taps or crafted payload)

**Scenario:** An attacker or test bot sends a `callback_query` to the webhook — either because they can send messages to the bot, or because they've guessed/intercepted the webhook URL. The webhook secret alone doesn't stop a legitimate Telegram user (other than Colin) from tapping buttons if they appear in a shared chat, or from sending crafted updates if they control a bot account.

**Behavior:** The user ID allowlist check (§6) rejects any `callback_query` where `from.id` ≠ `TELEGRAM_ALLOWED_USER_ID`. `answerCallbackQuery` is called first (clears their spinner), then HTTP 403 is returned. No `task_feedback` row is written.

**What is NOT stopped by this check:** If Colin's own Telegram account is compromised, the attacker could tap buttons as Colin. This is out of scope — account compromise is a different threat model.

**Detection:** Unexpected 403s from the webhook should appear in Vercel function logs. No automated alert in v0; add one if spoofing attempts become a pattern.

### 8.8 TELEGRAM_THUMBS_ENABLED absent

**Behavior:** `sendMessageWithButtons()` falls back to `postMessage()` — buttons are not appended, plain text only. No webhook needed, no behavior change. Safe default.

---

## 9. Acceptance criteria

Machine-checkable. Tests written and passing before any code merges.

### AC-1: `task_feedback` table exists with correct schema

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'task_feedback'
ORDER BY ordinal_position;
```

Expected columns: `id` (uuid, not null), `agent_event_id` (uuid, not null), `feedback_type` (text, nullable), `value` (text, nullable), `source` (text, nullable), `created_at` (timestamptz, nullable), `meta` (jsonb, nullable).

Constraint: `feedback_type IN ('thumbs_up', 'thumbs_down', 'signal_validation')`.
FK: `agent_event_id` references `agent_events(id) ON DELETE CASCADE`.

### AC-2: `sendMessageWithButtons()` sends inline keyboard when flag set

```text
With TELEGRAM_THUMBS_ENABLED=1:
  sendMessageWithButtons(agentEventId, text)
  → Telegram API called with reply_markup.inline_keyboard containing two buttons
  → button[0].callback_data = "tf:up:<agentEventId>"
  → button[1].callback_data = "tf:dn:<agentEventId>"
```

### AC-3: Pickup notification includes 👍/👎 buttons when flag set

```text
With TELEGRAM_THUMBS_ENABLED=1:
  runPickup() with a queued task
  → Telegram message sent with inline keyboard
  → callback_data contains the pickup run's agent_events UUID
  → agent_events row is inserted BEFORE Telegram is sent (UUID available for embedding)
```

### AC-4: `sendMessageWithButtons()` falls back to plain text when flag absent

```text
With TELEGRAM_THUMBS_ENABLED unset:
  sendMessageWithButtons(agentEventId, text)
  → Telegram API called without reply_markup (plain text only)
  → no webhook interaction required
```

### AC-5: Webhook rejects unauthorized requests

```text
POST /api/webhooks/telegram-callbacks
  (no X-Telegram-Bot-Api-Secret-Token header, TELEGRAM_WEBHOOK_SECRET is set)
  → HTTP 403
  → no task_feedback row written
  → no agent_events mutation
```

```text
POST /api/webhooks/telegram-callbacks
  (header present but wrong value)
  → HTTP 403
```

### AC-6: 👍 tap writes correct `task_feedback` row

```text
POST /api/webhooks/telegram-callbacks
  (authorized, callback_query.data = "tf:up:<uuid>")
  → HTTP 200
  → task_feedback row: feedback_type='thumbs_up', source='telegram_pickup_button',
      agent_event_id=<uuid>, meta.telegram_user_id present
```

### AC-7: 👎 tap writes correct `task_feedback` row

```text
POST /api/webhooks/telegram-callbacks
  (authorized, callback_query.data = "tf:dn:<uuid>")
  → HTTP 200
  → task_feedback row: feedback_type='thumbs_down', source='telegram_pickup_button',
      agent_event_id=<uuid>
```

### AC-8: Duplicate tap is deduplicated (idempotent write)

```text
POST /api/webhooks/telegram-callbacks  (first tap)
  → 1 task_feedback row written

POST /api/webhooks/telegram-callbacks  (identical callback_query)
  → HTTP 200 (no error)
  → still only 1 task_feedback row in DB for this agent_event_id + source
```

### AC-9: Message is edited after tap (buttons removed)

```text
After successful tap:
  → Telegram editMessageText called on the original message_id
  → edited message text includes "Feedback recorded"
  → inline keyboard is removed from the edited message
  → answerCallbackQuery called with the callback_query_id
```

### AC-10: Malformed callback_data is handled gracefully

```text
POST /api/webhooks/telegram-callbacks
  (authorized, callback_query.data = "garbage_data")
  → HTTP 200 (no crash)
  → no task_feedback row written
  → answerCallbackQuery called (spinner dismissed)
  → warning logged (agent_events or console)
```

### AC-11: Unknown agent_event_id is handled gracefully (FK miss)

```text
POST /api/webhooks/telegram-callbacks
  (authorized, callback_query.data = "tf:up:<non-existent-uuid>")
  → HTTP 200
  → no task_feedback row (FK violation caught, swallowed)
  → answerCallbackQuery called
```

### AC-12: Feature flag gates all button behavior; existing tests unaffected

```text
npm test passes (all existing tests green — no regressions to pickup-runner, task-pickup,
night-tick, or morning-digest behavior)

With TELEGRAM_THUMBS_ENABLED unset:
  → all existing Telegram messages sent as plain text (no buttons)
  → webhook endpoint exists but is never called by the system
  → no new agent_events writes
```

---

## 10. Rollout

### Feature flag

`TELEGRAM_THUMBS_ENABLED` environment variable.

- **Truthy** (`1`, any non-empty string): buttons attached to pickup and completion messages; webhook active
- **Absent or empty**: plain-text Telegram only; webhook endpoint exists but is never called by the system

### One-time webhook registration (manual step)

Telegram webhook must be registered before buttons work. This is a one-time `setWebhook` call per bot:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://lepios.vercel.app/api/webhooks/telegram-callbacks" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  -d "allowed_updates=[\"callback_query\"]"
```

- `allowed_updates=["callback_query"]` — only deliver button taps, not all message types
- Webhook registration survives bot token rotations but NOT base URL changes (Vercel project URL must be stable)
- Verify registration: `GET https://api.telegram.org/bot${TOKEN}/getWebhookInfo`

This step is a deploy prerequisite. Do it after code is deployed but before setting `TELEGRAM_THUMBS_ENABLED=1`.

### Rollout order

1. **Code deployed, flag off** — merge PR with `TELEGRAM_THUMBS_ENABLED` absent. All existing messages unchanged. Webhook endpoint exists but receives nothing.

2. **Register webhook** — run the `setWebhook` curl above with production `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. Verify via `getWebhookInfo`.

3. **Canary: test tap** — set `TELEGRAM_THUMBS_ENABLED=1`. Manually trigger a pickup run (or wait for the 16:00 UTC cron). Observe Telegram message with buttons. Tap 👍. Verify:
   - `task_feedback` row written with correct `agent_event_id`
   - Telegram message edited to show "Feedback recorded"
   - No errors in Vercel logs

4. **Enable on pickup notifications** — canary above IS the pickup notification canary. If clean, leave on.

5. **Enable on completion messages** — once coordinator sends completion Telegrams. Wire the same `sendMessageWithButtons()` call with `source: 'telegram_completion_button'`.

6. **Monitor** — watch `task_feedback` table for incoming rows. Track via:
   ```sql
   SELECT source, feedback_type, count(*) FROM task_feedback
   GROUP BY source, feedback_type ORDER BY source;
   ```

### Fast disable

Set `TELEGRAM_THUMBS_ENABLED=` in Vercel env (no redeploy required). All messages revert to plain text. Buttons already sent remain in Telegram history but new pickups/completions will not have them. Webhook continues to receive taps from old messages — these are handled gracefully regardless of the flag.

---

## 11. Resume criteria

"Resume" here means: start using thumb data for actual signal_quality calibration in the scorer. Not just collecting, but actively using.

### Data collection threshold (required first)

- **3+ days clean** — `task_feedback` rows being written consistently, no webhook errors in Vercel logs, no `agent_events` warning rows from the callback handler
- **20+ thumbs per task_type** — minimum statistical threshold before the calibration factor is non-trivial. Below this, the calibration layer defaults to factor 1.0 (placeholder scores unchanged).

### Calibration activation (required after data threshold)

- **Build and merge the calibration layer** in `lib/orchestrator/scoring.ts` — reads thumb ratio from `task_feedback` per task_type, adjusts signal_quality heuristics for new scoring runs. This is a separate build step, not part of this component.
- **Verify calibration changes scores** — compare signal_quality scores on runs with thumbs vs. without. The calibrated values should diverge from 50/70 in the direction the thumbs indicate.

### Verification query (for both phases)

```sql
-- Data collection health check
SELECT
  source,
  feedback_type,
  count(*)                                            AS total_thumbs,
  min(created_at)                                     AS first_thumb,
  max(created_at)                                     AS last_thumb
FROM task_feedback
WHERE created_at > now() - interval '7 days'
GROUP BY source, feedback_type
ORDER BY source, feedback_type;

-- Thumb ratio per task_type (calibration input)
SELECT
  ae.task_type,
  count(*) FILTER (WHERE tf.feedback_type = 'thumbs_up')   AS thumbs_up,
  count(*) FILTER (WHERE tf.feedback_type = 'thumbs_down')  AS thumbs_down,
  round(
    count(*) FILTER (WHERE tf.feedback_type = 'thumbs_up')::numeric
    / nullif(count(*), 0) * 100, 1
  )                                                          AS pct_positive
FROM task_feedback tf
JOIN agent_events ae ON ae.id = tf.agent_event_id
WHERE tf.source IN ('telegram_pickup_button', 'telegram_completion_button')
  AND tf.created_at > now() - interval '30 days'
GROUP BY ae.task_type;
```

Twenty or more rows per task_type with a stable `pct_positive` (not bouncing between 20% and 80% week to week) = calibration-ready.
