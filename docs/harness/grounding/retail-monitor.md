# Grounding Doc — Retail Monitor (75_Retail_HQ.py port)

**Prepared:** 2026-05-14
**Task queue ID:** 645af95d-1435-4ccd-bd69-de83442c2010
**Status:** Pre-staged — ready for coordinator spec / acceptance doc phase.
**Overlap category:** PARTIAL — watchlist, brand risk, and Flipp API already exist; StockTrack and Arb Engine are net-new.
**Source studied:** `streamlit_app/Pages/75_Retail_HQ.py` (1465 lines) + `streamlit_app/utils/stocktrack_api.py` (437 lines)

---

## 1. What Already Exists in LepiOS

### Pages

| Page           | Route                           | What it does                                             | Functional?                                   |
| -------------- | ------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| Retail Monitor | `app/(cockpit)/retail-monitor/` | Watchlist CRUD (manual entry), Flip Calculator           | Yes — reads/writes `retail_watchlist`         |
| Retail HQ      | `app/(cockpit)/retail-hq/`      | Deals tab, Brand Risk lookup, ROI Calculator             | **Partial** — Deals tab broken (see §Bug 1.3) |
| Retail Radar   | `app/(cockpit)/retail-radar/`   | Deal signal view from watchlist, ROI sort, status filter | Yes                                           |

### API Routes

| Route                                     | What it does                          | Status                                                |
| ----------------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `GET/POST /api/retail/watchlist`          | List / create `retail_watchlist` rows | Working                                               |
| `PATCH/DELETE /api/retail/watchlist/[id]` | Update / delete watchlist item        | Working                                               |
| `GET /api/retail/deals`                   | List deals                            | **BROKEN** — queries non-existent `deals` table (500) |
| `GET /api/flyer-intel/search`             | Flipp flyer keyword search            | Working — not surfaced in any retail UI tab yet       |

### Database Tables

| Table                                       | Migration | Purpose                      | Gap                                        |
| ------------------------------------------- | --------- | ---------------------------- | ------------------------------------------ |
| `retail_watchlist`                          | 0194      | Watchlist with profit fields | Only 4 statuses; Streamlit has 8           |
| `keepa_deals`                               | 0196      | Keepa scan result cache      | No StockTrack equivalent                   |
| `deal_tracker_items` + `deal_price_history` | 0189      | Generic price-change tracker | Different model; not wired to retail pages |

### Lib Files

| File                          | Contents                                                                                                  | Complete?                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `lib/retail/types.ts`         | `RetailWatchlistItem`, `RetailWatchlistStatus` (4 values), `RETAIL_STORES` (12), `RETAIL_CATEGORIES` (11) | Missing 4 statuses                        |
| `lib/reselling/brand-risk.ts` | `BRAND_DB` (~70 entries), `lookupBrandRisk`, `scanTitleForRisk`                                           | Complete — matches Streamlit              |
| `lib/reselling/types.ts`      | `BrandRiskEntry`, `RetailDeal`, `RepricerRule`                                                            | `RetailDeal` not backed by any live table |

### Known Bug

`GET /api/retail/deals` queries `db.from('deals')` — no `deals` table in any migration. Returns 500. The Retail HQ "Deals" tab is silently broken. Fix: remap to `/api/flyer-intel/search` (Flipp) in same PR as StockTrack work.

---

## 2. StockTrack Data Source (Grounded from `stocktrack_api.py`)

### How it works

StockTrack.ca is a third-party Canadian retail inventory tracker. The API is
**reverse-engineered** from the stocktrack.ca web app. No auth key required.
Requests use a standard browser User-Agent + Referer header. Some endpoints
(search.php) may be blocked by reCAPTCHA on certain stores. Price-drop and
trending endpoints are more reliable.

**Base URL:** `https://stocktrack.ca`

### Endpoints

| Endpoint                   | Purpose                          | Key params                                                                                   |
| -------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `/{code}/search.php`       | Product search (keyword/UPC/SKU) | `q`, `n` (count), `p` (page), `t` (search/upc/sku)                                           |
| `/{code}/availability.php` | Per-store stock levels for a SKU | `loc` (comma-sep store IDs), `sku`; CT uses `store`+`sku`+`src=prod`; Staples uses `p`+`zip` |
| `/{code}/drops_data.php`   | Price drops                      | `t` (today/yesterday/weekly), `sort` (save_p/save_a/price/cat), `count`, `search`, `oos`     |
| `/{code}/trends_data.php`  | Trending products                | none                                                                                         |
| `/{code}/stores.js`        | Store location list              | none (HD: `storeDetailsData.js`)                                                             |

Response: JSON, or `var stores = [...];` JS variable format — code strips `var x =` prefix and trailing `;`.

### Store Codes (all 12 — grounded from `STORE_CODES` dict)

| Code   | Store              | Edmonton IDs (hardcoded)           | Notes                                  |
| ------ | ------------------ | ---------------------------------- | -------------------------------------- |
| `bb`   | Best Buy           | 931, 932, 935, 937, 200            |                                        |
| `ct`   | Canadian Tire      | 0467, 0397, 0288, 0614, 0347, 0334 |                                        |
| `hd`   | Home Depot         | 7043, 7046, 7044, 7091, 7188       | Prices arrive in cents — divide by 100 |
| `st`   | Staples            | postal code T5G2Y2 (lookup)        |                                        |
| `wm`   | Walmart            | 1015, 1088, 1279, 3106, 3075       | Qty may be blocked                     |
| `pa`   | **Princess Auto**  | —                                  | NOT London Drugs                       |
| `sc`   | Sport Chek         | —                                  |                                        |
| `tru`  | Toys R Us          | —                                  |                                        |
| `sdm`  | Shoppers Drug Mart | —                                  |                                        |
| `ikea` | IKEA               | —                                  |                                        |
| `lws`  | Lowe's             | —                                  |                                        |
| `rona` | Rona               | —                                  |                                        |

> Initial port scopes to 8 stores: BB, CT, HD, Staples, Walmart, Sport Chek, Toys R Us, Princess Auto. Skip sdm/ikea/lws/rona (not Colin's typical sourcing).

### User Inputs

| Field          | Type   | Notes                                            |
| -------------- | ------ | ------------------------------------------------ |
| Query          | Text   | UPC (e.g. `67341933934`), SKU, or product name   |
| Search type    | Select | `search` / `upc` / `sku`                         |
| Store          | Select | one of 8 stores                                  |
| Period (drops) | Select | `today` / `yesterday` / `weekly`                 |
| Min discount % | Slider | Default 30% for auto scan                        |
| Keyword filter | Text   | Optional — applied client-side after API returns |

### Availability Response (per store location — normalized)

```
store_id, store_name, address, city, quantity, price, on_sale (bool)
```

CT uses `Quantity`; BB/HD use `stockLevel`. HD prices in cents. `on_sale` derived from `Promo` flag or price < reg_price.

### Price Drop Fields (vary by store)

| Field         | Canadian Tire               | Best Buy       |
| ------------- | --------------------------- | -------------- |
| Product name  | `Name`                      | `Name`         |
| Sale price    | `NewPrice`                  | `salePrice`    |
| Regular price | `OldPrice`                  | `regularPrice` |
| Discount %    | `Save` (int, e.g. 90 = 90%) | `Save`         |
| Category      | `Category`                  | `Category`     |
| SKU           | `PrimarySKU`                | `Sku`          |
| Image         | `Image`                     | `Image`        |
| URL           | `Href`                      | `Href`         |

### Trending Fields (Best Buy)

`Name`, `salePrice`, `regularPrice`, `StoresInStock`, `StoresTotal`, `OnlineStock`, `OnlineStatus`, `Image`, `Href`, `Sku`

---

## 3. Streamlit Tab-by-Tab Analysis (Scoped Features)

### Tab 1 — Dashboard

Store cards grid (4 per row): emoji + store name, deal count from Google Sheet, "Last checked: {date}". Top 3 KPIs: Total Deals Found, Total Bought, Avg Est. ROI.

**LepiOS gap:** Store cards + last-checked timestamps not built yet. Retail Radar covers a partial signal view.

---

### Tab 2 — Deals (Flipp)

Keyword search or store flyer browse. Postal code input (default T5J1S9). Results filtered to selected stores. "Save to Sheet" on each row.

**LepiOS:** `/api/flyer-intel/search` works. Not wired to any UI tab. Retail HQ "Deals" tab calls the broken `/api/retail/deals` route.

---

### Tab 3 — StockTrack (4 sub-tabs — primary missing feature)

**Sub-tab A — Product Search:**

1. Enter query (UPC/SKU/keyword) + store select + search type (search/upc/sku)
2. Click Search → up to 10 products: name, SKU, price
3. "Check Stock" on product → `check_availability(store_code, sku)` → table:
   - Store Name | Address | City | Qty | Price | On Sale
4. Footer: "In stock at N/M stores checked"

**Sub-tab B — Price Drops:**

1. Store select + period (today/yesterday/weekly) + optional keyword filter
2. Click "Load Price Drops" → table: Product | Now | Was | Discount % | Category
3. (No "add to watchlist" in source — check at build time)

**Sub-tab C — Trending:**

1. Store select
2. Click "Load Trending" → table: Product | Price | Was | In Stock (X/Y stores)

**Sub-tab D — Flyer Browser:**
Uses Flipp API, not StockTrack. Deferred — low priority since Flipp route already works.

---

### Tab 4 — Auto Scan

Quick Scan: store multi-select (BB/CT/HD default), discount threshold (10–80%, default 30%), period, keyword filter. Runs `get_price_drops()` per store, filters by `Save >= threshold`. Shows results table. "Send to Telegram" checkbox → `format_deals_telegram()` + `send_alert()`.

Saved Scanner Configs: persisted to Google Sheet `🔔 Scanner Settings` (Store, Min Discount %, Keywords, Enabled, Last Scanned).

**20% better:** Streamlit requires manual click. LepiOS can support a scheduled cron via `scanner_configs.enabled` — Auto Scan becomes a background job.

---

### Tab 5 — Arb Engine (deferred)

Requires Keepa API key. Deferred to its own chunk. `app/api/keepa/*` routes must be verified before scoping.

---

### Tab 6 — Risk & Fees

**Already built.** `retail-hq` Brand Risk tab + `lib/reselling/brand-risk.ts`.

---

### Tab 7 — Calculator

Manual ROI + cashback stacking. **Partially built** in Retail Monitor "Flip Calculator" — verify at build time whether cashback presets are included.

---

### Tab 8 — History

Google Sheet filtered to: Bought, Shipped to FBA, Live on Amazon, Sold. Columns: Date, Store, Product, Category, Buy Price, Was Price, Discount %, ASIN, Est Amazon Price, Est ROI %, Status, Qty, Notes.

**LepiOS:** `retail_watchlist` filtered to terminal statuses = history view.

---

## 4. Status Workflow Gap

| Streamlit      | LepiOS      | Action               |
| -------------- | ----------- | -------------------- |
| Researching    | `watching`  | No change            |
| Buy Signal     | `active`    | No change            |
| Bought         | _(missing)_ | Add `bought`         |
| Shipped to FBA | _(missing)_ | Add `shipped_to_fba` |
| Live on Amazon | _(missing)_ | Add `live_on_amazon` |
| Sold           | `sold`      | No change            |
| Pass           | `passed`    | No change            |
| Returned       | _(missing)_ | Add `returned`       |

**Migration required:** DROP + ADD CHECK constraint, update `RetailWatchlistStatus` type, `STATUS_LABELS`, `STATUS_COLORS`.

---

## 5. Integration Points

| Module                     | Relationship                                                             |
| -------------------------- | ------------------------------------------------------------------------ |
| `lib/amazon/client.ts`     | SP-API for buy-box enrichment in Arb Engine (future)                     |
| `app/api/keepa/*`          | Arb Engine needs Keepa — verify routes before scoping                    |
| `app/(cockpit)/inventory/` | status → `shipped_to_fba` should log COGS to FBA inventory (future hook) |
| Telegram                   | Auto Scan alerts via `loeppky_daily_bot` + harness notifications pattern |

---

## 6. Tables Needed

> Before creating: `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('stocktrack_results','scanner_configs')`

### Existing — needs schema change

```sql
ALTER TABLE public.retail_watchlist DROP CONSTRAINT retail_watchlist_status_check;
ALTER TABLE public.retail_watchlist ADD CONSTRAINT retail_watchlist_status_check
  CHECK (status IN ('watching','active','bought','shipped_to_fba','live_on_amazon','sold','passed','returned'));
```

### New Tables

| Table                | Purpose                                         | Key columns                                                                                                                                   |
| -------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `stocktrack_results` | Cache API hits (4h TTL enforced at route layer) | `id`, `store_code`, `query`, `product_name`, `sku`, `current_price`, `regular_price`, `discount_pct`, `in_stock`, `product_url`, `scanned_at` |
| `scanner_configs`    | Saved auto-scan presets (replaces Google Sheet) | `id`, `store_code`, `min_discount_pct`, `keywords`, `enabled`, `last_scanned_at`, `created_at`                                                |

All new tables need F24: `GRANT INSERT, UPDATE, DELETE ON <table> TO service_role;`

---

## 7. ≥20% Better Than Streamlit

| Area              | Streamlit               | LepiOS improvement                                                      |
| ----------------- | ----------------------- | ----------------------------------------------------------------------- |
| Auto scan         | Manual click            | `scanner_configs.enabled` supports future cron — no Colin action needed |
| Result durability | Lost on close           | `stocktrack_results` cache persists across sessions                     |
| Scanner presets   | Google Sheet row edits  | `scanner_configs` Supabase table — CRUD via API                         |
| Flipp deals tab   | Broken (dead route)     | Fixed; option to save hit to watchlist                                  |
| Status workflow   | No transition rules     | API route enforces allowed transitions                                  |
| Cashback config   | Hardcoded Python source | Read from `harness_config` key — updatable without deploy               |
| F18 observability | None                    | `agent_events` row per scan: `{store_codes, results_count, timestamp}`  |

---

## 8. Out of Scope for Initial Port

- Auto Scan scheduled cron (build manual first; cron = follow-on chunk)
- Arb Engine (own chunk; Keepa routes need verification)
- IKEA / Lowe's / Rona / Shoppers store support
- `deal_tracker_items` / `deal_price_history` (unrelated generic tracker)
- Tab 3 sub-tab D Flyer Browser (Flipp already works; low priority)

---

## 9. Acceptance Criteria Skeleton

> Coordinator: expand with exact field names + penny-match targets before builder handoff.

**AC-1:** Status migration applied. All 8 statuses accepted. TypeScript type + labels updated.

**AC-2:** StockTrack Product Search: query + store + type → product list → "Check Stock" → availability table (Store | Address | City | Qty | Price | On Sale). Footer: "In stock at N/M stores."

**AC-3:** Price Drops: store + period + filter → table (Product | Now | Was | Discount | Category). Results cached in `stocktrack_results` for 4h. Second identical call within 4h returns cached data.

**AC-4:** Auto Scan Quick Run: multi-store + threshold + period → scan runs → results table. With Telegram checkbox + ≥1 deal: notification queued via harness notifications pattern.

**AC-5:** Retail HQ Deals tab fixed — calls Flipp route, shows results (no 500).

**AC-6:** Scanner configs: CRUD via API + displayed in UI config list.

**AC-7:** No `style={}` in new TSX. Service client for all writes. F24 grants in all new migrations.

**AC-8 (F18):** `agent_events` row per scan: `{event:'stocktrack_scan', store_codes, results_count}`.

---

## 10. Grounding Checkpoint

```sql
-- Current retail_watchlist status constraint
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conname LIKE '%retail_watchlist_status%';

-- Confirm new tables absent
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('stocktrack_results','scanner_configs');

-- Confirm deals table still absent (expected: 0)
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema='public' AND table_name='deals';

-- Keepa routes (shell)
-- grep -r "keepa" app/api/ --include="*.ts" -l
```

**External API:** StockTrack uses reverse-engineered endpoints (same as working Streamlit production). No auth key. Cache in `stocktrack_results` (4h TTL). Do not scrape — the JSON API is cleaner and grounded.

**Baseline:** Streamlit `75_Retail_HQ.py` + `stocktrack_api.py` are the verified reference. Use LepiOS vs. Streamlit cell-by-cell diff (same query, same store, same day) as the pass criterion for price-drop and availability output.
