# Phase 1a — Streamlit Study: Retail Scout / Arbitrage

**task_id:** 3a13fc07-2db6-4d0e-a245-4397a5c0978c  
**Prepared:** 2026-05-15  
**Coordinator status:** ESCALATION REQUIRED — see §6

---

## 1. What the Task Says

Task description: *"Port Retail Scout / Arbitrage from Streamlit (3 files, ~3897 lines, 0% in LepiOS). Coordinator Phase 1a study first, then acceptance doc + builder. Highest unstarted leverage after scanner."*

**System-inventory claim:** `retail-scout-arbitrage` = 0% in LepiOS, leverage = 700.

---

## 2. Streamlit Files — What They Do

### 42_Retail_Scout.py (640 lines) — DEAD CODE

Shows `st.info("Retail Scout has been merged into Retail HQ")` at line 38, then `st.stop()` at line 39. The remaining ~600 lines (Walmart stock checker, flip calculator, deal pipeline) are **unreachable dead code** — never executed.

**Port verdict:** Nothing to port. This file is a redirect stub. Its functionality was absorbed into 75_Retail_HQ.py.

---

### 46_Arbitrage_Scanner.py (1632 lines) — LEGO RA/OA RESEARCH TOOL

4 tabs:

**Tab 1: Product Lookup**
- Input: ASIN
- Calls `utils/keepa_api.get_product(asin)` → price history, BSR, rank trend, ROI calc
- Shows price history chart, average 90d price, current price, estimated profit at input buy price
- Domain rules: ROI threshold for "good deal" (not explicitly coded — visual only)

**Tab 2: ROI Calculator**
- Standalone: buy price + Amazon price + FBA fees + cashback % → profit + ROI
- Same formula as 75_Retail_HQ.py Calculator tab

**Tab 3: Deal Tracker**
- CRUD for saved deals in `🧱 Deals` Google Sheet
- Columns: product, ASIN, store, buy_price, amazon_price, roi_pct, status (watching/active/passed/sold), notes
- Status pipeline matches what `/retail-monitor/` Watchlist implements

**Tab 4: Price Watchlist**
- CRUD for retail URLs in `🧱 Watchlist` Google Sheet
- Monitors URLs for price drops (via `utils/price_monitor` scraper)
- Telegram alerts when price hits target
- Fields: product, url, current_price, target_price, store, notes, status

---

### 75_Retail_HQ.py (1465 lines) — CENTRAL RETAIL ARB HUB

8 tabs:

**Tab 1: Dashboard**
- Store cards grid: one card per configured store (Walmart, Canadian Tire, etc.)
- Shows active deal count per store, last scan time
- Data from `🛒 Retail Deals` sheet

**Tab 2: Deals**
- Flipp API search (`utils/flipp_api`): input keyword → returns deals from Canadian flyer database
- Shows: product name, store, price, pre-price (strike-through), savings, valid dates
- Save button: writes to `🛒 Retail Deals` sheet

**Tab 3: StockTrack**
- Walmart/store inventory checker via `utils/stocktrack_api`
- Input: keyword or UPC → returns stock levels at nearby stores
- Period selector: today/yesterday/weekly

**Tab 4: Auto Scan**
- Scheduled Telegram deal alerts
- User configures: store, min_discount_pct, keywords
- Runs scan and sends Telegram message with deals found
- Also stores saved scanner configs

**Tab 5: Arb Engine** ← HIGHEST VALUE, NOT PORTED
- Full pipeline: retail store scan → Amazon ASIN match → profit calculation → deal score
- Input: target stores, min ROI %, category filter
- Calls `utils/arb_engine` which internally:
  - Fetches StockTrack deals (clearance/sale items)
  - Matches each to Amazon ASIN (by UPC or title search via SP-API/Keepa)
  - Computes ROI = (Amazon price - buy cost - FBA fees - referral) / buy cost
  - Scores deal by ROI × velocity (BSR trend) × brand risk
- Output: ranked deal list with buy/skip buttons → Telegram alert for top deals
- Scheduled: runs at 2:00 PM + 8:00 PM via `telegram_bot.py:1263`

**Tab 6: Risk & Fees**
- Brand risk checker: input brand name → C&D risk level + notes
- Also shows brand restriction lookups (Amazon gated categories)
- Uses `utils/brand_risk` (static database)

**Tab 7: Calculator**
- Manual ROI calc with cashback stacking
- Same as 46_Arbitrage_Scanner.py Tab 2

**Tab 8: History**
- Purchase log: items bought for resale
- Fields: date, product, store, buy_price, sell_price, profit, status
- Loaded from `🛒 Retail Deals` sheet filtered by status=sold

---

## 3. What's ALREADY in LepiOS (Check-Before-Build Grounded)

**This is the critical finding. The system-inventory `retail-scout-arbitrage = 0%` is incorrect.**

| Feature (Streamlit source) | LepiOS status | Evidence |
|---|---|---|
| ROI Calculator (46_Arb tab 2, 75_HQ tab 7) | ✓ DONE | `/retail-monitor/` FlipCalculator + `/retail-hq/` CalculatorTab |
| Deal Tracker / Watchlist (46_Arb tab 3) | ✓ DONE | `/retail-monitor/` Watchlist with full status pipeline (watching/active/passed/sold) + add form |
| Price Watchlist CRUD (46_Arb tab 4) | ✓ DONE | `/retail-monitor/` WatchlistCard has URL field, current/target price |
| Product Lookup ASIN → Keepa (46_Arb tab 1) | ✓ DONE | `/keepa-intel/` KeepaIntelClient.tsx (1032 lines) — Token Status, Deal Finder, Price Alerts, Data Explorer |
| Flipp deals search (75_HQ tab 2) | ✓ DONE | `/retail-hq/` Deals tab (calls `/api/retail/deals`) |
| StockTrack (75_HQ tab 3) | ✓ DONE | `/retail-monitor/` StockTrack tab + `lib/retail/stocktrack-client.ts` |
| Auto Scan with configs (75_HQ tab 4) | ✓ DONE | `/retail-monitor/` AutoScanPanel with SavedScannerConfigs |
| Brand Risk (75_HQ tab 6) | ✓ DONE | `/retail-hq/` BrandRiskTab (uses `lib/reselling/brand-risk.ts`) |
| Deal signal dashboard | ✓ DONE | `/retail-radar/` — ROI-sorted view of watchlist |
| **Dashboard — store cards grid (75_HQ tab 1)** | ✗ MISSING | No store cards view in any retail-* route |
| **Arb Engine (75_HQ tab 5)** | ✗ MISSING | No scan → Amazon match → score pipeline anywhere in LepiOS |
| **History / purchase log (75_HQ tab 8)** | ✗ MISSING | Watchlist has status=sold but no dedicated history view |
| 42_Retail_Scout.py entirely | ✓ N/A | Dead code — redirect stub |

---

## 4. Revised Completion Estimate

| File | Lines | Estimated LepiOS % |
|---|---|---|
| 42_Retail_Scout.py | 640 | 100% (it's dead code — nothing to port) |
| 46_Arbitrage_Scanner.py | 1632 | ~85% (Tabs 1–4 all ported, Price Watchlist URL-monitoring not automated yet) |
| 75_Retail_HQ.py | 1465 | ~60% (5 of 8 tabs ported: Deals, StockTrack, Auto Scan, Risk & Fees, Calculator; missing Dashboard, Arb Engine, History) |
| **Total weighted** | **3737** | **~72%** |

System-inventory shows 0%. Actual: ~72%.

---

## 5. Domain Rules Embedded in Streamlit

From 46_Arbitrage_Scanner.py:
- ROI threshold for "good deal": ≥30% (encoded in `/retail-monitor/` already)
- Deal status pipeline: watching → active → passed → sold (ported)
- Price drop alert: `current_price ≤ target_buy_price` flag (ported)

From 75_Retail_HQ.py:
- Arb Engine deal scoring = ROI × velocity (BSR trend) × brand risk — not yet formalized in LepiOS
- Auto-scan schedule: 2:00 PM + 8:00 PM via Telegram bot (AutoScan tab exists but no cron configured)
- Flipp deals search defaults to "sale" keyword (ported)

---

## 6. Escalation — Grounding Checkpoint Required

**I cannot proceed to write an acceptance doc from the task as stated.** The task premise is wrong.

The task says `retail-scout-arbitrage = 0% in LepiOS` and asks for a full port. The grounded reality is ~72% already done. Proceeding to "port" these 3 files would:
1. Duplicate existing working code (high risk of F-L3 class errors)
2. Waste builder tokens on already-shipped features
3. Bloat the codebase with redundant components

**What's actually missing (the 28%):**

| Missing Feature | Source | Effort | Value |
|---|---|---|---|
| **Arb Engine** (scan → Amazon match → score pipeline) | 75_HQ tab 5 | XL (requires SP-API ASIN match + Keepa + brand risk integration) | HIGH |
| **Dashboard** (store cards grid) | 75_HQ tab 1 | S (UI only, aggregates from retail_watchlist table) | LOW |
| **History / purchase log** | 75_HQ tab 8 | S (filter watchlist by status=sold + date) | LOW |
| Price Watchlist URL auto-monitor | 46_Arb tab 4 | M (scraper / cron needed) | MED |

**Colin's decision needed:**

> **Q1:** Should `system-inventory.md` row `retail-scout-arbitrage` be updated to reflect the actual ~72% completion?
>
> **Q2:** Should this task be re-scoped to build only the truly missing pieces (especially the Arb Engine), or is the Arb Engine out of scope until T-004 (PageProfit / Amazon Scanner) is further along since both require SP-API?
>
> **Q3:** The Arb Engine is XL effort (SP-API ASIN matching, Keepa velocity, brand risk scoring). Is this the right next task given T-004 (PageProfit scanner) also requires SP-API work and is explicitly in the leverage-targets? Should we merge/sequence these?

---

## 7. 20% Better Opportunities (if scoping to missing pieces)

| Category | Opportunity |
|---|---|
| Arb Engine correctness | Streamlit scores deals by ROI × velocity × brand risk — but the formula is implicit. Formalize as explicit weights in `harness_config` so Colin can tune without code changes. |
| Arb Engine performance | Streamlit runs ASIN match serially. LepiOS can batch-fetch Keepa + SP-API in parallel (Promise.all) for 3–5× speed. |
| History UX | Streamlit history is a raw sheet dump. LepiOS should show P&L summary by month (total bought, total sold, total profit). |
| Auto-scan scheduling | Currently manual button trigger in LepiOS. Wire to cron via `outbound_notifications` pattern — same as stall-alert chunk. |
| Dashboard | Streamlit has static store cards. LepiOS dashboard could show live deal counts from `retail_watchlist` grouped by store, updated on page load. |
