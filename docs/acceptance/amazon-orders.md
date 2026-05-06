# Acceptance Doc — Amazon Orders (fresh port)

**Source:** `streamlit_app/pages/60_Amazon_Orders.py` (~898 LOC, P1 Med complexity)
**LepiOS target:** `app/(cockpit)/amazon-orders/page.tsx` (NEW route — does not exist)
**Status:** **2 of 4 Streamlit tabs already covered elsewhere in LepiOS. This doc is for the 2 remaining tabs.**

---

## What Streamlit does (4 tabs)

1. **Order Sync** — manual SP-API pull or CSV upload to `📋 Amazon Orders` sheet
2. **Order Dashboard** — KPIs (orders, revenue, FBA fees, net), revenue chart, top sellers, status breakdown
3. **Profit Calculator** — per-ASIN profit (Revenue − FBA Fees − COGS), with margin, sortable, alerts on below-cost
4. **Payout Reconciliation** — match Amazon settlements to bank deposits (CSV upload + manual match)

---

## Coverage check — what's already in LepiOS

| Streamlit tab                | LepiOS coverage                                                           | Verdict                                                                         |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Tab 1: Order Sync            | `/api/cron/amazon-orders-sync` (daily, automated, supports `?backfill=N`) | **Covered** — drop manual button entirely; show "last synced" pill              |
| Tab 2: Order Dashboard       | `/amazon` page has KPI row, daily chart, top sellers, status breakdown    | **Mostly covered** — minor gaps (returns rate metric, configurable granularity) |
| Tab 3: Profit Calculator     | None                                                                      | **MISSING** — fresh build                                                       |
| Tab 4: Payout Reconciliation | None (only sync from SP-API; no bank matching)                            | **MISSING** — fresh build                                                       |

So this doc focuses on **Tabs 3 + 4**, plus minor enhancements to existing `/amazon` for parity with Tab 2.

---

## What this doc does NOT propose

- Reproducing the manual Order Sync UI (Tab 1) — automated cron is better
- Duplicating the existing `/amazon` Order Dashboard
- A new `/amazon-orders` route as a 4-tab clone — that fragments the Amazon experience

**Proposed structure:** add Tab 3 (Profit Calculator) and Tab 4 (Payout Reconciliation) **as new sections on the existing `/amazon` page**, OR as a sibling `/amazon/profit` and `/amazon/reconciliation` — see Q1.

---

## Tab 3 acceptance criteria — Profit Calculator

### AC3.1 — Per-ASIN profit table

New section on `/amazon` (or new route `/amazon/profit`):

| ASIN | Title | Units | Revenue | FBA Fees | Unit Cost | Total COGS | Profit | Margin % |
| ---- | ----- | ----- | ------- | -------- | --------- | ---------- | ------ | -------- |

**Data sources:**

- `orders` table grouped by `asin` (sum revenue_cad, sum quantity)
- `cogs_per_asin_view` (migration 0054) for `weighted_avg_unit_cost`
- FBA fees: **deferred** — `orders.marketplace_fees` is always 0 in current schema. Real fees are in `amazon_financial_events` (service_role only). For v1, show fees column as "—" with footnote "FBA fees aggregated at settlement level; see Payouts page". Future: backfill fees onto orders via a view join.

**Window:** date range picker, default last 90 days.

**Sort:** by Profit, Revenue, Margin %, Units (toggleable asc/desc).

**Below-cost alert:** red badge + expandable list when any row has Profit < 0.

### AC3.2 — API

`GET /api/amazon/profit?from=YYYY-MM-DD&to=YYYY-MM-DD` returns:

```ts
{
  items: (Array<{ asin; title; units; revenue; totalCogs; unitCost; profit; marginPct }>,
    belowCostCount,
    totalProfit,
    totalRevenue)
}
```

Auth: `auth.getUser()` required (F-N5).

### AC3.3 — Tests

- API: window filtering, ASINs without COGS (returns null cost, profit calculation skips), empty range
- Component: sort toggles, below-cost alert appears when count > 0
- Architecture: F-N5 auth coverage (existing test will catch)

---

## Tab 4 acceptance criteria — Payout Reconciliation

### AC4.1 — Bank deposits table (new schema)

New migration `0XXX_bank_deposits.sql`:

```sql
CREATE TABLE bank_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_date date NOT NULL,
  amount_cad numeric(12,2) NOT NULL,
  bank_reference text NOT NULL,
  account_label text NULL,
  notes text NULL,
  matched_settlement_id text NULL REFERENCES amazon_settlements(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bank_deposits_date_idx ON bank_deposits(deposit_date);
CREATE INDEX bank_deposits_settlement_idx ON bank_deposits(matched_settlement_id);
```

RLS: enable, owner-scoped policy (or service-role only — see Q2).

### AC4.2 — CSV upload + parse

`POST /api/bank-deposits/import` accepts a CSV with columns matching common Canadian bank exports (TD, RBC). Strategy:

- For v1, accept a single canonical format: `Date, Description, Amount` (no negative amounts — credits only — no withdrawals)
- Parse → upsert by `(deposit_date, amount_cad, bank_reference)` to dedupe
- Return: `{ imported: N, duplicates: M, parseErrors: [...] }`

For non-canonical formats: defer to a future "Bank statement parser" task (probably AI-assisted, like `/api/expenses/import`).

### AC4.3 — Reconciliation UI

New section on `/amazon` (or `/amazon/reconciliation`):

**Two columns side-by-side:**

Left — **Unmatched settlements** (`amazon_settlements` where `id NOT IN (SELECT matched_settlement_id FROM bank_deposits WHERE matched_settlement_id IS NOT NULL)`):

- Date, period range, net_payout, status pill

Right — **Unmatched bank deposits** (`bank_deposits` where `matched_settlement_id IS NULL`):

- Date, amount, reference, account, notes

**Match action:** click a settlement, then click a bank deposit → confirm dialog → updates `bank_deposits.matched_settlement_id`. Unmatch button reverses.

**Auto-match suggestion (optional, P2):** for each unmatched settlement, find bank deposits where `|amount - net_payout| < $1` AND `deposit_date` within ±5 days of `period_end_at`. Highlight as "Suggested match" with one-click confirm.

### AC4.4 — Tests

- API: CSV import happy path, duplicate detection, parse errors (malformed dates, non-numeric amounts)
- API: match endpoint (PATCH /api/bank-deposits/[id]/match), unmatch endpoint
- Component: drag/click match flow, suggested match highlighting

---

## Tab 2 minor parity gap-fills (`/amazon` enhancements)

These are small additions to bring the existing Order Dashboard to full Streamlit parity:

### AC2.1 — Returns rate metric

Add KPI card to existing `AmazonKpiRow.tsx`:

- Returns rate = `count(orders WHERE status LIKE 'Return%') / count(orders WHERE status LIKE 'Shipped%') × 100`
- 30d window
- Period-over-period delta vs prior 30d

### AC2.2 — Configurable chart granularity (P3, optional)

`AmazonDailyChart.tsx` currently shows daily. Add a Daily / Weekly / Monthly toggle.

---

## Open questions for Colin

- **Q1 (drives routing structure):** Tab 3 + 4 placement —
  - **A:** Add as new sections on existing `/amazon` page (single page, more scrolling)
  - **B:** Create sibling routes `/amazon/profit` and `/amazon/reconciliation` (cleaner separation)
  - **C:** New consolidated `/amazon-orders` page that consumes both sections
    Recommendation: **B**.
- **Q2 (RLS scope):** `bank_deposits` table — service-role only (admin-grade), or owner-scoped? Bank data is sensitive but in LepiOS there's only one user (Colin). Recommendation: owner-scoped via RLS, owner = `colin` person_handle.
- **Q3:** Auto-match suggestions (AC4.3 optional) — ship in v1 or defer? Recommendation: defer to v2; manual match works for low volume.
- **Q4:** FBA fees column on Profit Calculator — show "—" with note (per AC3.1), or build the backfill view immediately? Recommendation: defer the backfill; add fees to a v2.
- **Q5:** Returns rate (AC2.1) — `status LIKE 'Return%'` is the right pattern? SP-API may use specific values like `'PartiallyShipped'` differently. Verify with a quick query against current `orders` data before shipping.

---

## Estimated build time

- **AC3 (Profit Calculator):** ~6 hours
- **AC4 (Payout Reconciliation):** ~10 hours (migration + import + UI + match flow)
- **AC2.1 (Returns rate KPI):** ~1 hour
- **AC2.2 (Granularity toggle, optional):** ~2 hours

**Total:** ~17–19 hours = 3 builder windows. Recommend splitting into 2 docs: Profit Calculator (small, ~6h) and Payout Reconciliation (~10h).

---

## What Colin should answer

- Q1: A / B / C (recommend B)
- Q2: service-role / owner-scoped (recommend owner-scoped)
- Q3: ship auto-match in v1 / defer to v2 (recommend defer)
- Q4: "—" placeholder / build backfill (recommend placeholder)
- Q5: confirm returns rate query pattern is correct
