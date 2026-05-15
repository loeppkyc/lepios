# Acceptance Doc — Retail Monitor (StockTrack Port)

**Task queue ID:** 645af95d-1435-4ccd-bd69-de83442c2010
**Sprint:** 7
**Prepared:** 2026-05-14
**Status:** awaiting_builder_assignment
**Grounding doc:** `docs/harness/grounding/retail-monitor.md`
**Sources studied:** `streamlit_app/Pages/75_Retail_HQ.py` + `streamlit_app/utils/stocktrack_api.py`

---

## Phase 1a — Streamlit Study

This chunk scopes to: **StockTrack integration** (Tab 3, sub-tabs A–C), **Auto Scan quick-run** (Tab 4), **Flipp Deals tab fix** (Tab 2 broken route), and **status schema expansion** required by all retail pages.

### What the Streamlit does (scoped tabs)

**Tab 3A — Product Search:**

- Input: UPC/SKU/keyword text + store select + search type (search/upc/sku)
- API: `GET https://stocktrack.ca/{code}/search.php?q=...&n=10&t=search`
- Shows up to 10 products: name, SKU, price
- "Check Stock" fires `availability.php` with Edmonton store IDs for that retailer
- Availability table: Store Name | Address | City | Qty | Price | On Sale
- Footer: "In stock at N/M stores checked"

**Tab 3B — Price Drops:**

- Input: store select + period (today/yesterday/weekly) + optional keyword
- API: `GET /{code}/drops_data.php?t={period}&sort=save_p&count=50`
- Table: Product | Now | Was | Discount % | Category
- Field names vary: CT uses `NewPrice`/`OldPrice`/`PrimarySKU`; BB uses `salePrice`/`regularPrice`/`Sku`

**Tab 3C — Trending:**

- Input: store select
- API: `GET /{code}/trends_data.php`
- Table: Product | Price | Was | In Stock (StoresInStock/StoresTotal)

**Tab 4 — Auto Scan:**

- Multi-store select (default BB/CT/HD), discount threshold slider (10–80%, default 30%), period, keyword filter
- Runs price-drop fetch per selected store, filters by `Save >= threshold`
- Results table + optional Telegram alert via `format_deals_telegram()` + `send_alert()`
- Saved Scanner Configs stored to Google Sheet (Store, Min Discount %, Keywords, Enabled, Last Scanned)

**Tab 2 fix:**

- `/api/retail/deals` calls `db.from('deals')` — table does not exist → 500
- Fix: replace route body with call to Flipp `/api/flyer-intel/search`
- Flipp route already works; postal code default T6H (Edmonton)

**Status schema gap:**

- Streamlit: Researching, Buy Signal, Bought, Shipped to FBA, Live on Amazon, Sold, Pass, Returned (8)
- LepiOS `retail_watchlist`: watching, active, passed, sold (4)
- Missing: `bought`, `shipped_to_fba`, `live_on_amazon`, `returned`

### StockTrack API (grounded)

No auth. Reverse-engineered endpoints. Edmonton store IDs hardcoded in the Python source:

- Best Buy: 931, 932, 935, 937, 200
- Canadian Tire: 0467, 0397, 0288, 0614, 0347, 0334
- Home Depot: 7043, 7046, 7044, 7091, 7188
- Staples: postal code T5G2Y2
- Walmart: 1015, 1088, 1279, 3106, 3075 (qty may be blocked)

Store code `pa` = Princess Auto (not London Drugs).
Home Depot prices arrive in cents — divide by 100.
search.php may hit reCAPTCHA; drops_data.php and trends_data.php are reliable.

---

## Phase 1b — Resolved Ambiguities

| Question                   | Decision                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| StockTrack API vs scraper? | API (reverse-engineered, same as Streamlit production). No auth key needed.                  |
| Which 8 stores?            | BB, CT, HD, Staples, Walmart, Sport Chek, Toys R Us, Princess Auto. Skip sdm/ikea/lws/rona.  |
| Cache results?             | Yes — `stocktrack_results` table, 4h TTL enforced at route layer.                            |
| Arb Engine in this chunk?  | No — deferred. Requires Keepa routes verification. Own chunk.                                |
| Fix `/api/retail/deals`?   | Yes — same PR, 5-line fix. Remap to Flipp `/api/flyer-intel/search`.                         |
| Saved scanner presets?     | Yes — `scanner_configs` Supabase table, replaces Google Sheet.                               |
| Tab 3D Flyer Browser?      | Deferred — Flipp already works; low priority vs. StockTrack tabs.                            |
| Telegram format?           | Use existing harness notifications pattern (`outbound_notifications` table) not direct send. |

---

## Phase 1c — ≥20% Better Than Streamlit

| Area            | Streamlit limit           | LepiOS improvement                                                                                   |
| --------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Auto scan       | Manual click to run       | `scanner_configs.enabled` supports future cron — architecture is cron-ready even if cron ships later |
| Result history  | Lost on page close        | `stocktrack_results` persists across sessions; can show "last seen at X" per product                 |
| Scanner presets | Google Sheet manual edits | `scanner_configs` Supabase table — CRUD via API, instantly queryable                                 |
| Deals tab       | Always 500                | Fixed to working Flipp route                                                                         |
| Status workflow | 8 strings, no enforcement | API validates allowed transitions; no silent status corruption                                       |
| Cashback rate   | Hardcoded in Python       | Read from `harness_config` — user-updatable without code deploy                                      |
| Observability   | None                      | `agent_events` row per scan: store_codes, results_count, timestamp                                   |

---

## Phase 1d — Acceptance Criteria

### Pre-build checks (coordinator runs these before handing to builder)

```sql
-- 1. Verify retail_watchlist current status constraint (expect 4 values)
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conname LIKE '%retail_watchlist_status%';

-- 2. Confirm new tables absent (expect 0 rows)
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('stocktrack_results','scanner_configs');

-- 3. Reserve migration number
-- node scripts/next-migration-number.mjs
```

```bash
# 4. Verify Keepa routes exist (for builder awareness — NOT in scope this chunk)
grep -r "keepa" app/api/ --include="*.ts" -l
```

---

### Migration — `NNNN_retail_monitor_stocktrack.sql`

```sql
-- 1. Expand retail_watchlist status CHECK
ALTER TABLE public.retail_watchlist
  DROP CONSTRAINT retail_watchlist_status_check;
ALTER TABLE public.retail_watchlist
  ADD CONSTRAINT retail_watchlist_status_check
  CHECK (status IN (
    'watching','active','bought','shipped_to_fba',
    'live_on_amazon','sold','passed','returned'
  ));

-- 2. StockTrack results cache
CREATE TABLE public.stocktrack_results (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code    text         NOT NULL,
  query         text,
  product_name  text         NOT NULL,
  sku           text,
  current_price numeric(10,2),
  regular_price numeric(10,2),
  discount_pct  numeric(5,1),
  in_stock      boolean      NOT NULL DEFAULT false,
  product_url   text,
  scanned_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX stocktrack_results_store_scanned ON public.stocktrack_results (store_code, scanned_at DESC);
CREATE INDEX stocktrack_results_sku           ON public.stocktrack_results (sku);
ALTER TABLE public.stocktrack_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY stocktrack_results_service_rw ON public.stocktrack_results
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT INSERT, UPDATE, DELETE ON public.stocktrack_results TO service_role;

-- 3. Scanner configs (replaces Google Sheet "🔔 Scanner Settings")
CREATE TABLE public.scanner_configs (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code       text         NOT NULL,
  min_discount_pct numeric(5,1) NOT NULL DEFAULT 30.0,
  keywords         text,
  enabled          boolean      NOT NULL DEFAULT true,
  last_scanned_at  timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);
ALTER TABLE public.scanner_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY scanner_configs_service_rw ON public.scanner_configs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT INSERT, UPDATE, DELETE ON public.scanner_configs TO service_role;
```

---

### New Routes

| Route                          | Method       | Auth | Purpose                                                                                                                             |
| ------------------------------ | ------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/api/stocktrack/search`       | GET          | user | `?store={code}&q={query}&type={search\|upc\|sku}` → calls search.php → `{products:[]}`                                              |
| `/api/stocktrack/availability` | GET          | user | `?store={code}&sku={sku}` → availability.php with Edmonton IDs → `{stores:[{store_name,city,qty,price,on_sale}]}`                   |
| `/api/stocktrack/drops`        | GET          | user | `?store={code}&period={...}&min_pct={n}&search={q}` → drops_data.php → cache → `{drops:[]}`                                         |
| `/api/stocktrack/trending`     | GET          | user | `?store={code}` → trends_data.php → `{trending:[]}`                                                                                 |
| `/api/stocktrack/scan`         | POST         | user | `{store_codes, min_discount_pct, period, keywords?, send_telegram?}` → multi-store scan → `{deals:[], stores_scanned, deals_found}` |
| `/api/scanner-configs`         | GET/POST     | user | List / create `scanner_configs` rows                                                                                                |
| `/api/scanner-configs/[id]`    | PATCH/DELETE | user | Update / delete config                                                                                                              |

**`/api/retail/deals` fix:**
Replace `db.from('deals').select(...)` with a call to the Flipp search logic (extract shared function or import from flyer-intel handler). Return `{items:[]}` shaped as Flipp results.

---

### TypeScript Changes

**`lib/retail/types.ts`**

```typescript
// Before: 4 statuses
export type RetailWatchlistStatus = 'watching' | 'active' | 'passed' | 'sold'

// After: 8 statuses
export type RetailWatchlistStatus =
  | 'watching'
  | 'active'
  | 'bought'
  | 'shipped_to_fba'
  | 'live_on_amazon'
  | 'sold'
  | 'passed'
  | 'returned'

export const STATUS_LABELS: Record<RetailWatchlistStatus, string> = {
  watching: 'Watching',
  active: 'Active Deal',
  bought: 'Bought',
  shipped_to_fba: 'Shipped to FBA',
  live_on_amazon: 'Live on Amazon',
  sold: 'Sold',
  passed: 'Passed',
  returned: 'Returned',
}

export const STATUS_COLORS: Record<RetailWatchlistStatus, string> = {
  watching: 'bg-blue-900/40 text-blue-300',
  active: 'bg-green-900/40 text-green-300',
  bought: 'bg-purple-900/40 text-purple-300',
  shipped_to_fba: 'bg-indigo-900/40 text-indigo-300',
  live_on_amazon: 'bg-amber-900/40 text-amber-300',
  sold: 'bg-teal-900/40 text-teal-300',
  passed: 'bg-zinc-800 text-zinc-400',
  returned: 'bg-red-900/30 text-red-400',
}
```

**New lib file:** `lib/retail/stocktrack-client.ts`

TypeScript port of `stocktrack_api.py`. Exports:

- `STOCKTRACK_STORES: Record<string, string>` — the 8 in-scope store codes → display names
- `EDMONTON_STORE_IDS: Record<string, string[]>` — hardcoded IDs
- `searchProduct(storeCode, query, type): Promise<StockTrackProduct[]>`
- `checkAvailability(storeCode, sku): Promise<StoreAvailability[]>`
- `getPriceDrops(storeCode, opts): Promise<PriceDrop[]>`
- `getTrending(storeCode): Promise<TrendingProduct[]>`
- `scanForDeals(storeCodes, minDiscountPct, period): Promise<Deal[]>`

---

### UI Changes

**`app/(cockpit)/retail-monitor/_components/StockTrackPanel.tsx`** — new file

Three sub-tabs within a `<Tabs>` component:

1. Product Search: query input + store select + type select → product list → "Check Stock" → availability table
2. Price Drops: store + period + filter → drops table
3. Trending: store → trending table

No `style={}` attributes. Use shadcn/ui `Tabs`, `Select`, `Table`, `Badge` components.

**`app/(cockpit)/retail-monitor/page.tsx` or top-level component** — add StockTrack and Auto Scan tabs to existing tab set.

**`app/(cockpit)/retail-hq/_components/RetailHQPage.tsx`** — fix Deals tab call.

---

### Acceptance Tests

**AC-1 — Status migration**

```sql
-- Pass: all 8 values accepted without constraint error
INSERT INTO retail_watchlist (product, store, status)
VALUES ('test','Test','bought'),('test','Test','shipped_to_fba'),
       ('test','Test','live_on_amazon'),('test','Test','returned');
-- Cleanup
DELETE FROM retail_watchlist WHERE product = 'test';
```

TypeScript: `RetailWatchlistStatus` type compiles with all 8 values. `STATUS_LABELS` has 8 keys.

**AC-2 — StockTrack Product Search**

- `GET /api/stocktrack/search?store=bb&q=lego+technic&type=search` → 200, `{products:[...]}` with name/sku/price fields
- `GET /api/stocktrack/availability?store=bb&sku=12345` → 200, `{stores:[...]}` each with store_name/city/quantity/price/on_sale
- Availability for BB uses store IDs subset of {931,932,935,937,200}

**AC-3 — Price Drops with cache**

- `GET /api/stocktrack/drops?store=ct&period=today&min_pct=20` → 200, `{drops:[...]}`, row count in `stocktrack_results` increases
- Second identical call within 4h → same response, `stocktrack_results` scanned_at unchanged
- Each drop has: product_name, current_price, regular_price, discount_pct, category

**AC-4 — Auto Scan + Telegram**

- `POST /api/stocktrack/scan` `{store_codes:["bb","ct"],min_discount_pct:30,period:"today",send_telegram:false}` → 200, `{deals:[...],stores_scanned:2}`
- With `send_telegram:true` and ≥1 deal: row in `outbound_notifications` with Telegram-formatted text
- `agent_events` row: `{event:'stocktrack_scan',store_codes,results_count}`

**AC-5 — Retail HQ Deals tab**

- `GET /retail-hq` renders without JS errors
- Deals tab renders Flipp items (name, store, price, savings, valid dates), no 500 error

**AC-6 — Scanner Configs CRUD**

- `POST /api/scanner-configs` `{store_code:"bb",min_discount_pct:25}` → 201, `{id:uuid}`
- `GET /api/scanner-configs` includes created row
- `DELETE /api/scanner-configs/{id}` → 204

**AC-7 — Quality gates**

- `grep -r 'style=' app/(cockpit)/retail-monitor/_components/StockTrackPanel.tsx` → 0 matches (F20)
- All writes in new routes use `createServiceClient()` not `createClient()`
- Migration includes F24 grants for both new tables

**AC-8 — F18 observability**

- `SELECT * FROM agent_events WHERE event='stocktrack_scan' ORDER BY occurred_at DESC LIMIT 1` returns a row after a scan run

---

## GitHub Prior Art Check (Architecture §8.4)

| Problem                | Decision                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| StockTrack HTTP client | **Reference** — port `stocktrack_api.py` logic directly as `lib/retail/stocktrack-client.ts`. No npm package for StockTrack exists. |
| React data table       | **Wrap** — shadcn/ui Table or existing DataTable pattern in codebase.                                                               |
| SWR / cache layer      | **Build-new** — simple `fetch` + route-layer TTL check against `stocktrack_results.scanned_at`. No SWR in project.                  |

---

## F17 Connection (Behavioral Ingestion)

- StockTrack scan → buy decision → `retail_watchlist` status transition → FBA inventory → sale signal
- Each `stocktrack_scan` event in `agent_events` feeds the buy-timing signal
- `stocktrack_results` cache + watchlist status changes generate retail arb patterns for the prediction engine

## F18 Measurement

| Metric                  | Unit       | Source                                                                   | Baseline / Target                            |
| ----------------------- | ---------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| Scan runs               | count/week | `agent_events` WHERE event='stocktrack_scan'                             | 0 → target ≥3/week                           |
| Deals found per scan    | count      | `agent_events.metadata.results_count`                                    | Target ≥10 actionable per weekly scan        |
| Cache hit rate          | %          | `stocktrack_results` hits vs. fresh fetches (same store+query within 4h) | Target ≥40% after first week                 |
| Status progression rate | %          | `retail_watchlist` transitions watching→active→bought                    | Baseline from Streamlit Google Sheet history |
