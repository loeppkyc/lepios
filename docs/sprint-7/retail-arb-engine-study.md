# Phase 1a Study — Retail Arb Engine
**Task:** 3a13fc07-2db6-4d0e-a245-4397a5c0978c  
**Scope approved by Colin:** Arb Engine tab only (XL chunk)  
**Written:** 2026-05-15

---

## What it does (user-visible behaviour)

The Arb Engine tab in `75_Retail_HQ.py` runs a batch scan of retail deals to find arbitrage opportunities on Amazon. User provides a list of deals (or triggers from existing Flipp/StockTrack data), the engine matches each to an Amazon ASIN, fetches the current sell price + FBA fees, calculates profit and ROI, and returns a sorted results table. BUY / SKIP decision per item.

The Telegram bot auto-runs this at 2:00 PM + 8:00 PM MDT via `utils/arb_engine`.

---

## How it does it (data sources + logic)

Source: `features-report.md §2.3`, `streamlit-full-inventory.md`, `audits` study.  
No direct Python access — using grounded audit evidence.

**Pipeline (inferred from docs + architecture):**
1. Input: retail deals with name + retail price (from Flipp API, StockTrack, or manual)
2. ASIN lookup: UPC (if available) → EAN identifier lookup via SP-API Catalog; fallback to keyword search
3. Amazon new buy box price: SP-API CompetitivePricing endpoint, `condition='new'`
4. FBA fees: SP-API fees estimate endpoint (same as PageProfit)
5. Profit: `buy_box_new - fba_fees - retail_cost`
6. ROI: `profit / retail_cost × 100`
7. Score: ROI + Keepa velocity signal (rank drops, monthly sold)
8. Output: sorted by score, BUY / SKIP decision

**Keepa integration:** `utils/arb_engine.py` calls Keepa for rank history and velocity signals (`rank_drops_30`, `monthly_sold`). This is the same data `getKeepaProduct()` already returns.

**Data writes (Streamlit):** Results written to `🛒 Retail Deals` Google Sheet. LepiOS replacement: `agent_events` for F18 metrics (no sheet write, no new table for v1).

---

## Domain rules embedded

1. **New buy box, not used**: Retail arb sells products as NEW on Amazon FBA. The used buy box (used in PageProfit for book reselling) is wrong here.
2. **Cashback stacking**: ROI calculation should account for cashback (e.g. credit card cashback reduces effective cost). The existing Calculator tab already does this — arb engine should use the same formula.
3. **Canadian marketplace**: All prices in CAD, marketplace = `A2EUQ1WTGCTBG2`.
4. **FBA fee note**: `getFbaFees()` has a book-specific correction (15% + $5.50) that fires when SP-API returns exactly 40%. For general merchandise this correction is wrong. The fee function needs a `bookMode` flag OR the arb engine should call the raw SP-API path directly.
5. **Score threshold**: Streamlit uses ROI ≥ threshold (configurable). Features-report doesn't specify the default — using same 15% default as general retail (lower than books at 50%, since retail margins are tighter). This is an open question for Colin.

---

## Edge cases

- Product not on Amazon CA: return `no_match` status, skip (not an error)
- No new buy box (only used listings): skip item, surface as `no_new_listing`
- Keepa data unavailable: score without velocity, flag as `keepa_unavailable`
- Duplicate ASINs from different deals: score once, attribute to the best-ROI deal

---

## Fragile / improvable points

- **ASIN matching by keyword is noisy**: "Tide Pods 81-count" may match the wrong ASIN. UPC is much more reliable. The arb engine should prefer UPC when the deal source provides it (Flipp deal items often have a product ID).
- **Sequential processing in Streamlit**: The Python engine processes deals one at a time. LepiOS should process in parallel (Promise.all).
- **No persistence in v1**: Streamlit writes to Sheets for history. LepiOS v1 logs to agent_events for F18; purchase history tab (separate S chunk) will be the persistence layer.

---

## Twin Q&A

**Status: BLOCKED — host not in allowlist (cloud coordinator sandbox)**

Questions that would have gone to Twin:
1. "Does the arb_engine use new or used buy box for pricing?" → Inferred new (retail arb context)
2. "What's the ROI threshold in the arb engine?" → Flagged as open question for Colin
3. "Does Flipp API return UPC codes with deal items?" → Unknown, needs live API test

**Pending Colin questions (see acceptance doc Open Questions):**
- What minimum ROI % for retail arb BUY decision? (Suggest 15%, books use 50%)
- Should the scan save results to a `retail_arb_scans` table, or agent_events only for v1?

---

## 20% Better

| Category | Streamlit limitation | LepiOS improvement |
|---|---|---|
| Performance | Sequential deal processing, one API call at a time | `Promise.all` — all deals in parallel; 10x faster on 10+ deals |
| Correctness | FBA fees use book override (15%+$5.50) for all categories | Add `bookMode=false` parameter to `getFbaFees()`, bypassing book correction |
| ASIN matching | Keyword search only (noisy) | UPC-first lookup via SP-API EAN identifier; keyword fallback only when UPC absent |
| Scoring | Single-signal (ROI only) | Composite score: ROI weighted by Keepa velocity multiplier `(rank_drops_30 / max_rank_drops)` |
| UX | Table only, no BUY/SKIP visual hierarchy | Design Council color-coded rows (green/red/yellow) using existing badge patterns |
| Observability | No metrics captured | F18: log each scan to `agent_events` with batch_size, hit_rate, avg_roi, latency_ms |

---

## What's already ported (the ~72%)

| Feature | Status | Evidence |
|---|---|---|
| Flipp deals search | ✓ Done | `RetailHQPage.tsx` Deals tab, `lib/flipp/` |
| Brand risk checker | ✓ Done | `RetailHQPage.tsx` Brand Risk tab, `lib/reselling/brand-risk.ts` |
| ROI calculator | ✓ Done | `RetailHQPage.tsx` Calculator tab |
| StockTrack panel | ✓ Done | `RetailMonitorPage.tsx` StockTrackPanel |
| Auto Scan (Telegram alerts) | ✓ Done | `deal_scan.py` equivalent in harness |
| Keepa product lookup | ✓ Done | `lib/keepa/product.ts`, `getKeepaProduct()` |
| SP-API + FBA fees infra | ✓ Done | `lib/amazon/fees.ts`, `lib/amazon/client.ts` |

---

## Missing (the 28% — Arb Engine scope)

| Feature | Size | This chunk? |
|---|---|---|
| Arb Engine tab (scan → match → score) | XL | ✓ YES |
| Dashboard store cards grid | S | No (separate task) |
| Purchase History tab | S | No (separate task) |
| Price URL auto-monitor | M | No (separate task) |
