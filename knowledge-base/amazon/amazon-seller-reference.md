# Amazon Seller Reference — LepiOS

Operational knowledge for building Amazon seller features. Accumulated from Streamlit prototype
(loeppkyc/Loeppky) and Sprint 4 SP-API integration work. Check this file FIRST for any Amazon
feature before reading SP-API docs or writing code.

---

## Amazon SP-API Behavior

### Pending orders — revenue unavailability

SP-API Orders endpoint (`GET /orders/v0/orders`) returns Pending orders in the order list
alongside Unshipped/Shipped/Canceled. However, revenue fields degrade rapidly after placement:

- **Same-day Pending orders:** `orderItems` call often returns items WITH `ItemPrice.Amount`
  populated. Revenue is accessible. Use `ItemPrice.Amount` (pre-tax).
- **Pending orders >~1 day old (B2B/net-30 pattern):** `orderItems` returns an empty array
  — no `ItemPrice`. The order object's `OrderTotal.Amount` is also absent. No revenue field
  is accessible via the Orders endpoint for these orders.
- **Fallback order:** Try `ItemPrice` from orderItems → fall back to `OrderTotal.Amount` on
  the order object → if both are absent, revenue is genuinely unavailable. Show pending units
  (which come from order-level fields `NumberOfItemsShipped + NumberOfItemsUnshipped`) even
  when revenue is unavailable.
- **Resolution:** SP-API Finances API has invoice-level data for all orders regardless of age
  or status. Pending order revenue gaps will be resolved by the Finances integration.

### Order status semantics

SP-API returns 5 statuses: `Unshipped`, `PartiallyShipped`, `Shipped`, `Canceled`, `Pending`.

- **Confirmed (for revenue purposes):** Unshipped + PartiallyShipped + Shipped + Canceled
  (yes, Canceled is confirmed — the order was placed; it just didn't ship)
- **Pending:** Not yet financially committed. Revenue often unavailable. Include as sub-line
  alongside confirmed numbers; do NOT aggregate into confirmed totals.
- **Seller Central Business Reports** attribute orders to their CREATION DATE regardless of
  current status. SP-API returns CURRENT status at query time. This is the source of all
  SC vs. LepiOS discrepancies involving Pending orders.

### Revenue fields — use ItemPrice, not OrderTotal

- `ItemPrice.Amount` (from `orderItems` call): pre-tax item price. The correct revenue field.
- `OrderTotal.Amount` (on the order object): includes provincial tax. Used only as a fallback
  for pending orders when `ItemPrice` is unavailable. Do NOT use for confirmed orders.
- Tax grounding failure (Sprint 4 Chunk A): BC buyer at 12% PST inflated `OrderTotal` by $4.20
  vs Seller Central "Product Sales". `ItemPrice.Amount` matched SC to the penny.

### Rate limits — 429 QuotaExceeded

`GET /orders/v0/orders/{id}/orderItems` has per-order rate limits. Fetching orderItems for
10+ orders in parallel risks 429 QuotaExceeded. Observed: Sprint 4 Chunk C session hit 429
when both Today panel and RecentDays table were re-fetching orderItems simultaneously.

Mitigations:
- Use `export const revalidate = 900` (15-min ISR) on route handlers — amortizes the cost
- Fetch order-list requests sequentially (one per day window), then orderItems in parallel
  within each window (not across all 10 days at once)
- Stagger `revalidate` windows between routes if multiple routes hit orderItems

### Streamlit reference: `get_live_orders_for_date()`

`loeppkyc/Loeppky` → `streamlit_app/utils/amazon.py` lines ~1194–1298.

Key pattern for pending revenue:
```python
# Tries ItemPrice from orderItems; tracks pending_has_prices boolean
# Falls back to showing count only ("N pending") when prices unavailable
# Three display scenarios: prices available / no prices / no pending
```

`Business_Review.py` lines ~1887–1955 shows the three-tier display logic. Reference before
building any new Amazon revenue display feature.

### Vercel env scoping — SP-API creds are Production-only

SP-API credentials (`AMAZON_SP_*`) are scoped to Production environment in Vercel. Preview
deployments return 503 from `spApiConfigured()`. Cannot ground business-review features on
preview URLs. Workflow: merge to main → wait for production READY → ground against
`lepios-one.vercel.app`. Do NOT add SP-API creds to Preview (would hit real API on every PR).

### ISR cache does not clear on deploy

`export const revalidate = 900` on route handlers means Vercel serves a cached response for
up to 15 minutes after a new deploy. After deploying a route fix, wait for the cache to expire
(check `X-Vercel-Cache: MISS`) before grounding. The `fetchedAt` field in the response body
shows when the cached response was actually built.

---

## Amazon Payment / Reserve Policy

### Account Level Reserve

Amazon holds a rolling reserve against the account balance:
- Standard: "Hold until delivered + 7 days" — most orders released ~7 days post-delivery
- B2B/net-30: Orders can stay Pending for 10–30 days; payment not settled until invoice paid
- Reserve appears in SC "Total Balance" but is subtracted from "Net Proceeds"

### SC views disagree by design

Multiple Seller Central views show different numbers — this is intentional, not a bug:
- **Total Balance:** Gross receipts minus all holds/reserves
- **Net Proceeds:** Gross sales minus Amazon fees minus Reserve
- **Product Sales (Business Reports):** All orders on creation date, pre-tax, regardless of status

Identity: `Net Proceeds = Gross Revenue - Amazon Fees - Reserve`

Reserve is not exposed via SP-API until the settlement group closes. Use Finances API for
settled amounts; Orders API for real-time but approximate figures.

### B2B/net-30 orders

Amazon B2B orders with net-30 payment terms:
- Order placed → stays `Pending` until invoice paid (can be 10–30+ days)
- SP-API returns order in Pending status throughout
- No ItemPrice or OrderTotal exposed while Pending
- Revenue shows up in SC Business Reports on creation date immediately
- LepiOS gap: cannot show pending revenue for these orders via Orders endpoint

---

## Streamlit Reference

The `loeppkyc/Loeppky` repo is the source of truth for all predecessor LepiOS solutions.
**Check Streamlit first for any Amazon feature before writing new code.**

Key files:
- `streamlit_app/utils/amazon.py` — all SP-API client logic (orders, orderItems, repricing,
  inventory, FBA fees). Reference for field names, error handling, pagination patterns.
- `streamlit_app/Business_Review.py` — daily/weekly/monthly revenue display, pending order
  handling, SC matching patterns.
- `streamlit_app/utils/keepa.py` — Keepa token management, deal scan, OOS analysis.

Streamlit anti-patterns explicitly NOT ported to LepiOS:
- `revenue * 0.35` or `revenue * 0.65` as fee/payout estimate — banned. Show `—` instead.
- `OrderTotal.Amount` for confirmed revenue — includes tax. Use `ItemPrice.Amount`.

---

## Amazon Reliability

Amazon is not a reliable partner. Treat every SP-API behavior as potentially changing.

- **SC UI != SP-API reality.** Always cross-check. SC may show data SP-API doesn't expose yet
  (or vice versa). Never assume the two sources agree.
- **Policies change without notice.** Reserve policies, fee structures, B2B terms — all subject
  to unilateral change. Build displays that show actual numbers, not formulas based on policy.
- **Appeals are opaque.** Account health issues, policy violations, listing suppressions — the
  appeal process has no predictable timeline or outcome. Document incidents; don't build
  automation that depends on appeal outcomes.

### Placeholder sections (fill as features are built)

- **Repricer:** Streamlit has a working repricer using Buy Box price signals via SP-API.
  Reference `streamlit_app/utils/amazon.py` repricing functions before rebuilding.
- **Account health:** SC Account Health dashboard metrics not exposed via SP-API. Screen
  scrape or manual monitoring only.
- **FBA fees:** `GetMyFeesEstimate` endpoint. Per-ASIN fee structure changes quarterly.
  Cache aggressively.
- **MCF (Multi-Channel Fulfillment):** Separate API endpoints. Not in Streamlit prototype.
- **Brand Registry / A+ content:** UI-only, no API.
- **Advertising API:** Separate auth flow (Login with Amazon). Distinct from SP-API credentials.
