# Grounding Doc — Inventory (Pages/7_Inventory.py + Pages/22_Inventory_Spend.py)

**Prepared:** 2026-05-14
**Status:** Pre-staged. Ready for coordinator spec phase.
**Overlap category:** PARTIAL — SP-API lib exists, no Inventory-specific tables yet
**Migration slots:** reserve via `node scripts/next-migration-number.mjs` at build time

---

## 1. What Already Exists in LepiOS

### SP-API lib (grounded)

| File                      | Exports                                    | Notes                                    |
| ------------------------- | ------------------------------------------ | ---------------------------------------- |
| `lib/amazon/client.ts`    | `amazonRequest()`, `spApiConfigured()`     | Auth, retry, throttle logic              |
| `lib/amazon/inventory.ts` | `getFbaInventory()`, `getInventoryAll()`   | Verify exists before coding — grep first |
| `lib/amazon/listings.ts`  | `getMerchantListings()`                    | Your listed prices by ASIN               |
| `lib/amazon/fees.ts`      | `estimateFbaFees(asin, price)` (if exists) | Check with grep before assuming          |

> Before writing any lib/ code: `grep -r "getFbaInventory\|fba_inventory\|FBA" lib/amazon/` to confirm what's already there.

### Existing migrations (grounded)

| Migration | Table          | Relevant columns                 |
| --------- | -------------- | -------------------------------- |
| 0001+     | `transactions` | Amazon sales data (check schema) |
| 0001+     | `scan_results` | ASIN, COGS, BSR (check schema)   |

No `fba_items`, `inventory_snapshots`, `inventory_spend`, or `cogs_lookup` tables exist yet.

### Existing routes

No `/api/inventory/*` routes exist. SP-API calls are currently scoped to Amazon orders/payouts.

---

## 2. Streamlit Source Analysis

### Module A — Core Inventory (Pages/7_Inventory.py)

**What it does:** FBA inventory management hub. Syncs live inventory from Amazon SP-API, tracks COGS by item, computes point-in-time snapshots, manages book pallet cost allocation.

#### Data sources

| Sheet tab                 | Purpose                                        | Key columns                                                                                           |
| ------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `📦 Inventory Snapshot`   | Point-in-time snapshots (written on each sync) | Date, TotalUnits, TotalCOGS, EstGrossRevenue, EstPayout, EstNetProfit, BooksUnits, OtherUnits         |
| `📦 FBA Items`            | Live inventory (synced from SP-API)            | ASIN, SKU, Title, Qty, Price, LastUpdated                                                             |
| `📦 Book Inventory`       | Manual book records                            | SKU, Title, Author, ASIN, Condition, List Price ($), Status (Unlisted/Listed/Sold), Date Added, Notes |
| `📦 COGS Lookup`          | Per-ASIN cost map (10k+ entries, primary)      | ASIN → cost                                                                                           |
| `🛒 Colin - Items`        | Manual fallback cost entries                   | ASIN → cost                                                                                           |
| `📦 Colin - Pallet Sales` | Pallet purchase history                        | Period (YYYY-MM), Pallets, $/Pallet, Cost, Paid, Owed                                                 |
| `📊 Amazon {YEAR}`        | YTD sales (column B = SalesOrganic)            | Used for snapshot EstGrossRevenue                                                                     |
| Amazon SP-API Reports     | Live FBA quantities + merchant listing prices  | Reports: MYI_UNSUPPRESSED + AFN_INVENTORY                                                             |

#### Core business rules

1. **Book vs Non-Book Detection:** Any ASIN present in `COGS Lookup` = non-book (known cost). All others = books (uses pallet average).
2. **Pallet Average Cost:** `Total Pallet Spend ($) / Book Units in FBA` — applied to all books lacking individual ASIN costs.
3. **COGS Hierarchy:** (1) COGS Lookup → (2) Colin - Items → (3) pallet average for books → (4) $0 for unknown non-books.
4. **Snapshot Written on Sync:** Each sync appends a new row to `📦 Inventory Snapshot` with computed financials.
5. **FBA Fee Estimation:** 30% of listing price (conservative average for books/media). See `utils/fba_fees.py` for the 2026 fee schedule with 7 book weight profiles.
6. **Sync Types:** Full (all items, 15–20s), Quick (changed items only, 5–15s), CSV upload (from Sellerboard or Seller Central).
7. **$1.00 COGS Lookup entries** are treated as book placeholders and skipped (use pallet avg instead).

#### Key displays

- **Summary metrics:** Total FBA Units, Total COGS, Est Gross Revenue, Est Net Profit
- **FBA Items table:** ASIN, SKU, Title, Qty, Price, COGS per unit, Est Profit per unit
- **Book Inventory table:** with pagination (50/100/250 per page), Status filter (Unlisted/Listed/Sold)
- **Pallet Sales table:** Period, Pallets, Cost, running pallet average
- **Inventory Snapshot history:** sparkline/table of units + COGS over time
- **FBA fee calculator:** per-item fee breakdown using 2026 Amazon schedule

---

### Module B — Inventory Spend (Pages/22_Inventory_Spend.py)

**What it does:** Tracks monthly inventory purchases from bank statement PDFs. AI-extracts inventory transactions, links to monthly buying goals, stores in Google Sheets.

#### Data sources

| Source                           | Purpose                              | Key fields                                                                                                      |
| -------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `📦 Inventory Spend` sheet       | Transaction log                      | Import Date, Transaction Date, Month, Year, Store, Raw Description, Amount ($), Card, Statement File, Drive URL |
| `📁 Bank Statements` sheet       | Statement metadata registry          | Upload Date, Filename, Card, Statement Period, Drive URL, Notes                                                 |
| Colin Masterfile (Goal Tracking) | Monthly buying goal                  | need_to_buy_goal, gross_sales_goal, est_profit_goal, est_fba_fees_goal                                          |
| Bank statement PDFs              | Source transactions (via pdfplumber) | Stored in Google Drive after upload                                                                             |
| Anthropic Claude API             | AI extraction of inventory purchases | First 12k chars of PDF text                                                                                     |

#### Core business rules

1. **Card Classification:**
   - Business cards (all purchases reviewed): Amex Platinum, Amex Marriott, TD Aeroplan Visa, Canadian Tire MC, Costco MC
   - Personal card (filtered): Capital One Mastercard — only clear resale items flagged (LEGO, books, tools, appliances, toys, DVDs, laptops, watches, video games)
2. **Business Card Exclusions:** gas/fuel, dining/restaurants, pharmacy, grocery, alcohol, clothing
3. **Store Mapping:** 20+ keywords → normalized store names (Walmart, Best Buy, Costco, etc.)
4. **Inventory Categories:** 18 categories (LEGO sets, books, tools, appliances, toys, etc.)
5. **PDF Fallback:** If AI extraction returns 0 results → keyword scan as fallback
6. **Date normalization:** Handles YYYY-MM-DD, "Jan 02 2026", "01/02/2026" and other formats

#### Key displays

- **Monthly progress:** Spent / Goal bar, YTD total
- **Transaction table:** Date, Store, Amount, Card, Category (editable)
- **Statement registry:** Uploaded PDFs with Drive links
- **Spend by card / by store breakdown**

---

## 3. Integration Points

These LepiOS modules will consume or produce Inventory data:

| Module                         | Relationship                                             |
| ------------------------------ | -------------------------------------------------------- |
| `app/(cockpit)/amazon/`        | Same SP-API auth. Inventory is a separate section.       |
| `app/(cockpit)/bookkeeping/`   | Monthly COGS feeds into business expense reconciliation  |
| `app/(cockpit)/net-worth/`     | Book inventory value in net worth snapshot               |
| `app/(cockpit)/monthly-close/` | Inventory COGS feeds April close + future monthly closes |
| `lib/amazon/client.ts`         | Reuse for SP-API calls — already handles auth + retry    |

---

## 4. Tables Needed (Proposed Schema)

> Confirm none of these exist before creating: `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%inventor%'`

| Table                 | Purpose                                 | Key columns                                                                                                               |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `fba_items`           | Live FBA inventory (synced from SP-API) | id, asin, sku, title, qty, price, cogs_per_unit, cogs_source (lookup/pallet_avg/manual), last_synced_at                   |
| `inventory_snapshots` | Point-in-time snapshots                 | id, taken_at, total_units, books_units, other_units, total_cogs, est_gross_revenue, est_payout, est_net_profit, sync_type |
| `cogs_lookup`         | Per-ASIN cost map                       | asin (PK), cost_cad, source (lookup/manual), updated_at                                                                   |
| `pallet_purchases`    | Book pallet history                     | id, period_month (YYYY-MM), pallets, cost_per_pallet, total_cost, paid, owed                                              |
| `inventory_spend`     | Inventory purchase transactions         | id, transaction_date, store, raw_description, amount_cad, card, category, statement_file, imported_at, month, year        |
| `bank_statements`     | Statement metadata registry             | id, uploaded_at, filename, card, statement_period_start, statement_period_end, drive_url, notes                           |

All tables need F24 grants: `GRANT INSERT, UPDATE, DELETE ON <table> TO service_role;`

---

## 5. ≥20% Better Than Streamlit

| Area                 | Streamlit limitation                                 | LepiOS improvement                                                                         |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Data freshness**   | Sync is manual — Colin must click sync button        | Scheduled nightly SP-API sync (cron) with last-sync timestamp shown in cockpit             |
| **COGS source**      | COGS Lookup is a 10k-row Google Sheet (slow to load) | Postgres `cogs_lookup` table with indexed ASIN lookups — instant                           |
| **Snapshot history** | Row in Google Sheet, no visualization                | Supabase table + Recharts line chart (units + COGS over time, last 90 days)                |
| **Pallet avg**       | Recomputed on every load from Google Sheet           | Stored in snapshot row; pallet purchases in Postgres, avg computed via SQL                 |
| **Bank stmt AI**     | Claude API call happens in-session (blocks UI)       | Background job: upload → queue → async extraction → Telegram notification                  |
| **Spend history**    | Filtered view only, no trend chart                   | Monthly spend vs. goal bar chart, 12-month rolling spend trend                             |
| **Book status**      | Manual status updates in Google Sheet                | Status transitions driven by scan + sales events (auto-mark Sold when Amazon sale arrives) |
| **Observability**    | No F18 metrics, no sync failure alerts               | Sync results logged to `agent_events`, Telegram alert if sync fails or COGS missing        |

---

## 6. Out of Scope for Initial Port

- CSV upload from Sellerboard (handle SP-API sync first; CSV is an edge-case fallback)
- FBA fee calculator tab (reference tool; can be a follow-on chunk)
- Grocery inventory (`🥑 Grocery Inventory`) — completely separate schema, defer
- LEGO Vault inventory — already in LepiOS scope separately
- Aged inventory surcharge calculator — reference tool, defer

---

## 7. Acceptance Criteria Skeleton

> Coordinator: expand each criterion with exact field names and penny-match targets before handing to builder.

**AC-1:** FBA sync route (`POST /api/inventory/sync`) fetches live SP-API data, upserts `fba_items`, appends `inventory_snapshots` row, returns `{ ok: true, items_synced: N, snapshot_id: uuid }`. Requires CRON_SECRET (F22).

**AC-2:** Inventory cockpit page at `/inventory` shows: total units, total COGS, est gross revenue, est net profit — matching the most recent `inventory_snapshots` row within ±$1.

**AC-3:** FBA Items table renders with ASIN, SKU, title, qty, price, COGS per unit, est profit per unit. COGS source shown (lookup / pallet avg / manual). Sortable by qty descending and profit descending.

**AC-4:** Book pallet average cost computed correctly: `SUM(total_cost) / SUM(book_units_in_fba)` and displayed in cockpit.

**AC-5:** Snapshot history line chart (last 90 days): total units + COGS over time. Zero regressions in existing charts (F18 check).

**AC-6:** No `style={}` in any new TSX files (F20). All Supabase writes use service role. Migration includes grants (F24).

**AC-7 (Spend module):** Inventory Spend table at `/inventory/spend` shows transaction rows from `inventory_spend` with Date, Store, Amount, Card, Category columns. Monthly total vs. goal shown as progress bar.

---

## 8. Grounding Checkpoint

Before builder starts: coordinator must run the following and paste results into the acceptance doc:

```sql
-- Confirm tables don't already exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('fba_items', 'inventory_snapshots', 'cogs_lookup', 'pallet_purchases', 'inventory_spend', 'bank_statements');

-- Confirm SP-API is live in production
SELECT value FROM harness_config WHERE key IN ('SP_API_REFRESH_TOKEN', 'AMAZON_SELLER_ID');

-- Confirm next migration number
-- node scripts/next-migration-number.mjs
```

Grounding baseline: use Streamlit-parity diff (cell-by-cell LepiOS vs. Streamlit for a single snapshot date). Streamlit is verified-correct for current inventory data.
