# Acceptance Doc — Sales Charts (Streamlit → LepiOS port)

**Source:** `streamlit_app/pages/26_Sales_Charts.py` (404 LOC, P1 Low complexity)
**LepiOS target:** `app/(cockpit)/amazon-sales/page.tsx` (sidebar entry "Sales Charts" currently `href: null`)
**Status:** **Blocked on Colin's input** — 4 batched questions below. Once answered, builder can ship in one window.

---

## What Streamlit does today

Single Cockpit page with 7 sections:

1. **KPI cards (5 metrics):** current month sales, current month net, YTD sales, avg/day, best day in window
2. **Daily revenue chart** (3 tabs): bar chart of daily sales + 7d/30d rolling-avg lines; area chart split between SalesOrganic vs SalesPPC; line chart of daily sales vs estimated payout
3. **Monthly bars — prior year** (3 tabs): organic+PPC stacked, gross-vs-net waterfall, gross/net margin %
4. **Actual payouts vs expected** (bar chart pulling from `💰 Payout Register` sheet)
5. **Rolling window comparison** (4 metric cards: 7d / 30d / 60d / 90d totals + per-day avg)
6. **Top/bottom 5 days** in current window
7. **"Sync 90 days of order history" button** — triggers SP-API order pull and writes to `📊 ASIN Sales Log` sheet

**Window selector:** 30d / 60d / 90d / YTD / All — applies to KPI section 1, charts 2, 5, 6.

**Streamlit data sources:**

- `📊 Amazon {YYYY}` sheet — daily rows: `Date, SalesOrganic, SalesPPC, EstimatedPayout` (manually entered or sync-populated)
- `📊 Amazon {YYYY-1}` sheet — monthly rows for prior-year comparison: `DateFrom, SalesOrganic, SalesPPC, EstimatedPayout, COGS, GrossProfit, Expenses, NetProfit, AmazonFees, Refunds`
- `💰 Payout Register` sheet — payouts: `Date Received, Amount Expected ($), Amount Received ($), Difference ($)`

---

## Mapping to LepiOS data (current state)

| Streamlit field               | LepiOS source                                                            | Status                                                   |
| ----------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| Daily TotalSales              | `orders.revenue_cad` SUM by `order_date::date` (marketplace='amazon_ca') | **Only 11 days of data** (Apr 24 – May 4 2026, 157 rows) |
| SalesOrganic / SalesPPC split | None — `orders` table has no organic-vs-PPC tag                          | **Missing data source**                                  |
| EstimatedPayout (daily)       | None directly; could derive from `orders` minus fee estimates            | Approximation only                                       |
| Actual payouts                | `amazon_settlements.net_payout` (44 rows in April)                       | Available, period-based not daily                        |
| Prior-year monthly            | None — no 2025 amazon order data in Supabase                             | **Missing — need backfill or import**                    |
| Per-ASIN sync button          | `/api/cron/amazon-orders-sync` already exists and runs daily             | Replace with cron-status pill, no manual button needed   |

**Existing reusable LepiOS components:**

- `app/(cockpit)/amazon/_components/AmazonDailyChart.tsx` — already does daily bar chart with shadcn/ui Chart (Recharts)
- `app/(cockpit)/amazon/_components/AmazonKpiRow.tsx` — KPI card pattern
- `app/(cockpit)/amazon/_components/AmazonSettlementsPanel.tsx` — payouts pattern

---

## Open questions for Colin (4)

### Q1 — Historical data backfill: how far back?

Streamlit reads from manually-curated `📊 Amazon {YYYY}` Google Sheets going back multiple years. LepiOS's `orders` table starts 2026-04-24 (roughly when SP-API sync was wired). To make the dashboard meaningful we need either:

- **(a)** SP-API backfill to 2025-01-01 (~16 months) — runs once via a backfill script, then ongoing daily cron keeps it current. SP-API has a 90-day report window, but `getOrders` accepts arbitrary date ranges. Cost: a few hours of API time, no token cost (orders endpoint is free).
- **(b)** Import the existing Google Sheets aggregates as a `daily_amazon_aggregates` table — preserves the manual fields (SalesOrganic, SalesPPC) but makes LepiOS dependent on the sheet for history.
- **(c)** Ship with only the data we have — dashboard works for current month + future, prior-year comparison shows "no data" until we accumulate 12 months.

Which one?

### Q2 — Organic vs PPC split: keep or drop?

The Streamlit version splits sales into organic vs PPC ads. That data comes from manual entry in the `📊 Amazon` sheet — Colin (or a script he runs) types them in based on Amazon Advertising reports.

In LepiOS `orders` we don't have this split. To preserve it we'd need:

- **(a)** Pull from Amazon Advertising API (separate auth, separate rate limits)
- **(b)** Manual entry UI in LepiOS (defeats the automation goal)
- **(c)** Drop the Organic vs PPC tab from the v1 port; add later when Advertising API is wired

(c) is the obvious shortest-path. Confirm?

### Q3 — Estimated Payout (daily): how to derive?

Streamlit's `EstimatedPayout` per day comes from manual entry. In LepiOS this isn't directly available. Options:

- **(a)** Use `revenue_cad - marketplace_fees - shipping_cost` from `orders` as the daily proxy
- **(b)** Drop the "Payout vs Sales" tab in the daily chart; rely on the actual-payouts section (settlements) instead
- **(c)** Compute by allocating `amazon_settlements.net_payout` proportionally over the period_start_at → period_end_at days, then matching to the order date

(b) is simplest and avoids a derived metric that may not match reality. Confirm?

### Q4 — Sync button: drop entirely?

Streamlit has a "🔄 Sync Order History (90 days)" button that calls SP-API and writes `📊 ASIN Sales Log`. In LepiOS this is already automated:

- `/api/cron/amazon-orders-sync` runs daily and inserts rows into `orders`
- No manual sync button needed for the daily flow

Drop the button entirely and replace with a small "Last synced: 2h ago • next: 22h" status indicator in the page header? Confirm.

---

## Acceptance criteria (assuming Q1=c, Q2=c, Q3=b, Q4=drop)

If Colin picks the shortest path on all four, the v1 ship is:

**Route:** `app/(cockpit)/amazon-sales/page.tsx` (add as new sibling of `/amazon`; sidebar item flips from `null` to `/amazon-sales`).

**Sections:**

1. **KPI strip (4 metrics):** This month sales, this month net (from settlements), avg/day (window-scoped), best day (window-scoped). Drop the YTD if Q1 limits us to current-period data.
2. **Daily revenue chart** (1 tab only — no Organic/PPC split, no Payout overlay): bar chart of daily order revenue + 7d/30d rolling-avg lines. shadcn/ui Chart + Recharts.
3. **Monthly bars** — only renders if Q1 backfill provides ≥6 months of data; otherwise shows "Backfill 2025 to enable" placeholder card.
4. **Actual payouts** — `amazon_settlements.net_payout` over time, bar chart.
5. **Rolling window comparison** — 7d / 30d / 60d / 90d totals + per-day avg.
6. **Top/bottom 5 days** in window.
7. **(Drop section 7 — sync button)**

**Window selector:** 30d / 60d / 90d / YTD / All — radio group at top of page.

**Data sources:**

- `orders` table: daily revenue aggregation (`SUM(revenue_cad) GROUP BY order_date::date`)
- `amazon_settlements`: actual payouts
- Possibly a new `amazon_orders_daily` materialized view for performance if the daily SUM gets slow

**API:**

- `GET /api/amazon-sales?window=30d|60d|90d|ytd|all` — returns the full payload (KPIs, daily series, rolling metrics, top/bottom days, settlements). Single round-trip.
- Authenticated (per F-N5 invariant: `auth.getUser()` required since this uses service role for the `orders` query if we bypass RLS).

**Tests:**

- API: window filtering correctness, empty-data path, top/bottom selection
- Architecture test (already exists): F-N5 auth coverage will catch any regression

**Estimated build time once Q1–Q4 are answered:** 2-3 hours (one builder window).

---

## What Colin should answer

Quickest review path — reply with letters/yes-no:

- **Q1:** a / b / c (or describe a different plan)
- **Q2:** confirm "drop Organic/PPC for v1"? y / n
- **Q3:** confirm "drop Payout-vs-Sales daily overlay"? y / n
- **Q4:** confirm "drop manual sync button, show cron status pill"? y / n

If all four go shortest-path: this acceptance doc IS the spec — builder can pick it up directly.
