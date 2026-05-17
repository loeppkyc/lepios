# Sprint 8–10 Plan — LepiOS

**Prepared:** 2026-05-17  
**Context:** Sprints 1–7 complete. Harness 100%. GPU Day 99.2%. Sprint 7 landed bookkeeping
bulk-approve (Chunk D), net worth auto-sync (Chunk F), hit-lists scan results (Chunk E),
retail arb engine (Chunk arb-engine), and retail monitor StockTrack port. The
working name "BR Tier 3, Shipment Manager, Reporting" is addressed across Sprints 8–9.

---

## Current State Audit

### Business Review — What "Tier 3" Means

The existing `/business-review` page has four panels (Sprints 4–5):
- **Tier 1 (Chunk A):** Today/Yesterday confirmed-order panels (orders, revenue, units) — live
- **Tier 2 (Chunk B):** What You're Owed panel (pending payouts from settlements) — live
- **Tier 2 (Chunk C):** Recent Days Table (trailing 7-day revenue table) — live
- **Tier 2 (Chunk D):** Statement Coverage Grid (bank/CC statement presence by month) — live

**What Tier 3 is missing:**
1. **Margin/profit on the Business Review page** — orders and revenue are shown, but no COGS
   subtraction. Colin sees revenue, not net. The bookkeeping module (JEs, pending_transactions)
   and `monthly-pnl` page exist — Business Review could pull the current-month margin figure.
2. **Weekly/monthly trend panels** — the Recent Days Table shows 7 rows but there is no
   week-over-week or month-to-date comparison. No sparkline or pacing indicator on the
   Business Review landing page.
3. **Payout field is hardcoded `"—"`** — the code comment says "Full payout estimate in
   Sprint 5"; this was never delivered. The Payouts page exists separately but the Business
   Review panel still says `—`.
4. **No daily/weekly digest summary** — the morning_digest sends Telegram alerts but there is
   no on-screen "week so far" recap tied to the BR page.

### Shipment Manager — What Exists vs. What's Missing

Sprint 6 Chunk D shipped the `/batches` page (FBA Batch Manager): create named batches,
add scanned items to them, view batch detail with SKU/status. This is the foundation.

**What "Shipment Manager" (`href: null` in nav) still needs:**
- The nav entry points to `null` — there is no `/shipment-manager` route yet
- Chunk D explicitly scoped OUT: FBA inbound shipment creation, label generation (FNSKU PDF),
  carrier tracking numbers
- The Streamlit reference is `pages/30_Shipment_Manager.py` — studied in Sprint 6 plan but not
  yet ported
- A full Shipment Manager would wire the batch → SP-API inbound shipment plan → FNSKU labels →
  box count/weight → carrier booking confirmation

### Reporting — What Exists

| Page | Status | Gap |
|---|---|---|
| `/monthly-pnl` | Live | Shows P&L by month; no year-to-date aggregate or comparison column |
| `/bookkeeping-hub` | Live | Hub for reconcile, QB export, import |
| `/cogs` (Category P&L) | Live | COGS by category |
| `/balance-sheet` | Partial | Referenced in net-worth; Add/Delete UI added in Sprint 7 (Chunk F) |
| `/monthly-close` | Live | Monthly close checklist |
| `/gst-return` | Live | GST filing data |
| `/annual-review` | Live | Annual review page |
| `/tax-centre` | Live (partial) | Missing: auto-pull of GST owing, T2 income estimate |
| Monthly P&L — YTD rollup | Missing | No cumulative YTD view across months |
| Amazon-integrated P&L | Missing | Monthly P&L does not pull from amazon_settlements automatically |

### Nav Audit — Items with `href: null`

Total unbuilt nav items: **43**

High-priority for revenue/money:
- Shipment Manager (Amazon & Inventory section)
- Repricer (Amazon & Inventory)
- Amazon Orders (Amazon & Inventory) — note: payouts + orders-sync exist but no `/amazon-orders` route
- Inventory Spend (Amazon & Inventory)
- Lego Vault (Deals & Sourcing)
- Keepa Intel (Deals & Sourcing)
- Retail HQ (partially built — has ArbEngineTab and RetailHQPage)
- Tax Return (Accounting)
- eBay Listings (Marketplace)
- Marketplace Hub (Marketplace)
- Trading Journal (Dashboard) — gated on AIPE Chunk B
- Sports Betting (Dashboard) — gated on AIPE Chunk C
- Retirement (Household)
- Cash Forecast — already exists at `/cash-forecast` (nav discrepancy — fix)

---

## Sprint 8 — Business Review Tier 3 + Shipment Manager Foundation

**Theme:** Close the business review gaps that make the daily dashboard incomplete.
Wire real payout data into BR, add week/month pacing, build the Shipment Manager
page that wires the existing `/batches` foundation to SP-API inbound shipments.

**Kill criterion:** Colin can open `/business-review` and see today's margin (not just
revenue), a week-to-date pacing bar, and his payout estimate. He can open
`/shipment-manager` and create a real FBA inbound shipment plan from an existing batch.

### Chunk A — BR Payout Wire + Margin Line (M)

**What:** Replace the hardcoded `—` payout field in `TodayYesterdayPanel` with a live
estimate from `amazon_settlements` (same query the Payouts page uses). Add a "Margin"
stat row showing current-month gross profit from the `monthly_pnl` data source
(revenue minus COGS from `journal_entries` approved this month).

**Files:** `TodayYesterdayPanel.tsx`, `app/api/business-review/today-yesterday/route.ts`
(add payout_estimate to response), new `GET /api/business-review/margin-mtd` route
reading approved JEs for current month.

**Acceptance:** Today panel shows "Payout" with a real dollar figure matching the Payouts
page estimate (within $5 due to timing). Margin MTD shows a number (can be $0 if no JEs
approved yet). No regression on existing order/revenue counts.

**Migration:** None. Reads existing `amazon_settlements` and `journal_entries`.

**Task count:** 1 chunk, ~2–3h build.

---

### Chunk B — BR Week-to-Date Pacing Panel (S)

**What:** Add a new "This Week" panel between Yesterday and Recent Days Table. Shows:
orders this week (Mon–today), revenue this week, vs. last week same period (comparison
sub-line), and a pace indicator ("on track for $X this week at current rate").

**Files:** new `WTDPanel.tsx` component, `app/api/business-review/wtd/route.ts`,
minor update to `business-review/page.tsx`.

**Acceptance:** Panel loads, shows correct week boundaries (Mon–Sun, Edmonton time),
comparison vs prior week is within $10 of what you'd compute manually from the
Recent Days Table.

**Migration:** None.

**Task count:** 1 chunk, ~2h build.

---

### Chunk C — Shipment Manager Page (L)

**What:** Build `/shipment-manager` as a full page that reads from the existing
`fba_batches` / `fba_batch_items` tables (Sprint 6 Chunk D). For each open batch,
allow Colin to:
1. Review items in the batch (already in `/batches/[id]`) — link through
2. Click "Create Shipment Plan" → call SP-API
   `POST /fba/inbound/v0/plans` with the batch items
3. View the returned ShipmentId + DestinationFulfillmentCenterId
4. Mark batch items as `shipped` once confirmed

**Scope boundary:** This chunk does NOT generate FNSKU labels (PDF generation is a
separate chunk). It does the SP-API inbound plan creation and surfaces the shipment ID.

**Files:** new `app/(cockpit)/shipment-manager/page.tsx`,
`app/(cockpit)/shipment-manager/_components/ShipmentManagerClient.tsx`,
`app/api/shipment-manager/create-plan/route.ts` (calls SP-API inbound plans endpoint),
update `CockpitSidebar.tsx` to wire `href: '/shipment-manager'`.

**Acceptance:** Colin can select an open batch, click "Create Shipment Plan", and see
a real Amazon ShipmentId returned (or a clear error if SP-API rejects the request).
Sidebar nav item becomes a working link.

**Migration:** Add `shipment_plan_id` and `shipment_status` columns to `fba_batches`.

**GitHub prior art check required:** Look for SP-API inbound v0 TypeScript wrappers
before building the API call from scratch.

**Task count:** 1 chunk, ~4h build.

---

### Chunk D — FNSKU Label Generator (M)

**What:** For items in a batch with `amazon_listing_id` (they have been listed), generate
FNSKU label PDFs. Call SP-API `GET /fba/inbound/v0/labels` with the ShipmentId from
Chunk C. Display labels as a downloadable PDF or a print-friendly page.

**Depends on:** Chunk C (ShipmentId required).

**Files:** `app/api/shipment-manager/labels/route.ts`,
`app/(cockpit)/shipment-manager/_components/LabelPrintView.tsx`.

**Acceptance:** Colin can click "Print Labels" on a shipment and download a PDF with
FNSKU labels for all items in the shipment.

**Migration:** None.

**Task count:** 1 chunk, ~2h build.

---

### Sprint 8 Summary

| Chunk | Title | Size | Depends on | Revenue/money link |
|---|---|---|---|---|
| A | BR Payout Wire + Margin | M | none | Direct — daily payout visibility |
| B | BR Week-to-Date Pacing | S | none | Pacing awareness drives sourcing decisions |
| C | Shipment Manager Page | L | Sprint 6 Chunk D (batches) | Enables FBA shipments without Seller Central |
| D | FNSKU Label Generator | M | Chunk C | Eliminates manual label workflow |

**Total estimate:** 4 chunks, ~10–11h build time, parallelizable (A+B in one worktree,
C+D in sequence in a second worktree after C merges).

---

## Sprint 9 — Reporting Tier 2: YTD P&L + Amazon Integration + Tax Centre

**Theme:** Make the reporting layer actually useful for financial decisions. Currently
Monthly P&L shows individual months but has no cumulative view, no comparison column,
and is disconnected from Amazon settlement data. Tax Centre exists but is mostly manual.

**Kill criterion:** Colin can see YTD profit/loss for 2026 in one screen, with Amazon
revenue auto-populated from settlements. The Tax Centre shows a live GST owing estimate
he can use to set aside the right amount before filing.

### Chunk A — Monthly P&L: YTD Column + Prior Year Comparison (M)

**What:** Add a "YTD 2026" column to the Monthly P&L table showing cumulative revenue,
COGS, and profit from Jan 2026 to current month. Add a "2025 full year" summary row
at the bottom for comparison. The existing data source (`journal_entries`) supports this —
it is a query change, not a schema change.

**Files:** `MonthlyPnlPage.tsx`, `app/api/monthly-pnl/route.ts` (add ytd_totals
and prior_year_totals to response).

**Acceptance:** YTD column sums match what you get adding the individual monthly profit
figures. Prior year total row shows 2025 full-year numbers.

**Migration:** None.

**Task count:** 1 chunk, ~2h build.

---

### Chunk B — Amazon Settlement Auto-Import to Monthly P&L (M)

**What:** The Monthly P&L currently relies entirely on approved `journal_entries` for
revenue. Amazon revenue (from `amazon_settlements`) is only captured when Colin runs
the bookkeeping reconcile flow. This chunk adds an "Amazon Revenue" row to the Monthly
P&L that reads directly from `amazon_settlements` (by `period_end_at` month), so the
revenue is always current even before reconcile runs.

Show two sub-lines: "Confirmed (JE)" and "From Settlements" — Colin can see both and
verify they converge after reconcile.

**Files:** `MonthlyPnlPage.tsx`, `app/api/monthly-pnl/route.ts`.

**Acceptance:** The Amazon row in the P&L for any month matches the sum of
`amazon_settlements.net_payout` WHERE `fund_transfer_status='Succeeded'` for that
period within $10 (the gap being timing differences in JE creation).

**Migration:** None.

**Task count:** 1 chunk, ~2–3h build.

---

### Chunk C — Tax Centre: Live GST Owing Estimate (M)

**What:** The `/tax-centre` page exists but relies on manual input. This chunk wires a
live GST owing estimate: reads approved `journal_entries` where `gst_rate > 0` for
the current GST filing period, computes GST collected (from revenue JEs) minus GST paid
(from expense JEs with GST), shows the net owing.

Also adds a "Set Aside" recommendation: "Based on this estimate, you should have
$X in your GST account."

**Files:** `app/(cockpit)/tax-centre/` (study existing page first),
`app/api/tax-centre/gst-estimate/route.ts` (new).

**Acceptance:** GST estimate for a known quarter (e.g. Q1 2026) matches what Colin
manually computed from QBO to within $50. "Set Aside" recommendation shows on page.

**Migration:** None (reads existing `journal_entry_lines`).

**Task count:** 1 chunk, ~3h build.

---

### Chunk D — Inventory Spend Page (S)

**What:** Build `/inventory-spend` (currently `href: null` in nav). Shows how much
Colin has spent on inventory this month, this quarter, YTD. Source: `journal_entries`
where `account_full_name` matches COGS/Inventory accounts. Breakdown by category (books,
LEGO, pallets, etc.) using `description` field pattern matching or the `source` field.

This page answers "how much have I put into inventory?" as a distinct number from
"what is my inventory worth?" (which is the net-worth inventory balance).

**Files:** new `app/(cockpit)/inventory-spend/page.tsx` and client component,
`app/api/inventory-spend/route.ts`, update sidebar.

**Acceptance:** Spend figures match what Colin can find manually in QBO under COGS
accounts for the same period, within 5%.

**Migration:** None.

**Task count:** 1 chunk, ~2h build.

---

### Chunk E — Amazon Orders Page (S)

**What:** Wire the `Amazon Orders` nav item (`href: null`). The orders-sync logic
(`lib/amazon/orders-sync.ts`) and Amazon page exist, but there is no dedicated
`/amazon-orders` route showing a filterable list of individual orders. Build a page
that reads from the Supabase `amazon_orders` table (study what exists first — it may
already be populated by the orders-sync cron) with date filter, status filter, and
export to CSV.

**Files:** new `app/(cockpit)/amazon-orders/page.tsx`, update sidebar href.

**Acceptance:** Page shows a list of Amazon orders for the current month with order ID,
date, status, revenue. Filter by status works. CSV export downloads a file.

**Migration:** None (orders-sync already writes to DB).

**Task count:** 1 chunk, ~2–3h build.

---

### Sprint 9 Summary

| Chunk | Title | Size | Revenue/money link |
|---|---|---|---|
| A | Monthly P&L YTD Column | M | Cumulative profit visibility — tax/planning |
| B | Amazon Settlement Auto-Import | M | Revenue accuracy before reconcile runs |
| C | Tax Centre GST Estimate | M | Prevents GST surprises at filing time |
| D | Inventory Spend Page | S | Spend tracking separate from inventory value |
| E | Amazon Orders Page | S | Closes a nav gap; enables order-level audit |

**Total estimate:** 5 chunks, ~12h build time, A+B+D parallelizable, C and E independent.

---

## Sprint 10 — AI Pick Engine (AIPE) Completion + Behavioral Ingestion Wire-up

**Theme:** The AIPE schema (Chunk A) shipped in Sprint 5. Chunks B (Trading) and C
(Sports) have acceptance docs pre-staged in `docs/acceptance/`. Chunk D (Calibration)
gates on B+C having ≥1 day of history. Sprint 10 completes the AIPE loop and wires
the first behavioral ingestion channels that directly support daily financial decisions.

**Kill criterion:** LepiOS generates a daily trading pick and a daily sports pick,
delivers them via Telegram, and resolves the outcomes 24h later — all autonomously.
The Calibration page shows real hit-rate data after 30 days.

### Chunk A — AI Pick Engine: Trading Scan (L)

**Source:** `docs/acceptance/ai-pick-engine-chunk-b-trading.md` (pre-staged in Sprint 6
backlog as P1-1).

**What:** Daily 7am cron scans ~14 instruments via yfinance, 5-factor scoring →
`predictions` table → Telegram dispatch. Weekly tune cron (Claude proposes new weights).

**Files:** `lib/trading/scanner.ts`, `market-data.ts`, `scoring.ts`, `learn.ts`;
`app/api/cron/trading-picks-scan/route.ts`;
`app/api/cron/trading-weights-tune/route.ts`;
`app/(cockpit)/trading/page.tsx`.

**Wire sidebar:** `Trading Journal` and `Prediction Engine` items updated.

**Acceptance:** After one daily cron run, `predictions` table has ≥1 row with
`domain='trading'`. Telegram sends the formatted pick. `/trading` page renders.

**Migration:** Schema already shipped (Sprint 5 Chunk A, migration 0142 or similar —
builder must verify).

**Task count:** 1 chunk, ~3–4h build.

---

### Chunk B — AI Pick Engine: Sports Scan (L)

**Parallel with Chunk A.** Pre-staged acceptance doc at
`docs/acceptance/ai-pick-engine-chunk-c-sports.md`.

**What:** Daily 8am Odds API → Claude analysis → `predictions` table → Telegram.
11pm resolve cron. Sunday tune cron.

**Files:** `lib/sports/odds.ts`, `coach.ts`, `scanner.ts`, `learn.ts`;
`app/(cockpit)/sports/page.tsx` (wire `Sports Betting` nav).

**Acceptance:** After one daily cron run, `predictions` table has ≥1 row with
`domain='sports'`. Telegram sends pick. `/sports` page renders with today's picks.

**Migration:** Same schema as Chunk A (shared `predictions` table).

**Task count:** 1 chunk, ~3–4h build. **Run in parallel worktree with Chunk A.**

---

### Chunk C — AI Pick Engine: Calibration + Trust Gate (M)

**Depends on:** Chunks A+B having ≥1 day of history (30 trading picks, 50 sports picks
are ideal — but ship the page earlier and let it populate).

**Source:** `docs/acceptance/ai-pick-engine-chunk-d-calibration.md` (pre-staged).

**What:** `/calibration` page showing hit rate by grade, calibration plot, drawdown
chart. Trust Gate state machine — all 5 metrics must pass to unlock "Go Live" mode.
Threshold editor (no redeploy needed).

**Files:** `lib/trust/state.ts`, `gate.ts`, `lib/calibration/metrics.ts`;
`app/(cockpit)/calibration/page.tsx`.

**Acceptance:** Page loads with real data from `predictions` table. Hit rate displayed.
Trust Gate shows current pass/fail status.

**Task count:** 1 chunk, ~3h build.

---

### Chunk D — Behavioral Ingestion: Mood + Weather (S)

**What:** Wire two of the highest-leverage, lowest-effort behavioral ingestion channels
identified in the Sprint 6 backlog (P4-1 and P4-2):

1. **Mood/energy/focus daily prompt** — daily Telegram prompt ("How's your energy today?
   1–5") → `mood_log` table. Adds signal density for the behavioral engine with near-zero
   infrastructure.
2. **Weather ingestion** — hourly `app/api/cron/weather-tick/route.ts` using a free
   weather API (OpenWeather), writing to a `weather_log` table. Enables future correlation
   between weather and Colin's decision patterns (sourcing, betting, health).

**Files:** `app/api/cron/mood-prompt/route.ts`, `app/api/telegram/mood-response/route.ts`,
`app/api/cron/weather-tick/route.ts`, migrations for `mood_log` and `weather_log`.

**Acceptance:** Daily Telegram prompt sends at 9am MDT. Responding "4" writes a row to
`mood_log`. Weather table has rows after one cron run.

**Task count:** 1 chunk, ~2h build.

---

### Chunk E — Trading Journal + Sports Betting UI Pages (M)

**Depends on:** Chunks A+B (predictions must exist to log against).

**What:** Port `2_Trading_Journal.py` and `3_Sports_Betting.py` from Streamlit. These
pages let Colin log actual trades and bets against the AIPE predictions, closing the
calibration loop.

**Files:** `app/(cockpit)/trading-journal/page.tsx`,
`app/(cockpit)/sports-betting/page.tsx` (or integrate into existing `/trading` and
`/sports` pages as tabs).

**Acceptance:** Colin can log a trade against a prediction, and the resolve cron picks
up the outcome.

**Task count:** 1 chunk, ~3h build.

---

### Sprint 10 Summary

| Chunk | Title | Size | Depends on | Revenue/money link |
|---|---|---|---|---|
| A | AIPE Trading Scan | L | AIPE schema (Sprint 5) | Trading signals → informed trades |
| B | AIPE Sports Scan | L | AIPE schema (Sprint 5) | Betting signals → positive EV bets |
| C | Calibration + Trust Gate | M | A+B (1+ day history) | Gate before real money deployed |
| D | Mood + Weather Ingestion | S | none | Behavioral data layer for Twin |
| E | Trading Journal + Sports Betting UI | M | A+B | Close the prediction → outcome loop |

**Total estimate:** 5 chunks, ~15h build time. A+B run in parallel; C+E after A+B merge;
D is independent, run whenever.

---

## Parked — Not in These Sprints

The following items are logged for future sprints but are out of scope for 8–10:

| Item | Why parked | When to revisit |
|---|---|---|
| Repricer | Requires pricing strategy decisions Colin hasn't made | After AIPE calibrated |
| Lego Vault | Niche; revenue impact unclear vs. other items | Sprint 11+ |
| eBay Listings page | eBay orders exist but no listing management | Sprint 11 |
| Marketplace Hub | Umbrella page — needs sub-pages first | Sprint 11 |
| Retirement / Insurance | Personal planning; lower urgency than revenue | Sprint 11+ |
| F18 retrofit campaign (26 modules) | Important but not blocking revenue | Ongoing parallel track |
| Multi-user auth gate | Unblocks Family/Cora pages; no urgency | Sprint 11 |
| Behavioral ingestion: Plaid bank sync | High value but complex OAuth | Sprint 11+ |
| Tax Return page | Needs full-year 2025 data reconciled first | After QBO catch-up |
| Keepa Intel cockpit page | Keepa token budget limits utility | After token strategy review |
| AIPE Outcomes Inference | XL scope; requires >6 months of prediction history | Sprint 12+ |
| Security lockdown PR #104 | P0 unblock — should be done BEFORE Sprint 8 starts | Immediately |

---

## Pre-Sprint 8 Prerequisites

Before Sprint 8 begins, the following should be cleared:

1. **PR #104 (security lockdown)** — 50 RLS policies applied to prod but auth UI unmerged.
   Rebase + fix the `useSearchParams()` Suspense wrap, merge. ~15 min.
2. **Sprint 7 in-flight chunks** — confirm Chunks D, E, F from Sprint 7 are merged and
   live at `lepios-one.vercel.app` before Sprint 8 acceptance docs are written.
3. **Task queue grooming** — run a 30-min grooming session to dismiss superseded tasks
   and confirm the AIPE pre-staged docs in `docs/acceptance/` are still current.
