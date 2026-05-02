# Acceptance Doc — Reconciliation Engine (Row 11)

Component: #11 · Weight: 10 · Current: 0%
Date: 2026-05-01
Author: Coordinator (draft for Colin review)
Branch: TBD (new from main — create before builder picks up)

---

## Purpose

Connect the five ingestion silos into a single queryable truth:
`orders` (what sold) ↔ `amazon_financial_events` (what Amazon recorded) ↔
`amazon_settlements` (what Amazon paid) ↔ `cogs_entries` (what it cost).

This view is the keystone. Row 17 (anomaly detection) consumes it. The Business
Review trust layer (Sprint 4) needs it to show per-order profit. Without it,
every module is disconnected ingestion.

---

## Input Data Sources — Grounded

All tables verified against `supabase/migrations/` on main.

| Table                     | Migration                        | PK                                     | Join key available                                                |
| ------------------------- | -------------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `orders`                  | pre-existing (0034 harness only) | `id TEXT` = `"{AmazonOrderId}-{ASIN}"` | No `amazon_order_id` column — must derive                         |
| `amazon_financial_events` | 0057                             | `id TEXT` (sha256 hash)                | `amazon_order_id TEXT` (nullable, from ShipmentEvent/RefundEvent) |
| `amazon_settlements`      | 0036                             | `id TEXT` (group_id)                   | FK from `amazon_financial_events.group_id`                        |
| `cogs_entries`            | 0054                             | `uuid`                                 | `asin TEXT`                                                       |
| `cogs_per_asin_view`      | 0054                             | —                                      | `asin TEXT` — use this, not raw `cogs_entries`                    |

**Confirmed columns on `orders`** (from `lib/amazon/orders-sync.ts:OrdersRow`):
`id`, `order_date`, `fiscal_year`, `asin`, `title`, `quantity`, `revenue_cad`,
`marketplace_fees` (always 0), `shipping_cost`, `cogs_cad` (always 0 at sync),
`profit_cad` (null), `status`, `cogs_source` (added in 0054).

**Confirmed columns on `amazon_financial_events`** (from migration 0057):
`group_id`, `amazon_order_id`, `event_type` (ShipmentEvent/RefundEvent/ServiceFeeEvent),
`posted_date`, `gross_contribution`, `fees_contribution`, `refunds_contribution`.

**Not a source for v1:**

- `gmail_invoice_classifications` / `gmail_receipt_classifications` — these classify
  vendor invoices (COGS provenance), not Amazon sale events. Out of scope for row 11.
- `utility_bills` GST columns — not Amazon-related. Separate module.

---

## The Join Key Problem

`orders.id` encodes `"{AmazonOrderId}-{ASIN}"` as a single text PK.
`amazon_financial_events.amazon_order_id` holds only the raw AmazonOrderId.

There is no `amazon_order_id` column on `orders`. Because `asin` is stored as its
own column, the derivation is exact: `left(id, length(id) - length(asin) - 1)`.

Examples:

- `id = "111-1234567-1234567-B0123ABCDE"`, `asin = "B0123ABCDE"` → `"111-1234567-1234567"` ✓
- `id = "111-1234567-1234567-noasin"`, `asin = "noasin"` → `"111-1234567-1234567"` ✓

**Decision:** Add `amazon_order_id` as a PostgreSQL stored generated column in
migration 0062. This avoids recomputing the expression in every join and allows a
B-tree index for efficient lookups.

---

## Reconciliation Grain

`amazon_financial_events` is **order-level**: one ShipmentEvent row per order
(aggregating all items' gross/fees). `orders` is **order-item-level**: one row per
ASIN within an order.

A multi-ASIN order has N rows in `orders` but (typically) 1 ShipmentEvent in
`amazon_financial_events`. Joining at the ASIN level would duplicate the financial
event row N times.

**Decision:** `reconciled_orders_view` is **order-level** — one row per
`amazon_order_id`. Orders are grouped (SUM revenue, SUM cogs) before the join to
financial events.

---

## Schema Proposal

### Migration 0062 — `orders.amazon_order_id` generated column

```sql
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS amazon_order_id TEXT
    GENERATED ALWAYS AS (
      left(id, length(id) - length(asin) - 1)
    ) STORED;

CREATE INDEX IF NOT EXISTS orders_amazon_order_id_idx
  ON public.orders (amazon_order_id);
```

No backfill needed — `GENERATED ALWAYS AS ... STORED` computes and stores the value
for all existing rows at migration time.

RLS: orders table already has its own RLS policy. Generated column inherits it.

Rollback: `ALTER TABLE orders DROP COLUMN IF EXISTS amazon_order_id;`

### Migration 0063 — `reconciled_orders_view`

One row per `amazon_order_id`. Columns:

| Column                    | Source                                                | Notes                                                                |
| ------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| `amazon_order_id`         | `orders.amazon_order_id`                              | Group key                                                            |
| `first_order_date`        | `MIN(orders.order_date)`                              | Earliest purchase date for this order                                |
| `fiscal_year`             | `orders.fiscal_year`                                  | Should be uniform within one order                                   |
| `asin_count`              | `COUNT(DISTINCT orders.asin)`                         | Multi-ASIN orders > 1                                                |
| `quantity_total`          | `SUM(orders.quantity)`                                | Total units across ASINs                                             |
| `orders_revenue_cad`      | `SUM(orders.revenue_cad)`                             | SP-API ItemPrice sum across items                                    |
| `event_gross_cad`         | `SUM(afe.gross_contribution)`                         | NULL if no ShipmentEvent matched                                     |
| `event_fees_cad`          | `SUM(afe.fees_contribution)`                          | NULL if no event matched                                             |
| `event_refunds_cad`       | `SUM(afe.refunds_contribution)`                       | 0 if no RefundEvent                                                  |
| `settlement_id`           | `MIN(s.id)`                                           | FK to amazon_settlements; NULL if unmatched                          |
| `settlement_period_start` | `MIN(s.period_start_at)`                              |                                                                      |
| `settlement_period_end`   | `MAX(s.period_end_at)`                                |                                                                      |
| `cogs_cad`                | Aggregated from cogs_per_asin_view                    | See note below                                                       |
| `has_pallet_cogs`         | `BOOL_OR(cpav.has_pallet_entries)`                    | True if any ASIN has pallet-only pricing                             |
| `revenue_delta_cad`       | `orders_revenue_cad - event_gross_cad`                | NULL if no ShipmentEvent; sign: positive = SP-API > Amazon financial |
| `net_profit_cad`          | `event_gross - event_fees - event_refunds - cogs_cad` | NULL if no event                                                     |
| `match_status`            | Derived                                               | See below                                                            |

**COGS aggregation:** Join `orders` to `cogs_per_asin_view` on `asin`, then
`SUM(cpav.weighted_avg_unit_cost * o.quantity)` across all ASINs in the order.
If any ASIN has no COGS entry, that ASIN contributes 0 to the sum and raises
`has_pallet_cogs` or drives `match_status = 'no_cogs'`.

**match_status enum:**

| Value            | Condition                                                                            |
| ---------------- | ------------------------------------------------------------------------------------ |
| `reconciled`     | Has ShipmentEvent AND COGS known for all ASINs (no pallet, no missing)               |
| `no_event`       | No ShipmentEvent in `amazon_financial_events` for this order_id                      |
| `no_cogs`        | Has ShipmentEvent; ≥1 ASIN has no `cogs_per_asin_view` entry                         |
| `no_cogs_pallet` | Has ShipmentEvent; all COGS present but ≥1 ASIN is pallet-priced (unit cost unknown) |

Note: `no_event` is the expected state for orders that are Pending or that post-date
the financial events backfill window. It is not an error — it is the primary signal
for "work to do."

**View access:** `WITH (security_invoker = true)` — inherits RLS from `orders` and
`amazon_financial_events`. Service_role sees all rows; authenticated sees rows
consistent with their session (currently orders has an authenticated policy;
financial_events does not — service_role only). Builder should verify this at test
time and note which roles can read the view.

---

## Migration Slots

| #    | Content                                           |
| ---- | ------------------------------------------------- |
| 0062 | `orders.amazon_order_id` generated column + index |
| 0063 | `reconciled_orders_view` SQL view                 |

**Verify before building:** `supabase/migrations/` currently ends at `0061_cogs_drop_pallet_mode.sql`. Confirm no open PRs have claimed 0062 or 0063 before starting. There is a pre-existing collision at 0036 (two files both numbered 0036 — do not treat as a precedent for new migrations).

---

## Acceptance Criterion

After migrations 0062 and 0063 are applied:

1. `SELECT * FROM reconciled_orders_view LIMIT 1` returns the expected columns without error.
2. For the most recent settled period (where `fund_transfer_status = 'SUCCESSFUL'` and
   `skipped_event_types IS NULL`): the sum of `event_gross - event_fees - event_refunds`
   from `reconciled_orders_view WHERE settlement_id = $group_id` matches
   `amazon_settlements.gross - fees_total - refunds_total` for that group within $0.01.
3. `SELECT match_status, COUNT(*) FROM reconciled_orders_view GROUP BY match_status`
   returns rows (at least one `reconciled` row where financial events data exists).
4. An order with no COGS entry shows `match_status = 'no_cogs'`, not an error.
5. `SELECT amazon_order_id FROM orders LIMIT 5` returns the derived value correctly (not NULL,
   not equal to the full `id`).

---

## F18 Surfacing Path

**Where Colin sees it:** Row 12 (Reconciliation UI — separate acceptance doc) will
consume this view and surface it. For row 11 completion, the F18 requirement is met
by:

1. A `reconciliation_run` event logged to `agent_events` after each settlement sync
   completes (in the existing `/api/cron/amazon-financial-events` route), with payload:
   ```json
   {
     "group_id": "...",
     "orders_matched": 42,
     "orders_unmatched": 3,
     "settlement_parity_delta": 0.0,
     "match_pct": 0.93
   }
   ```
2. The morning_digest query includes: count of `no_event` orders in the trailing 30
   days — surfaced as "X orders pending settlement match."

No new endpoint needed for row 11. The view is queryable directly; the digest signal
is the F18 delivery mechanism.

---

## Out of Scope for v1

| Topic                                    | Why deferred                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refund reconciliation detail             | `RefundEvent` rows exist in `amazon_financial_events` and are included in `event_refunds_cad`. But matching refunds back to specific returned units (return tracking) requires a returns table that doesn't exist yet. Refund amounts flow into the view correctly; per-unit attribution is v2. |
| FBA reimbursements                       | `AdjustmentEvent` not parsed in v1 (`reimbursements_total_cad` is NULL on all settlements). v2 when `skipped_event_types` reveals non-zero adjustment volume.                                                                                                                                   |
| Multi-settlement orders                  | An order theoretically splits across two settlement periods if it ships at a period boundary. Rare. v1 uses `MIN(settlement_id)` — no data exists to test the split case.                                                                                                                       |
| Gmail invoice ↔ COGS matching            | Vendor-side: did I pay for what I bought? Different reconciliation axis. Out of scope for this component.                                                                                                                                                                                       |
| Historical orders beyond 90-day backfill | The SP-API backfill covers 90 days (PR #43). Orders before that are not in `orders`. No gap-fill in v1.                                                                                                                                                                                         |
| Currency other than CAD                  | All pipelines enforce CAD. No change needed.                                                                                                                                                                                                                                                    |
| Returns / returnless refunds             | No return tracking. Not in scope.                                                                                                                                                                                                                                                               |

---

## Decisions — Resolved 2026-05-01

**Q1 — View vs. materialized view: RESOLVED**
Use a plain SQL view. Materialize only if row 12 (Reconciliation UI) shows measurable
latency at real data volume. No premature optimization.

**Q2 — RLS on reconciled_orders_view: RESOLVED**
View uses `security_invoker = true`. All `/amazon` routes must use `createServiceClient()`
to read financial event columns meaningfully. **Builder gate:** before handoff complete,
grep `app/(cockpit)/amazon/` for any route that uses `createBrowserClient()` or
`createServerComponentClient()` instead of `createServiceClient()`. Block sign-off if
any are found.

**Q3 — revenue_delta_cad column: RESOLVED**
Add `revenue_delta_cad = orders_revenue_cad - event_gross_cad` as a computed expression
in the view. One place, always consistent, available to row 12 without UI-layer math.

---

## 20% Better Over Streamlit Baseline

Streamlit has no reconciliation module. The Loeppky Sheets have COGS in one tab and
orders in another with no automated join. This is 100% net new capability.

Concrete improvements over the Sheets workflow:

1. **Automated join** — no manual VLOOKUP between orders and COGS every month.
2. **Settlement parity check** — know immediately if Amazon's payout matches the
   line-item detail (catches fee calculation errors).
3. **`no_event` signal feeds row 17** — anomaly detection gets a clean list of
   unmatched orders without any manual triage.
4. **Profit at order level** — `net_profit_cad` per order is available to the
   Business Review tile without any intermediate computation.
5. **Pallet COGS flagged explicitly** — `no_cogs_pallet` makes inventory knowledge
   gaps visible rather than silently defaulting to $0 profit.
