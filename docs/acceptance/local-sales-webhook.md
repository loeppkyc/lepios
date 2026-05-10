# Acceptance Doc — Local Sales Webhook Ingestion

Last updated: 2026-05-10
Sprint: backlog (not yet assigned)
Date: 2026-05-01
Branch: new harness task branch (assign at sprint intake)
Status: DRAFT — awaiting Colin promotion to builder

T3 rollup milestone: **Acceptance doc written (25%)**. Builder task not yet assigned (50% gate). PR not merged (100% gate).

---

## Scope

Wire a Stripe webhook endpoint into LepiOS that records every completed
non-FBA sale as a row in a new `local_sales` table. Idempotent delivery.
`channel='bbv'` is the default and only value in v1 — multi-channel routing
deferred to v2.

---

## Pre-build questions — RESOLVED

| # | Question | Resolution |
|---|----------|------------|
| PB-1 | BBV Stripe account: same or separate? | **Same account.** Existing `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in LepiOS Vercel env are correct. No new env vars. Every event reaching this webhook is BBV by definition. |
| PB-2 | Stripe Connect or standalone? | **Standard Stripe (standalone).** No Connect complexity. |
| PB-3 | In-person sales: manual form or Stripe Terminal? | **Manual entry form in v1.** Cash and e-transfer captured by UI form (separate chunk, not part of this webhook). Square debit machine is a distinct future component — see PENDING_ADDITIONS. |
| PB-4 | Event scope? | **`checkout.session.completed` only.** No `payment_intent.succeeded`. |

---

## Grounding

Verified on `origin/main` (fetched 2026-05-01):

- `.env.example` already declares `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET` — vars are planned but no code wired
- `lib/safety/checker.ts:261` — `/webhooks/` is already in `BODY_EXEMPT_ROUTE_PATTERNS`;
  raw-body handling and Zod exemption are pre-wired
- `lib/safety/checker.ts:89–91` — Stripe live key, test key, and webhook secret patterns
  already in the secrets scanner
- **No `stripe` npm package in `package.json`** — must be added
- **No `app/api/webhooks/` route exists** — net-new file
- Highest migration on main: `0061_cogs_drop_pallet_mode.sql`. Gap at `0059` (pre-existing,
  not introduced here). Next clean slot: **`0062`**
- `0054_cogs_entries.sql` confirmed: COGS table is ASIN-keyed, FBA-only, no `sales_channel`
  column — `local_sales` must be a separate table, not a COGS extension

---

## Schema — `local_sales` (migration 0062)

```sql
CREATE TABLE public.local_sales (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id     TEXT        UNIQUE NOT NULL,
  stripe_session_id   TEXT        NOT NULL,
  amount_cents        BIGINT      NOT NULL CHECK (amount_cents > 0),
  currency            TEXT        NOT NULL DEFAULT 'cad',
  channel             TEXT        NOT NULL DEFAULT 'bbv'
                        CHECK (channel IN ('bbv', 'in_person', 'other')),
  product_description TEXT,
  customer_email      TEXT,
  status              TEXT        NOT NULL DEFAULT 'complete',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_event           JSONB       NOT NULL
);

CREATE INDEX local_sales_created_at_idx ON public.local_sales (created_at DESC);
CREATE INDEX local_sales_channel_idx    ON public.local_sales (channel);

ALTER TABLE public.local_sales ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only (BYPASSRLS). Matches 0054 access model.
```

**Column sources (from `event.data.object` — the Checkout Session):**

| Column | Stripe field | Notes |
|--------|-------------|-------|
| `stripe_event_id` | `event.id` | `evt_...` — idempotency key |
| `stripe_session_id` | `session.id` | `cs_...` |
| `amount_cents` | `session.amount_total` | Stripe always integer cents |
| `currency` | `session.currency` | lowercase, e.g. `"cad"` |
| `channel` | hardcoded `'bbv'` | v1 only — all events from this account are BBV |
| `product_description` | `session.line_items.data[0].description` (via expand) → `session.metadata.product_description` → `null` | Builder calls `stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items'] })` inside the handler; primary is first line item description, fallback is metadata field, else null |
| `customer_email` | `session.customer_details.email` | nullable (guest checkout) |
| `status` | hardcoded `'complete'` | only inserted on `checkout.session.completed` |
| `raw_event` | full `event` object | for audit and future replay |

**RLS:**
- INSERT: service_role only (webhook handler)
- SELECT: service_role only (cockpit server components read via service client)
- No UPDATE, no DELETE

---

## Dependency — npm package

Add `stripe` to `dependencies` in `package.json`. Pin to latest stable (`^17.x`).
No other new deps.

---

## Endpoint — `app/api/webhooks/stripe/route.ts`

**Method:** POST only. No GET handler.

**Raw body:** Use `req.text()` — NOT `req.json()`. Stripe signature verification
requires the unparsed body. Safety checker already exempts this path from Zod validation
(`lib/safety/checker.ts:261`).

**Handler flow:**

1. `const rawBody = await req.text()`
2. `const sig = req.headers.get('stripe-signature')`
3. `stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!)`
   — throws `StripeSignatureVerificationError` on bad sig → return 400 `{ error: 'Invalid signature' }`
4. Switch on `event.type`:
   - `'checkout.session.completed'` → proceed to step 5
   - anything else → return 200 `{ received: true }` immediately
5. `const session = await stripe.checkout.sessions.retrieve(event.data.object.id, { expand: ['line_items'] })`
6. Extract fields:
   - `product_description`: `session.line_items?.data[0]?.description ?? session.metadata?.product_description ?? null`
   - all other fields from `session` directly (see schema column sources table)
7. `INSERT INTO local_sales (...) ON CONFLICT (stripe_event_id) DO NOTHING`
8. Return 200 `{ received: true }`

**Auth:** Stripe webhook signature is the sole auth mechanism. No `CRON_SECRET`,
no session cookie, no middleware guard. **No `middleware.ts` exists in this repo**
(confirmed on `origin/main` — `middleware-manifest.json` is empty) — no bypass needed.

**Env vars (already in `.env.example`, already in Vercel — no new vars needed):**
- `STRIPE_SECRET_KEY` — for `new Stripe(process.env.STRIPE_SECRET_KEY!)`
- `STRIPE_WEBHOOK_SECRET` — for `constructEvent`

**Webhook registration:** Register `https://lepios-one.vercel.app/api/webhooks/stripe`
in Stripe Dashboard → Developers → Webhooks. Event: `checkout.session.completed` only.
This is a manual step Colin performs after deploy — not part of the builder's code task.

---

## F17 — Behavioral ingestion justification

`local_sales` is a first-class revenue signal for the life P&L. Every row captures:
sales channel (for channel-mix trends), product description (product-mix signals),
customer email (repeat-buyer detection), and timestamp (time-of-day / day-of-week
patterns). All feed the behavioral ingestion engine.

## F18 — Measurement + benchmark

**Metric:**
```sql
SELECT
  COUNT(*)                              AS sales_count,
  ROUND(SUM(amount_cents) / 100.0, 2)  AS total_cad
FROM local_sales
WHERE created_at > NOW() - INTERVAL '30 days'
  AND channel = 'bbv';
```

**Benchmark:** Stripe Dashboard → Payments → filter last 30 days → gross volume.
Penny-match required.

**Surfacing:** `morning_digest` widget: `"Local sales (30d): {N} sales · ${total} CAD"`.
Colin can ask "how are local sales?" and get a DB-sourced answer, not an estimate.

---

## Acceptance criterion

On a test `checkout.session.completed` webhook delivery (Stripe CLI `stripe trigger
checkout.session.completed` or Stripe Dashboard → Webhooks → Send test event),
the `local_sales` table gains exactly one row; `stripe_event_id` matches the
`evt_...` in the Stripe event; a second delivery of the identical event results in
zero additional rows (idempotent); and invalid signature returns 400.

---

## Grounding checkpoint

Colin sends a real test purchase through BBV Stripe Checkout (test mode).
Checks Stripe Dashboard for the `evt_...` event ID.
Queries `SELECT * FROM local_sales WHERE stripe_event_id = 'evt_...'` — must return one row
with correct `amount_cents` (penny-match to Stripe) and `channel = 'bbv'`.

---

## Out of scope (v1)

- **Square Terminal / Reader** (Colin's debit machine) — separate component;
  see PENDING_ADDITIONS `square_webhook_ingestion`
- **Cash / e-transfer manual entry form** — deferred to v1.1 (separate UI chunk)
- **Refund handling** (`charge.refunded`, `payment_intent.payment_failed`,
  `checkout.session.expired`)
- **Multi-currency conversion** — CAD only; no FX logic
- **Multi-business channel routing** — all events from this Stripe account are BBV;
  metadata-based routing deferred to v2 if a second business lands on this account
- **Life P&L integration tile** — this chunk is ingestion only; surfacing in the
  cockpit is a separate acceptance doc
- **`payment_intent.succeeded`** — Checkout flow only per PB-4
- **BBV website changes** — webhook registered in Stripe Dashboard, not in
  brickandbookvault.ca codebase
