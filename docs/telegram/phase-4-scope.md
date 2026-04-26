# Telegram Phase 4 — Audit & Scope

**Audit date:** 2026-04-26  
**Auditor:** Claude Code (coordinator-pattern audit, no code changes)  
**Pre-staged tasks in flight (not duplicated here):**
- `915d1fee` — BUTTON_DATA_INVALID: callback_data >64 bytes strips buttons
- `b93658c2` — drain_trigger_failed: coordinator self-trigger URL wrong

---

## 1. Current State Inventory

### 1.1 Inbound Routes (Telegram → LepiOS)

| Route | File | Auth | Status |
|-------|------|------|--------|
| `POST /api/telegram/webhook` | `app/api/telegram/webhook/route.ts` | HMAC secret-token header | Working |

The webhook handles three update types:
- **callback_query** (button tap) — ack'd immediately, then routed
- **message with text** (reply or command) — routed to legacy or correlation handlers
- **message without text** (media, sticker, etc.) — dropped silently with log

**Inbound routing: three-strategy correlation** (first match wins):
- **Strategy A** — callback_query with `{"correlation_id":"..."}` JSON in callback_data → matches outbound_notifications row
- **Strategy B** — text reply with `reply_to_message.message_id` → matched against `payload->>'message_id'` stored by drain
- **Strategy C** — 24h fallback → most recent `sent + requires_response` row for this chat in last 24h

**Then legacy dispatch on no match:**
- `/budget` text command → work-budget handler
- purpose_review text reply → `handlePurposeReviewTextReply()`
- thumbs feedback callbacks (`tf:up|dn:{uuid}`) → writeFeedback()
- deploy-gate callbacks (`dg:promote|rb|abort:{sha}`) → gate handlers
- improve callbacks (`improve_approve_all|dismiss|review:{id}`) → improvement engine handlers
- purpose_review callbacks (`purpose_review:approve|revise|skip:{id}`) → purpose review handler

### 1.2 Outbound Routes (LepiOS → Telegram)

| Route | File | Auth | Use |
|-------|------|------|-----|
| `POST /api/harness/telegram-send` | `app/api/harness/telegram-send/route.ts` | CRON_SECRET bearer | Direct send for tests/one-offs |
| `GET|POST /api/harness/notifications-drain` | `app/api/harness/notifications-drain/route.ts` | CRON_SECRET bearer | Queue drain |

### 1.3 Outbound Message Paths (Code → Telegram)

| Path | Function | Used by | Validates 4096? |
|------|----------|---------|-----------------|
| `lib/orchestrator/telegram.ts:postMessage()` | Direct Telegram API call | digest, pickup-runner, telegram-buttons fallback | **No** |
| `lib/harness/telegram-buttons.ts:sendMessageWithButtons()` | With inline keyboard | pickup-runner (thumbs buttons) | No |
| Direct Telegram API fetch | In deploy-gate, purpose-review, timeout | Various | No |
| `outbound_notifications` queue → drain | Coordinator messages, stall alerts | coordinator, stall-check | No |
| `telegram-send` route | Validated endpoint (1–4096 chars) | Manual/test sends | **Yes** (schema) |

### 1.4 Message Types Sent TO Telegram

| Type | Sender | Via | Button type |
|------|--------|-----|-------------|
| Morning digest | Cron | postMessage() | None |
| Stall alerts (T1–T5) | Stall-check | outbound_notifications | None |
| Task claim notification | pickup-runner | postMessage() or sendMessageWithButtons() | Thumbs (optional) |
| Coordinator approval request | coordinator | outbound_notifications | Approve / Reject + reason |
| Grounding question | coordinator | outbound_notifications | Approve / Reject |
| Deploy-gate promotion | deploy-gate | direct Telegram API | Promote / Rollback / Abort |
| Purpose review prompt | purpose-review handler | direct Telegram API | Approve / Revise / Skip |
| Review timeout escalation | purpose-review/timeout.ts | direct Telegram API (fetch) | None |
| Improvement engine proposals | improvement engine | direct Telegram API | Approve All / Dismiss / Review |
| Process efficiency section | digest (new, 2026-04-26) | postMessage() | None |

### 1.5 Message Types Received FROM Telegram

| Type | Trigger | Handler | Tested? |
|------|---------|---------|---------|
| Button tap: thumbs up/down | User taps 👍/👎 | writeFeedback() → editMessageText | Yes |
| Button tap: deploy-gate | User taps Promote/Rollback/Abort | handleGatePromote/Rollback/Abort() | Parsing only |
| Button tap: improve_* | User taps engine proposal buttons | handleImproveApproveAll/Dismiss/Review() | **No** |
| Button tap: purpose_review | User taps Approve/Revise/Skip | handlePurposeReviewCallback() | **No** |
| Button tap: coordinator | User taps Approve/Reject | outbound_notifications update via Strategy A | **No (E2E)** |
| Text reply: grounding answer | User types + replies to message | Strategy A/B/C → outbound_notifications update | **No** |
| Text reply: purpose review notes | User types revision notes | handlePurposeReviewTextReply() | **No (E2E)** |
| Text command: /budget | User types /budget | handleBudgetCommand() | **No** |

---

## 2. Five-Flow Analysis (Logical State, 2026-04-26)

These are analyzed against current production code, not live-tested. Each rated as: **Working / Broken / Unknown**.

### Flow 1: Coordinator pings Colin via Telegram

**Steps:**
1. Coordinator inserts row into `outbound_notifications` (channel='telegram', requires_response=true)
2. Coordinator calls drain endpoint to deliver immediately (b93658c2 fixes the URL)
3. Drain calls Telegram API → message appears in Colin's chat
4. Telegram returns message_id; drain stores it in payload
5. Colin sees message with Approve/Reject buttons

**Status: BROKEN until b93658c2 ships**
- b93658c2 fixes the drain trigger URL. Before it ships, self-triggered drain returns 404/error → coordinator logs drain_trigger_failed and continues → message lands on daily cron at 1 AM UTC → Colin sees message up to 24 hours late.
- **Gap not covered by b93658c2:** Even after URL fix, the coordinator polls for a response after 15 seconds. If the drain URL call is blocked by sandbox or network, the message still waits for daily cron. No fallback exists.

### Flow 2: Colin replies with a grounding answer

**Steps:**
1. Colin taps the "Approve" or "Reject" button in Telegram
2. Webhook receives callback_query
3. Webhook parses callback_data: `{"correlation_id":"abcd1234","action":"approve"}`
4. Strategy A finds matching outbound_notifications row
5. Row updated: `status='response_received'`, `response={type:'callback', callback_data:...}`
6. Coordinator polling detects status='response_received'
7. Coordinator reads response.callback_data.action and continues

**Status: UNKNOWN (untested E2E)**
- Strategy A logic exists in webhook.ts and is not tested end-to-end.
- No test exercises the full flow: outbound insert → drain → Telegram → webhook → correlation match → row update → coordinator read.
- The individual pieces exist; their integration has never been verified.
- **Specific risk:** If Telegram strips the callback_data (see 915d1fee — >64 bytes), Colin's tap sends an empty string, Strategy A fails, and the coordinator polls indefinitely until 30-minute timeout.

### Flow 3: Inline button taps reach the right handler

**Status: PARTIAL**
- **Thumbs feedback:** Working (tested, message edit confirmed)
- **Deploy-gate buttons:** Routing works; action handlers not integration-tested
- **improve_* buttons:** Routing code exists, handlers written, **zero test coverage**
- **purpose_review buttons:** Routing code exists, handler written, **zero test coverage**
- **Coordinator approval buttons:** Strategy A routing untested E2E; depends on Flow 2 above

### Flow 4: Long messages (over Telegram limits)

**Status: UNHANDLED**
- The morning digest is the highest-risk message. Current estimated length: ~800–2000 chars. Safe today.
- `postMessage()` has no 4096-char guard. If digest crosses 4096 chars (e.g., many stall entries + long flag messages + all new sections), Telegram API rejects the call → `telegram_failed` status → Colin gets nothing that morning, no alert.
- **No truncation, no split-message logic, no pre-send check.**
- The `telegram-send` route validates 1–4096 chars, but `postMessage()` does not use that validation.

### Flow 5: Error path (Telegram API down)

**Status: PARTIALLY HANDLED — silent black hole for coordinator messages**
- **Digest:** `postMessage()` throws → caught in digest.ts → status='telegram_failed' → logged to agent_events → **no immediate alert to Colin** (can't alert because Telegram is down). Colin sees missed digest in morning_digest quality score.
- **Drain (outbound_notifications):** Increments attempts per run, retries up to 5 times. With daily drain, 5 days of Telegram downtime → row marked 'failed', notification permanently lost. **No escalation to any other channel.**
- **Coordinator grounding flow:** Drain fails → coordinator times out at 30 minutes → coordinator marks task 'failed' or re-queues → Colin gets no notification that the timeout happened (because Telegram is still down). Hard stall.
- **Key gap:** No fallback channel (email, Supabase dashboard row, etc.) when Telegram is unavailable. LepiOS is 100% dependent on Telegram for coordinator communication.

---

## 3. Gap List (Ranked by Impact)

### CRITICAL

**G1 — Coordinator grounding flow broken end-to-end (pre-b93658c2)**
- Drain trigger URL wrong → messages delayed 24h → coordinator polling hangs → grounding is impossible
- Blocked on b93658c2 shipping; Phase 4 must verify E2E after that lands

**G2 — purpose-review timeout function never called by any cron or route**
- `checkPurposeReviewTimeouts()` is imported ONLY in tests. Zero production callers.
- Tasks in `awaiting_review` can hang forever; no 72h timeout fires; no escalation
- Confirmed: `app/api/cron/task-pickup/route.ts` only calls `runPickup()` and `runStallCheck()` — no timeout check

**G3 — No E2E test for Strategy A/B/C correlation matching**
- The core webhook routing logic (inbound → outbound_notifications match → response write) has no test covering the full flow
- Any regression here silently breaks coordinator ↔ Colin communication

### HIGH

**G4 — improve_* button handlers completely untested**
- `handleImproveApproveAll()`, `handleImproveDismiss()`, `handleImproveReview()` have zero test coverage
- Routing in webhook.ts:1066-1091 also untested

**G5 — purpose_review callback handler untested**
- `handlePurposeReviewCallback()` routing and action logic untested in webhook context
- Text reply handler (`handlePurposeReviewTextReply()`) untested E2E

**G6 — No fallback when Telegram API is down**
- 100% of coordinator communication depends on Telegram
- 5 failed drain attempts → notification permanently lost, no secondary alert
- Coordinator grounding timeout fires silently with no escalation

**G7 — task-pickup cron is daily (0 0 * * *), not hourly**
- Tasks queued mid-day sit for up to 24 hours before pickup
- This is the root cause of the pre-existing test failure (`task-pickup-100.test.ts:396` expects hourly, actual is daily)
- Not strictly a Telegram issue, but directly impacts how long coordinator-queued tasks wait

### MEDIUM

**G8 — 4096-char message limit not enforced in postMessage()**
- Digest can grow beyond limit as new sections are added
- No truncation, no split-message logic, no pre-send length check
- Today estimated safe (~800–2000 chars), but unguarded

**G9 — Correlation lookup DB errors swallowed silently**
- `webhook.ts:878–882`: if `findMatchingRow()` throws, error is caught and falls through
- No escalation to agent_events or Telegram; could mask production DB outages

**G10 — No runtime callback_data length validation**
- 64-byte limit enforced manually via coordinator.md table, not in code
- Adding a new reason string without checking bytes → silent button failure
- Pre-staged 915d1fee partially addresses this; Phase 4 should add runtime assertion

### LOW

**G11 — Budget command handler (/budget) untested**
- Routing to `handleBudgetCommand()` exists; handler logic not covered by any test

**G12 — Deploy-gate action handlers not integration-tested**
- Button parsing tested; `handleGatePromote/Rollback/Abort()` full execution not tested

**G13 — answerCallbackQuery failures swallowed completely**
- `webhook.ts:843–845`: `.catch()` with no logging; Telegram spinner never clears on failure
- Low user impact but obscures API issues

---

## 4. Pre-Staged Tasks (Do Not Duplicate)

| Task ID | Description | Covers |
|---------|-------------|--------|
| `915d1fee` | BUTTON_DATA_INVALID — callback_data >64 bytes strips buttons | G10 (partially) |
| `b93658c2` | drain_trigger_failed — coordinator self-trigger URL wrong | G1 (partially — fixes URL; E2E still unverified) |

These two tasks are already accepted and queued. Phase 4 work items are designed to complement them, not overlap.

---

## 5. Proposed Phase 4 Work Items

Listed in priority order.

### P1 — Wire purpose-review timeout into task-pickup cron **(Small)**
**Why:** G2 — dead code, tasks hang forever. One-line import + function call in `task-pickup/route.ts`.
**Acceptance:** `checkPurposeReviewTimeouts()` is called from task-pickup cron. Test: mock DB returns an `awaiting_review` task older than 72h → Telegram alert fires + status becomes `review_timeout`.

### P2 — E2E test: Strategy A/B/C correlation matching **(Medium)**
**Why:** G3 — the core inbound routing is completely untested. Regression risk is high.
**Acceptance:** Three test scenarios in `tests/api/telegram-webhook.test.ts`:
1. callback_query with correlation_id JSON → row updated to response_received
2. text reply with reply_to_message.message_id → row matched via Strategy B
3. bare text reply, no match in A or B → Strategy C 24h fallback matches row

### P3 — E2E test: improve_* and purpose_review button handlers **(Medium)**
**Why:** G4, G5 — zero coverage.
**Acceptance:** Tests for:
- `improve_approve_all:{id}` callback → handleImproveApproveAll() called with correct id
- `purpose_review:approve:{id}` callback → task status updated to 'approved'
- `purpose_review:revise:{id}` callback → task status updated to 'awaiting_review'
- Text reply matching a purpose_review task → handlePurposeReviewTextReply() called

### P4 — Digest message length guard **(Small)**
**Why:** G8 — digest grows over time; no protection.
**Acceptance:** `postMessage()` or call-site in digest.ts checks `text.length > 4096` before send. If exceeded: truncates to 4090 chars + appends `…[truncated]`. Test: message with 5000 chars → sends first 4090 + truncation marker.

### P5 — Log correlation lookup errors to agent_events **(Small)**
**Why:** G9 — silent failure masks production DB issues.
**Acceptance:** `findMatchingRow()` catch block logs to agent_events (`action: 'telegram.correlation_error'`, status: 'error', includes error message). Test: DB throws → agent_events insert called with error details.

### P6 — Drain frequency increase: daily → hourly (or per-trigger only) **(Medium)**
**Why:** G1, G7 — daily drain creates 24h message delivery lag for coordinator flow.
**Options:**
- A) Change `vercel.json` drain schedule to `0 * * * *` (hourly). Simple, safe.
- B) Keep daily, rely entirely on coordinator self-trigger (b93658c2). Risk: if self-trigger fails, 24h lag.
- C) Add stall-check T6: if any outbound_notifications row is >1h old with status='pending', fire Telegram alert. (Requires Telegram to be up to alert about pending Telegram.)
**Recommended:** Option A (hourly drain) + rely on b93658c2 self-trigger as primary. Belt + suspenders.

### P7 — Dead-letter escalation for failed notifications **(Medium)**
**Why:** G6 — 5 failed drain attempts → notification permanently lost, no alert.
**Acceptance:** When drain sets `status='failed'` (attempts ≥ MAX_ATTEMPTS), insert row into agent_events (`action: 'notification.dead_letter'`, status: 'error') AND log the dead-lettered payload. Future: secondary channel (email) once wired.

### P8 — Runtime callback_data length assertion in coordinator **(Small — depends on 915d1fee)**
**Why:** G10 — complements 915d1fee, prevents regressions.
**Acceptance:** Before inserting into outbound_notifications with button payload, coordinator validates each callback_data value ≤ 64 bytes and throws a descriptive error if exceeded. Test: button with 65-byte data → error, not silent truncation.

---

## 6. Acceptance Criteria for "Phase 4 Complete"

Phase 4 is complete when all of the following pass:

1. **[ ] G2 resolved:** `checkPurposeReviewTimeouts()` is called from task-pickup cron. A task in `awaiting_review` for >72h triggers status='review_timeout' + Telegram alert.

2. **[ ] G3 resolved:** Tests cover all three correlation strategies (A, B, C) end-to-end with the outbound_notifications row lifecycle.

3. **[ ] G4 + G5 resolved:** Tests cover improve_* and purpose_review button dispatch from webhook through handler, including status updates.

4. **[ ] G8 resolved:** Morning digest truncates gracefully at 4096 chars. Test confirms a 5000-char message sends as 4090 + marker.

5. **[ ] G9 resolved:** Correlation lookup errors log to agent_events, not silently swallowed.

6. **[ ] Drain frequency confirmed:** Drain runs at ≤ 1-hour intervals OR coordinator self-trigger is verified working post-b93658c2 with 15-second delivery guarantee.

7. **[ ] E2E grounding flow verified:** After b93658c2 ships, one complete grounding flow is executed in production: coordinator queues message → drain triggers → Colin taps button → webhook updates row → coordinator reads response. Agent_events shows all four steps.

8. **[ ] F18 compliant:** Phase 4 ships a metric surface: count of messages by flow type per day, delivery latency p50/p95, correlation match rate (A vs B vs C vs no-match). Surfaced in morning_digest or queryable.

9. **[ ] All new code passes `npm test` with no regressions.**

---

## 7. Effort Estimates

| Work Item | Effort | Depends on |
|-----------|--------|------------|
| P1 — Wire timeout into cron | Small (1–2h) | None |
| P2 — E2E correlation tests | Medium (3–5h) | None |
| P3 — improve_* + purpose_review tests | Medium (3–5h) | None |
| P4 — Digest length guard | Small (1–2h) | None |
| P5 — Log correlation errors | Small (1h) | None |
| P6 — Drain frequency hourly | Small (30m) | None |
| P7 — Dead-letter escalation | Medium (2–3h) | P5 |
| P8 — Runtime callback_data assertion | Small (1h) | 915d1fee shipped |
| E2E grounding flow verification (AC #7) | Small (30m run, 1h if bugs found) | b93658c2 shipped |
| F18 metric surface (AC #8) | Medium (2–3h) | P2 |

**Total estimate:** ~16–24h of build work across 10 items, plus verification time after pre-staged tasks ship.

---

## 8. Recommended Build Sequence After Pre-Staged Tasks Ship

**Phase 4 sprint order:**

1. **P6** (drain hourly) — 30 minutes, unblocks everything
2. **P1** (wire timeout) — 2 hours, dead code, immediate value
3. **P4** (digest guard) — 2 hours, defensive, prevents future pain
4. **P5** (log correlation errors) — 1 hour, observability prerequisite for P7
5. **P2** (E2E correlation tests) — 4 hours, highest safety value
6. **P3** (handler tests) — 4 hours
7. **P7** (dead-letter escalation) — 3 hours
8. **P8** (callback_data assertion, after 915d1fee) — 1 hour
9. **E2E grounding verification** — run manually after b93658c2 + P6 ship

**First build target after pre-staged tasks:** P6 + P1 in a single chunk. Both are small, unambiguous, and unblock the highest-risk G1 + G2 gaps immediately.
