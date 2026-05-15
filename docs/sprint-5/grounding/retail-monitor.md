# Grounding Doc — Retail Monitor (75_Retail_HQ.py port)

**Prepared:** 2026-05-14
**Status:** Pre-staged. Ready for coordinator spec phase.
**Task queue ID:** 645af95d-1435-4ccd-bd69-de83442c2010
**Overlap category:** PARTIAL — watchlist, brand risk, and Flipp API already exist; StockTrack and Arb Engine are net-new
**Migration slots:** reserve via `node scripts/next-migration-number.mjs` at build time

---

## 1. What Already Exists in LepiOS

### Pages

| Page           | Route                           | What it does                                                       | Confirmed functional                               |
| -------------- | ------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| Retail Monitor | `app/(cockpit)/retail-monitor/` | Watchlist CRUD (manual entry), Flip Calculator                     | Yes — reads/writes `retail_watchlist`              |
| Retail HQ      | `app/(cockpit)/retail-hq/`      | Deals tab (reads `deals` table), Brand Risk lookup, ROI Calculator | **Partial** — Deals tab is broken (see §Bug below) |
| Retail Radar   | `app/(cockpit)/retail-radar/`   | Deal signal view from watchlist, sorted by ROI, status filter      | Yes — reads `retail_watchlist`                     |

### API Routes

| Route                                     | Source                                   | What it does                 | Status                                                        |
| ----------------------------------------- | ---------------------------------------- | ---------------------------- | ------------------------------------------------------------- |
| `GET /api/retail/watchlist`               | `app/api/retail/watchlist/route.ts`      | List `retail_watchlist` rows | Working                                                       |
| `POST /api/retail/watchlist`              | `app/api/retail/watchlist/route.ts`      | Create watchlist item        | Working                                                       |
| `PATCH/DELETE /api/retail/watchlist/[id]` | `app/api/retail/watchlist/[id]/route.ts` | Update/delete watchlist item | Working                                                       |
| `GET /api/retail/deals`                   | `app/api/retail/deals/route.ts`          | List deals                   | **BROKEN** — queries non-existent `deals` table (returns 500) |
| `GET /api/flyer-intel/search`             | `app/api/flyer-intel/search/route.ts`    | Flipp flyer keyword search   | Working — returns items from Flipp API                        |

> **Known bug:** `GET /api/retail/deals` queries `db.from('deals')` but no `deals` table exists in any migration. The route should be fixed: either create the table or remap to `retail_watchlist`. This is a pre-existing gap, not something introduced by this port.

### Database Tables

| Table                                       | Migration | Purpose                           | Gaps                                                                 |
| ------------------------------------------- | --------- | --------------------------------- | -------------------------------------------------------------------- |
| `retail_watchlist`                          | 0194      | Core watchlist with profit fields | Only 4 statuses (watching/active/passed/sold); Streamlit has 8       |
| `keepa_deals`                               | 0196      | Keepa scan result cache           | No StockTrack equivalent yet                                         |
| `deal_tracker_items` + `deal_price_history` | 0189      | Deal price tracker                | Different data model; not wired to retail-hq or retail-monitor pages |

### Lib files

| File                          | What it has                                                                                                                      | Complete?                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `lib/retail/types.ts`         | `RetailWatchlistItem`, `RetailWatchlistStatus`, `RETAIL_STORES` (12), `RETAIL_CATEGORIES` (11), `STATUS_LABELS`, `STATUS_COLORS` | Missing 4 statuses; store list differs slightly from Streamlit |
| `lib/reselling/brand-risk.ts` | `BRAND_DB` (~70 entries), `lookupBrandRisk`, `scanTitleForRisk`, `riskColor`, `riskBadgeClass`                                   | Complete — matches Streamlit source                            |
| `lib/reselling/types.ts`      | `BrandRiskEntry`, `RetailDeal`, `RepricerRule`, `MarketplaceListing`                                                             | `RetailDeal` type not backed by any live table                 |

---

## 2. Streamlit Source Analysis (75_Retail_HQ.py)

### What it does (full scope)

8 tabs: Dashboard, Deals, StockTrack, Auto Scan, Arb Engine, Risk & Fees, Calculator, History.
Primary data flows: Google Sheets (`🛒 Retail Deals` tab) + StockTrack API + Flipp API + Keepa.

---

### Tab 1 — Dashboard

Shows summary KPIs computed from the Google Sheets deal log:

- Total items watching, total with buy signal, total bought
- Potential profit at stake (sum of est_profit for buy-signal items)
- Recent alerts (items with alert_sent_at in last 7 days)

**LepiOS equivalent:** Retail Radar page covers this partially. Missing: bought count, potential profit at stake, recent alerts widget.

---

### Tab 2 — Deals (Flipp)

Search Canadian flyers by keyword. Filter by store. Show results: item name, store, sale price, original price, savings %, valid dates, image.

**Data source:** Flipp public API at `backflipp.wishabi.com/flipp/items/search` — no auth key required, postal code only (default T6H = Edmonton).

**LepiOS equivalent:** `/api/flyer-intel/search` is built and working but not surfaced in any retail UI tab. The Retail HQ "Deals" tab was supposed to show this but currently calls the broken `/api/retail/deals` route.

**Business rules:**

- Postal code `T6H` (Edmonton) as default; Colin hardcoded in settings
- Filter results to only stores in Colin's sourcing list: Best Buy, Canadian Tire, Lego, Walmart, Sport Chek, London Drugs, Home Depot, Staples, Toys R Us, Costco

---

### Tab 3 — StockTrack (4 sub-tabs)

**Primary missing feature.** StockTrack monitors real-time store inventory and price changes at 8 Canadian retail chains.

**StockTrack store codes:**
| Code | Store |
|------|-------|
| `bb` | Best Buy |
| `ct` | Canadian Tire |
| `hd` | Home Depot |
| `st` | Sport Chek |
| `wm` | Walmart |
| `sc` | Real Canadian Superstore |
| `tru` | Toys R Us |
| `pa` | London Drugs |

**API pattern:** Streamlit uses a `StockTrackClient` class (reverse-engineered from stocktrack.ca app). Key methods:

- `client.search_by_keyword(query, stores=None)` — search for a product across selected stores
- `client.get_category_drops(category, store, min_discount_pct)` — get recent price drops in a category

The API is not officially documented. It's the same endpoint the stocktrack.ca web app uses. Rate limiting: unknown — Streamlit adds a short delay between calls.

**Sub-tab A — Product Search:**

- Enter keyword → select stores (default: all 8)
- Result table: Product name, Store, Current price, Regular price, % off, In stock (Y/N), URL
- Click row → open product page

**Sub-tab B — Price Drops:**

- Select store(s), category, min discount % (default 20%)
- Result table: Product, Store, Price, % off, Sale start date, Quantity remaining
- "Add to Watchlist" button per row

**Sub-tab C — Trending:**

- What items are showing unusual movement (large drop, sudden restock)
- Sorted by "activity score" (Streamlit: `price_drop_pct * 0.6 + restock_flag * 0.4`)
- No direct user action — informational

**Sub-tab D — Flyer Browser:**

- Browse all flyers for a specific store rather than keyword-searching
- Lists active flyer pages with items

> **External API decision needed:** StockTrack API is reverse-engineered from stocktrack.ca. It works today (Streamlit is in production with it). Recommendation: use the same API pattern. Cache results in Supabase (`stocktrack_results` table) to avoid re-querying for the same keyword within a TTL window (suggest 4-hour cache). Do not implement a scraper — the API is already cleaner.

---

### Tab 4 — Auto Scan

Background scanner settings:

- Store selection (which StockTrack stores to monitor)
- Category selection
- Min discount threshold (%)
- Scan frequency (Streamlit: manual only, no cron in Streamlit)
- Telegram alert toggle

When triggered: runs StockTrack `get_category_drops()` across selected stores/categories, filters by discount threshold, sends Telegram message for each new hit.

**Note:** Streamlit's Auto Scan is manual (click to run). The "20% better" opportunity is making this a scheduled cron that runs automatically and pushes Telegram without Colin clicking.

---

### Tab 5 — Arb Engine

Pairs StockTrack price-drop items with their Amazon listings to compute arbitrage scores.

**Score formula (0–100):**

```
match_confidence: 'high'=25pts, 'medium'=15pts, 'low'=5pts
discount_pct contribution: min(discount_pct / 2, 25) pts  (caps at 25 for 50%+ off)
roi_contribution: min(roi_pct / 2, 50) pts  (caps at 50 for 100%+ ROI)
brand_risk penalty: risk_level * -5  (range: 0 to -25)
total_score = match_confidence + discount_pct_contribution + roi_contribution + brand_risk_penalty
```

**Match confidence logic:**

- 'high' — UPC/EAN or ASIN direct match found
- 'medium' — title keyword match (≥3 words match) via Keepa search
- 'low' — keyword only, no listing match

**Required inputs:** StockTrack result (product name, price, store) → Keepa/SP-API lookup for Amazon price → FBA fee estimate → ROI computed.

**ROI formula:**

```
net_payout = amazon_price * (1 - referral_fee_pct) - fba_fees
profit = net_payout - (buy_price * (1 - cashback_pct))
roi = profit / (buy_price * (1 - cashback_pct)) * 100
```

**Referral fees by category:**

- Electronics: 8%
- Toys/Lego: 15%
- Home: 15%
- Sports: 15%
- All others: 15%

**Cashback stack (default):**

- Southgate gift card: 5% (buy store gift cards at Southgate mall store)
- Credit card: 2% (Amex cash-back)
- Total typical: 7% reduction on buy price

**LepiOS equivalent:** None — no Arb Engine exists. SP-API is available (`lib/amazon/client.ts`). Keepa integration is available (via `/api/keepa/*` — verify grep). Brand risk is available (`lookupBrandRisk`).

---

### Tab 6 — Risk & Fees

Two tools:

1. **Brand Risk Check:** Enter brand name → lookup BRAND_DB → risk level badge + notes
2. **FBA Fee Calculator:** Enter ASIN + price → estimate FBA fees using 2026 fee schedule

**LepiOS equivalent:** Brand Risk tab in retail-hq page — **already built**. FBA fee calculator — verify if `/api/pageprofit/*` already has fee estimation (grep before building).

---

### Tab 7 — Calculator (ROI + Cashback)

Manual ROI calculator:

- Inputs: buy price, sell price, FBA fees (manual override), referral fee %, cashback %
- Outputs: net profit, ROI %, break-even buy price
- Cashback stacking: Southgate gift card (5%) + CC (2%) + store loyalty (variable)

**LepiOS equivalent:** Retail Monitor page already has a "Flip Calculator" component. Verify it covers cashback stacking — if not, this is a gap.

---

### Tab 8 — History (Buy Log)

Log of past retail purchases with fields: Date, Store, Product, Buy Price, Status, Sell Price, Profit, Notes.

**Data source:** Google Sheets `🛒 Retail Deals` tab — same sheet as the watchlist, filtered to status in ('Bought', 'Shipped to FBA', 'Live on Amazon', 'Sold').

**LepiOS equivalent:** `retail_watchlist` table with status filter covers this, but only if items advance through status transitions. The "History" view is just the watchlist filtered to terminal statuses.

---

## 3. Status Workflow Gap

Streamlit has 8 statuses; LepiOS `retail_watchlist` has 4.

| Streamlit status | LepiOS equivalent | Action needed        |
| ---------------- | ----------------- | -------------------- |
| Researching      | `watching`        | No change            |
| Buy Signal       | `active`          | No change            |
| Bought           | _(missing)_       | Add `bought`         |
| Shipped to FBA   | _(missing)_       | Add `shipped_to_fba` |
| Live on Amazon   | _(missing)_       | Add `live_on_amazon` |
| Sold             | `sold`            | No change            |
| Pass             | `passed`          | No change            |
| Returned         | _(missing)_       | Add `returned`       |

**Migration required:** ALTER TABLE `retail_watchlist` to expand the status CHECK constraint. Also update `STATUS_LABELS`/`STATUS_COLORS` in `lib/retail/types.ts` and the `RetailWatchlistStatus` union type.

---

## 4. Integration Points

| Module                     | Relationship                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `app/(cockpit)/amazon/`    | SP-API for buy-box price enrichment in Arb Engine                                           |
| `app/(cockpit)/inventory/` | When status → `shipped_to_fba`, item COGS should flow to FBA inventory (future hook)        |
| `lib/amazon/client.ts`     | Reuse for SP-API calls — already handles auth + retry                                       |
| Keepa API                  | For Arb Engine: historical price + BSR lookup (check `app/api/keepa/` routes before coding) |
| Telegram bot               | Auto Scan alert delivery — use `loeppky_daily_bot` via harness notifications pattern        |

---

## 5. Tables Needed (Proposed Schema)

> Before creating: `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%retail%' OR table_name LIKE '%stocktrack%' OR table_name LIKE '%arb%'`

### Existing tables that need changes

**`retail_watchlist`** — status CHECK constraint must be expanded:

```sql
-- Drop old constraint, add new with all 8 statuses
ALTER TABLE public.retail_watchlist
  DROP CONSTRAINT IF EXISTS retail_watchlist_status_check;
ALTER TABLE public.retail_watchlist
  ADD CONSTRAINT retail_watchlist_status_check
  CHECK (status IN ('watching', 'active', 'bought', 'shipped_to_fba', 'live_on_amazon', 'sold', 'passed', 'returned'));
```

### New tables

| Table                | Purpose                               | Key columns                                                                                                                                                                  |
| -------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stocktrack_results` | Cache StockTrack API results (4h TTL) | id, query_term, store_code, product_name, current_price, regular_price, discount_pct, in_stock, product_url, scanned_at                                                      |
| `retail_arb_scores`  | Persisted Arb Engine output           | id, stocktrack_result_id, asin, title, buy_price, amazon_price, roi_pct, arb_score, match_confidence, brand_risk_level, fba_fees, referral_fee_pct, cashback_pct, created_at |

All new tables need F24 grants: `GRANT INSERT, UPDATE, DELETE ON <table> TO service_role;`

---

## 6. ≥20% Better Than Streamlit

| Area                       | Streamlit limitation                    | LepiOS improvement                                                                                            |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Auto scan**              | Manual — Colin clicks to run            | Scheduled cron: scan top categories on a schedule, push Telegram alert on new hits — no Colin action required |
| **StockTrack cache**       | Every search hits the API live          | Cache results in `stocktrack_results` with 4h TTL — instant re-queries, protects against rate limiting        |
| **Arb scores persistence** | Computed in-memory, lost on page close  | `retail_arb_scores` table — track best opportunities over time, spot recurring deals                          |
| **Status workflow**        | 8 statuses but no transition validation | Enforce valid transitions in the API route (e.g., can't go straight watching→sold)                            |
| **Cashback config**        | Hardcoded 5%+2% in calculator           | Store cashback rates per store as config in `harness_config` — user-updatable without code change             |
| **F18 observability**      | No metrics                              | Log `scan_runs`, `deals_found`, `avg_roi`, `arb_scores_computed` to `agent_events`                            |
| **Flipp deals tab**        | Works but loses results on page close   | Optionally save Flipp results to `retail_watchlist` with one click                                            |
| **Status transitions**     | Tracked in Google Sheets row            | `updated_at` on `retail_watchlist` shows last change; status history could be added (future)                  |

---

## 7. Out of Scope for Initial Port

- Auto Scan cron job (Telegram alerts for scheduled scans) — build the manual scan first; cron is a follow-on chunk
- Flipp Deals tab fix (fix broken `deals` route → wire to Flipp API) — noted as bug, can fix in same PR as a low-effort addition
- FBA fee calculator (already partially in retail-monitor Flip Calculator; verify coverage before duplicating)
- `deal_tracker_items` / `deal_price_history` tables — separate tool (generic price tracker), not part of retail arb workflow; leave as-is
- Multi-user support (personal OS — Colin only)

---

## 8. Acceptance Criteria Skeleton

> Coordinator: expand each criterion with exact field names before handing to builder.

**AC-1:** Status migration applied. `retail_watchlist.status` CHECK constraint accepts all 8 values. `RetailWatchlistStatus` type updated in `lib/retail/types.ts`. `STATUS_LABELS`/`STATUS_COLORS` extended for new statuses.

**AC-2:** StockTrack Product Search available at `/retail-monitor` (new tab or sub-section). User enters keyword, selects store(s), gets results table: product name, store, current price, regular price, % off, in-stock indicator, link. Results cached in `stocktrack_results` table for 4h.

**AC-3:** StockTrack Price Drops available. Filterable by store, category, min discount %. "Add to Watchlist" button adds row to `retail_watchlist` with status=`active`, buy_price, store pre-filled.

**AC-4:** Arb Engine scores a StockTrack price-drop result. Given a watchlist item with store_price and amazon_price, compute arb_score using the formula in §2 Tab 5. Score + breakdown visible in UI. Results written to `retail_arb_scores`.

**AC-5:** Retail HQ Deals tab fixed. Calls `/api/flyer-intel/search` (not the broken `deals` table route). Shows Flipp results: name, store, price, savings, valid dates.

**AC-6:** No `style={}` in any new TSX files (F20). All Supabase writes use service role. All new migrations include F24 grants.

**AC-7 (F18):** Scan results logged to `agent_events`: `{ event: 'stocktrack_scan', query, stores, results_count, arb_scores_computed }`.

---

## 9. Grounding Checkpoint

Before builder starts, coordinator must run:

```sql
-- Confirm retail_watchlist status constraint
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname LIKE '%retail_watchlist_status%';

-- Confirm stocktrack_results and retail_arb_scores don't already exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('stocktrack_results', 'retail_arb_scores');

-- Confirm deals table status (expected: 0 rows — table doesn't exist)
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'deals';

-- Confirm Keepa API routes exist (for Arb Engine)
-- In shell: grep -r "keepa" app/api/ --include="*.ts" -l
```

**Grounding baseline:** Streamlit `75_Retail_HQ.py` is the verified reference for domain rules (ROI formula, cashback stacking, StockTrack store codes, arb score formula). For any cell-by-cell comparison, use a manual ROI calculation against a known deal from the Streamlit buy history.

**External API decision to confirm before spec:**

- StockTrack: use API (same as Streamlit) — coordinator to confirm with Colin that the API key/credentials are available in `harness_config` or `.env.local`
- Flipp: no auth needed, postal code T6H (Edmonton) hardcoded — confirmed working in existing route
