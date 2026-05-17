# B5 — Square Webhook Handler
**task_id:** a327d5c1-3e1f-4029-9054-efef6b746e2f
**authored:** 2026-05-17 by coordinator
**item_id:** B5 (Tier B backlog)

---

## Scope

Create `/api/webhooks/square/route.ts` that verifies Square HMAC-SHA256 webhook signatures and inserts completed payment events into `local_sales`.

**Acceptance criterion:** Given a POST to `/api/webhooks/square` with a valid `x-square-hmacsha256-signature` header and a `payment.completed` event body, within 2 seconds: (a) a row exists in `local_sales` with `square_payment_id` matching `data.object.payment.id`, and (b) a row exists in `agent_events` with `action='square_webhook_received'` and `status='success'`. Invalid signatures must return 403 with no DB write.

---

## Out of scope

- `refund.created` event handling — no active write path in v1; defer to B5-refunds
- Square SDK (`square` npm package) — Node.js `crypto` module is sufficient for HMAC-SHA256
- Dashboard UI or cockpit tile for local_sales — separate task
- Catalog or item-level data from the payment — raw_event captures everything; extraction is a later query-time concern
- Square sandbox environment setup — Colin's responsibility (credentials required)

---

## Files expected to change

| File | Action |
|------|--------|
| `app/api/webhooks/square/route.ts` | CREATE — new webhook handler |
| `supabase/migrations/0235_local_sales_idempotent.sql` | CREATE — idempotent CREATE TABLE IF NOT EXISTS + RLS enable + policy + F24 grant |
| `tests/webhooks/square-webhook.test.ts` | CREATE — unit tests for HMAC verification and handler logic |

---

## Check-Before-Build findings

| What | State | Notes |
|------|-------|-------|
| `local_sales` Supabase table | **WORKING** | Already exists in production with correct schema (10 cols: id, person_handle, square_payment_id, amount_cad, currency, payment_method, location_id, square_created_at, raw_event, inserted_at). No migration file yet — migration 0235 captures it idempotently. |
| `service_role` grants on `local_sales` | **WORKING** | INSERT, UPDATE, DELETE already granted. F24 compliant. |
| RLS policy `local_sales_authenticated` | **WORKING** | `ALL cmd WHERE auth.uid() IS NOT NULL` — existing permissive v1 pattern. Webhook route uses `createServiceClient()` (service_role, bypasses RLS). |
| Node.js `crypto` module (HMAC) | **WORKING** | Already imported in `app/api/n8n-webhook/route.ts`. Pattern: `crypto.timingSafeEqual`. |
| Webhook route pattern | **WORKING** | Three references: `app/api/twilio/webhook/route.ts`, `app/api/n8n-webhook/route.ts`, `app/api/telegram/webhook/route.ts`. |
| `/api/webhooks/` directory | **ABSENT** | Does not exist. Create `app/api/webhooks/square/route.ts`. |

---

## GitHub prior art

| Repo / source | Verdict | Notes |
|---------------|---------|-------|
| `square/square-nodejs-sdk` (npm) | **Skip** | Full SDK is overkill for a single webhook verification. Node.js `crypto` handles HMAC-SHA256 natively. |
| Square official webhook docs (developer.squareup.com) | **Reference** | Signature algorithm: HMAC-SHA256(`SQUARE_WEBHOOK_SIGNATURE_KEY`, `notification_url + raw_body`) → base64 → compare with `x-square-hmacsha256-signature` header using timing-safe comparison. |
| Node.js `crypto.createHmac` + `timingSafeEqual` | **Wrap** | Already used in n8n webhook (`crypto.timingSafeEqual`). Same pattern extended to HMAC-SHA256 body verification. |

---

## External deps tested

**Square webhook endpoint:** Cannot live-test without Colin's Square merchant credentials. The notification URL is deterministic: `https://lepios-one.vercel.app/api/webhooks/square`.

**Signature algorithm** (from Square official docs — builder must verify this matches before coding):
```
signature = Base64(HMAC-SHA256(SQUARE_WEBHOOK_SIGNATURE_KEY, notification_url + raw_request_body))
header: x-square-hmacsha256-signature
```
Note: `raw_request_body` must be the exact bytes received — parse-then-stringify will break the signature.

**Colin must do before grounding checkpoint:**
1. Add `SQUARE_WEBHOOK_SIGNATURE_KEY` to Vercel env vars (from Square Developer Dashboard → Webhooks → Signature Key)
2. Register `https://lepios-one.vercel.app/api/webhooks/square` in Square Developer Dashboard under the merchant's webhook subscriptions
3. Subscribe to at minimum: `payment.completed`

---

## Numeric field definitions

| Field in `local_sales` | Source in Square payload | Conversion |
|------------------------|--------------------------|------------|
| `square_payment_id` | `data.object.payment.id` | Direct string — NOT the event ID |
| `amount_cad` | `data.object.payment.amount_money.amount` | Divide by 100 (Square uses minor units / cents) |
| `currency` | `data.object.payment.amount_money.currency` | Direct string (default 'CAD') |
| `payment_method` | `data.object.payment.source_type` | Direct string (CARD, CASH, WALLET, etc.) |
| `location_id` | `data.object.payment.location_id` | Direct string |
| `square_created_at` | `data.object.payment.created_at` | ISO 8601 → timestamptz |
| `raw_event` | Full request body parsed as JSON | Store entire event for future extraction |

---

## Implementation notes for builder

**HMAC verification (must read raw body before parsing):**
```typescript
// Read raw body FIRST — parsing destroys byte-exact content
const rawBody = await request.text()
const expectedSig = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  ? Buffer.from(
      crypto
        .createHmac('sha256', process.env.SQUARE_WEBHOOK_SIGNATURE_KEY)
        .update(NOTIFICATION_URL + rawBody)
        .digest('base64')
    )
  : null

const receivedSig = request.headers.get('x-square-hmacsha256-signature') ?? ''
const valid = expectedSig
  ? crypto.timingSafeEqual(expectedSig, Buffer.from(receivedSig))
  : false

if (!valid) return NextResponse.json({ error: 'invalid signature' }, { status: 403 })
```

**Idempotency:** Upsert on `square_payment_id` with `ON CONFLICT DO NOTHING`. Square retries webhooks on non-200; idempotency prevents duplicate rows.

**Event filtering:** Only INSERT if `event.type === 'payment.completed'`. Return 200 (no body write) for all other event types — Square requires 200 acknowledgment for all events.

**SQUARE_WEBHOOK_SIGNATURE_KEY absent:** Return 500 and log `agent_events` row with `action='square_webhook_missing_secret'`. Do not fail open.

---

## Grounding checkpoint

Colin triggers a test webhook from Square Developer Dashboard → Webhooks → "Send test event" (payment.completed):

1. `SELECT * FROM local_sales ORDER BY inserted_at DESC LIMIT 1;` — expect one row with square_payment_id from test event, amount_cad > 0
2. `SELECT action, status, meta FROM agent_events WHERE action = 'square_webhook_received' ORDER BY occurred_at DESC LIMIT 1;` — expect status='success', meta.event_type='payment.completed'
3. Replay the same test event — confirm no second row in local_sales (idempotency: ON CONFLICT DO NOTHING)
4. Send a request with a bad signature — confirm 403, no new row in local_sales

Cannot mark complete based on tests alone. Grounding requires a real Square test event reaching the live endpoint.

---

## Kill signals

- Square's test event fails HMAC verification despite correct setup → signature algorithm mismatch — stop, re-read Square docs, do not ship
- SQUARE_WEBHOOK_SIGNATURE_KEY env var creates friction Colin won't maintain → descope to n8n webhook proxy instead

---

## Cached-principle decisions

**Path C auto-approve:** SKIPPED — Twin unreachable in coordinator sandbox (consistent with prior task logs: A8, D5, A6). Cannot verify all confidence scores ≥ 0.80.

**META-C cache-match reasoning:**
- Trigger: greenfield webhook handler with cryptographic body verification + DB insert
- Match: `app/api/n8n-webhook/route.ts` uses `crypto.timingSafeEqual`; `app/api/twilio/webhook/route.ts` uses allowlist auth; Telegram webhook uses shared secret. HMAC-SHA256 body verification is a natural extension of existing patterns.
- No contradictions in this session.
- Reversibility: route file deletable (no downstream deps), migration 0235 is `CREATE TABLE IF NOT EXISTS` + `CREATE POLICY IF NOT EXISTS` (safe to re-apply).
- Confidence: **MEDIUM** — HMAC URL+body concatenation is new in this codebase (not used before). The pattern is well-documented in Square's official docs but has not been exercised in LepiOS. Medium confidence per coordinator.md → **ESCALATE**.
- Outcome: **escalated to Colin** (medium confidence below cache-match threshold; twin unreachable)

---

## Open questions

None unresolvable from first principles. All scope decisions made via Principle 17 (no speculative infrastructure). Refund handling, catalog extraction, and dashboard UI all deferred.

---

## F17 — Behavioral ingestion justification

Every local sale event is ingested into `agent_events` with domain='commerce'. This feeds the behavioral ingestion path for the Money pillar (spend/earn events). Future: aggregate into `money_events` for Quality of Life Index → Money pillar score computation. Active write path to the behavioral engine exists from day 1.

## F18 — Measurement benchmark

- **Metric:** `agent_events WHERE action='square_webhook_received'` count per day
- **Benchmark:** every Square transaction at the desk sale location appears within 30s of payment completion
- **Surface path:** Colin can ask "how many local sales today?" → SQL query on `local_sales` grouped by date
- **Latency benchmark:** webhook delivery < 30s from Square → Vercel → Supabase insert

## F20 — Design system enforcement

No UI in this chunk. Route and migration only. No TSX files — F20 does not apply.
