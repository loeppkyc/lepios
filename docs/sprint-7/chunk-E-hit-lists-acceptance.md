# Acceptance Doc — Chunk E: Hit Lists Cockpit UI

**Sprint:** 7
**Prepared:** 2026-05-15
**Status:** awaiting_builder_assignment
**Migration:** none (existing tables are sufficient — see findings below)

---

## Phase 1a — Codebase Study

### What already exists

**Critical discovery: the existing `/hit-lists` page is a book-scanner tool, NOT a retail deal scanner.**

The current `HitListClient.tsx` (483 lines) manages named ISBN lists for PageProfit book
scanning. It has:

- Create/delete named lists
- Bulk-paste ISBNs into a list
- Trigger batch scans (`/api/scan` per ISBN at a user-specified cost)
- Display scanned results (BUY/SKIP decisions)

This is a distinct domain from the "nightly Telegram deal scan results" described in the task brief.

**The hit-list tables (`hit_lists`, `hit_list_items`)** are ISBN-centric:

```sql
hit_list_items: isbn, status ('pending'|'scanned'|'skipped'), scan_result_id
```

These tables have no columns for: ASIN, source, margin, BSR, deal_score.

**The nightly deal scan results** live in `stocktrack_results`:

```sql
stocktrack_results: store_code, query, product_name, sku, current_price, regular_price, discount_pct, in_stock, scanned_at
```

And deal alerts that were sent to Telegram are in `outbound_notifications` (but not structured for querying by deal attributes).

**`retail_watchlist`** is where Colin saves retail deals he wants to track:

```sql
retail_watchlist: product, brand, asin, store, buy_price, regular_price, pct_off, est_profit, roi_pct, status, notes
```

**Conclusion:** The task brief's "Hit Lists Cockpit UI" at `/hit-lists` refers to the existing
ISBN list management tool. There is no separate "nightly Telegram deal scan" cockpit page. The
correct interpretation is one of two things:

**Option A:** Enhance the existing `/hit-lists` book scanner tool with the filterable
deal-results view the brief describes — adding a second tab that shows StockTrack scan
results (from `stocktrack_results`) with "Add to Watchlist" actions.

**Option B:** Create a new cockpit page (`/deal-results` or `/scan-results`) that shows
`stocktrack_results` in a filterable table with inline watchlist actions — leaving the
existing `/hit-lists` ISBN tool unchanged.

**Coordinator recommendation: Option A** — add a "Scan Results" tab to the existing
`/hit-lists` page using the `stocktrack_results` table. The existing hit-list ISBN workflow
stays as Tab 1; Tab 2 shows recent StockTrack deal scan results. This keeps the "hit lists"
framing (a list of potential buys) without creating a new route Colin needs to navigate to.

The "Add to Watchlist" action inserts a `retail_watchlist` row. "Skip" logs an
`agent_events` row and is done.

---

## Phase 1b — Resolved Ambiguities

| Question                                       | Decision                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is the data source for deal scan results? | `stocktrack_results` table — written by `/api/stocktrack/scan` and `/api/stocktrack/drops`                                                                                                                                                                                                    |
| Does this need a new migration?                | No — `stocktrack_results` and `retail_watchlist` already exist with correct schemas                                                                                                                                                                                                           |
| What is "deal score"?                          | `discount_pct` from `stocktrack_results`. No separate deal_score field exists; use discount_pct as the proxy.                                                                                                                                                                                 |
| What is BSR?                                   | BSR (Amazon Best Sellers Rank) is not available in StockTrack data. Omit from the spec — there is no data source for it in this chunk.                                                                                                                                                        |
| What is margin?                                | `est_profit` from `retail_watchlist` (set at buy decision). Not computable from `stocktrack_results` alone (no Amazon price). Omit from the results table — show only what StockTrack provides: `product_name, store_code, current_price, regular_price, discount_pct, in_stock, scanned_at`. |
| "Add to Watchlist" shape?                      | Insert `retail_watchlist` row with `product=product_name, store=STORE_LABELS[store_code], buy_price=current_price, regular_price=regular_price, pct_off=discount_pct, status='watching'`                                                                                                      |
| Route location?                                | `/api/retail/watchlist` — check if it already exists                                                                                                                                                                                                                                          |
| What is the "Skip" action?                     | Remove the row from the UI view (client-side filter on `skipped_asins` local state). Log to `agent_events`. No DB write — stocktrack_results is a scan cache, not a review queue.                                                                                                             |
| ASIN in the results?                           | StockTrack results do not include ASIN — no SP-API lookup in this chunk. Omit ASIN column.                                                                                                                                                                                                    |
| Date filter default?                           | Last 7 days of scans.                                                                                                                                                                                                                                                                         |
| Source filter?                                 | Dropdown of store codes present in the returned results.                                                                                                                                                                                                                                      |

---

## Phase 1c — ≥20% Better

| Area                 | Current state                                                       | LepiOS improvement                                                                                        |
| -------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Deal review workflow | No UI at all — deal alerts arrive via Telegram only, then disappear | Persistent filterable table: Colin can review deals from any scan session, not just the last notification |
| Action               | Telegram message shows deals; Colin has to manually navigate to buy | One-click "Add to Watchlist" from the results table → deal enters the tracked pipeline                    |
| Skip/dismiss         | No record of passed deals                                           | Skip dismisses from view (client-side); prevents repeated notification fatigue                            |
| Freshness            | Telegram alert is ephemeral                                         | Results tab shows scan freshness: "Last scan: 2 hours ago — 47 deals from BB, CT"                         |
| Filtering            | None                                                                | Filter by store, date range, min discount %                                                               |

---

## Phase 1d — Acceptance Criteria

### Pre-build checks (coordinator runs before handing to builder)

```sql
-- 1. Confirm stocktrack_results schema matches what we need
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='stocktrack_results'
ORDER BY ordinal_position;

-- 2. Confirm retail_watchlist schema supports the Add-to-Watchlist insert
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='retail_watchlist'
ORDER BY ordinal_position;

-- 3. Check if /api/retail/watchlist route already exists
-- (Bash): grep -r "retail/watchlist\|watchlist" app/api --include="*.ts" -l

-- 4. Verify stocktrack_results has rows (scan has run at least once)
SELECT COUNT(*), MIN(scanned_at), MAX(scanned_at) FROM stocktrack_results;
```

---

### No Migration Required

`stocktrack_results` and `retail_watchlist` both exist with correct schemas from migrations
0194 and 0204. Builder must NOT create duplicate tables.

---

### New Route

| Route                     | Method | Auth | Purpose                                                |
| ------------------------- | ------ | ---- | ------------------------------------------------------ |
| `/api/retail/watchlist`   | POST   | user | Add a deal from stocktrack_results to retail_watchlist |
| `/api/stocktrack/results` | GET    | user | Paginated query of stocktrack_results with filters     |

**Note:** If `/api/retail/watchlist` (POST) already exists, beef it up rather than replace it.
Builder must grep for the file before creating it.

**`GET /api/stocktrack/results`**

Query params:

- `days` (default 7) — how many days back to show
- `store` (optional) — filter by `store_code`
- `min_discount` (default 0) — minimum `discount_pct`
- `limit` (default 100)

Response:

```json
{
  "results": [
    {
      "id": "uuid",
      "store_code": "bb",
      "store_label": "Best Buy",
      "product_name": "...",
      "sku": "...",
      "current_price": 49.99,
      "regular_price": 79.99,
      "discount_pct": 37.5,
      "in_stock": true,
      "scanned_at": "2026-05-14T18:00:00Z"
    }
  ],
  "total": 47,
  "stores_present": ["bb", "ct", "hd"],
  "latest_scan_at": "2026-05-14T18:00:00Z"
}
```

**`POST /api/retail/watchlist`**

Request body:

```json
{
  "product": "Lego Technic 42...",
  "store": "Best Buy",
  "buy_price": 49.99,
  "regular_price": 79.99,
  "pct_off": 37.5,
  "notes": "optional"
}
```

Response: `{id: uuid}` (201). Inserts `retail_watchlist` row with `status='watching'`.

---

### UI Changes

**`app/(cockpit)/hit-lists/page.tsx`** — add Tabs wrapper

**`app/(cockpit)/hit-lists/_components/HitListClient.tsx`** — becomes Tab 1 ("Book Lists"), unchanged in behavior

**`app/(cockpit)/hit-lists/_components/ScanResultsTab.tsx`** — new Tab 2 ("Scan Results")

Tab 2 layout:

```
[Filter: Store ▼] [Min Discount: ___% ] [Days: 7 ▼]
                                                [Last scan: 2h ago — 47 deals]

| Product         | Store    | Price    | Was      | Discount | In Stock | Scanned |   |
|-----------------|----------|----------|----------|----------|----------|---------|---|
| Lego Technic... | Best Buy | $49.99   | $79.99   | 37%      | Yes      | 2h ago  | [+ Watch] [Skip] |
| ...             |          |          |          |          |          |         |   |
```

No `style={}` inline attributes (F20). Use shadcn/ui `Table`, `Select`, `Badge` components.
Use Tailwind utility classes for layout.

**Tab structure:**

Use shadcn/ui `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`:

```tsx
<Tabs defaultValue="book-lists">
  <TabsList>
    <TabsTrigger value="book-lists">Book Lists</TabsTrigger>
    <TabsTrigger value="scan-results">Scan Results</TabsTrigger>
  </TabsList>
  <TabsContent value="book-lists">
    <HitListClient />
  </TabsContent>
  <TabsContent value="scan-results">
    <ScanResultsTab />
  </TabsContent>
</Tabs>
```

**HitListClient.tsx:** the existing component uses `style={}` inline attrs extensively
(this is existing code, not new — do not refactor it as part of this chunk). Only new code
in `ScanResultsTab.tsx` must be style={}-free.

**ScanResultsTab.tsx behaviors:**

- Loads results on mount via `GET /api/stocktrack/results?days=7`
- Store filter updates query param and refetches
- Min discount slider (0–80%, step 5) updates query param and refetches (client-side filter acceptable for ≤200 rows)
- "Add to Watchlist" button: calls `POST /api/retail/watchlist` → shows "Added" flash, button changes to "In Watchlist" (disabled)
- "Skip" button: removes row from view via client-state filter; logs `agent_events` row
- Empty state: "No scan results in the last 7 days — run a StockTrack scan from the Retail Monitor page"
- Error state: standard LepiOS error display

---

### Acceptance Tests

**AC-1 — Tab navigation**

- `GET /hit-lists` renders without JS errors
- "Book Lists" tab shows existing HitListClient content (unchanged)
- "Scan Results" tab renders without JS errors

**AC-2 — Results table populated**

- If `stocktrack_results` has rows in the last 7 days: table renders with correct columns
- If no rows: empty state message renders
- `GET /api/stocktrack/results?days=7` → 200, `{results:[], total:0, stores_present:[], latest_scan_at:null}` (empty is valid)

**AC-3 — Add to Watchlist**

Prereq: at least one `stocktrack_results` row exists.

- Click "+ Watch" on any result row
- `POST /api/retail/watchlist` called with correct body
- `SELECT * FROM retail_watchlist WHERE product = '{product_name}' ORDER BY created_at DESC LIMIT 1` returns row with `status='watching'`
- Button changes to "In Watchlist" (disabled)
- Cleanup: `DELETE FROM retail_watchlist WHERE id = '{returned_id}'`

**AC-4 — Skip dismissal**

- Click "Skip" on a result row → row disappears from view
- `SELECT COUNT(*) FROM agent_events WHERE action='deal_skip'` increases by 1

**AC-5 — Quality gates**

- `grep -rn 'style=' app/(cockpit)/hit-lists/_components/ScanResultsTab.tsx` → 0 matches (F20)
- All writes in new routes use `createServiceClient()` not `createClient()`
- No new migration applied (tables already exist)

**AC-6 — F18 observability**

- After "Add to Watchlist": `SELECT COUNT(*) FROM agent_events WHERE action='watchlist_add'` increases by 1

---

## GitHub Prior Art Check (Architecture §8.4)

| Problem                    | Decision                                                                       |
| -------------------------- | ------------------------------------------------------------------------------ |
| Filterable data table      | **Wrap** — shadcn/ui Table. Already in project.                                |
| Tab navigation             | **Wrap** — shadcn/ui Tabs. Already in project.                                 |
| Store code → label mapping | **Beef-up** — reuse `STOCKTRACK_STORES` from `lib/retail/stocktrack-client.ts` |

---

## F17 Connection (Behavioral Ingestion)

"Add to Watchlist" is the key signal: it captures the moment Colin decides a retail deal
is worth tracking. This decision point is the entry into the retail arb pipeline
(watching → bought → shipped_to_fba → sold). Each transition is a behavioral signal for
the prediction engine — "how often does Colin buy something he watches?", "which discount
threshold actually leads to purchases?", "which stores generate buys?".

The scan results view closes the loop on nightly scan → buy decision, which was previously
invisible (Telegram alert sent, deal either acted on or forgotten with no record).

---

## F18 Measurement

| Metric                   | Unit  | Source                                                                                | Baseline / Target                                      |
| ------------------------ | ----- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Deals reviewed per week  | count | `stocktrack_results` rows surfaced in tab, `latest_scan_at`                           | 0 → target ≥20 deals reviewed/week                     |
| Watchlist adds per scan  | count | `agent_events` WHERE `action='watchlist_add'`                                         | Target ≥1 per weekly scan session                      |
| Skip rate                | %     | `agent_events` WHERE `action='deal_skip'` / total rows surfaced                       | Baseline TBD; high skip rate = low scan quality signal |
| Deals-to-buys conversion | %     | `retail_watchlist` transitions `watching→bought` / `agent_events.watchlist_add` count | Target ≥20% (1 in 5 watched deals gets bought)         |

---

## Out of Scope

- Amazon ASIN lookup for StockTrack results (no SP-API call in this chunk)
- BSR data (no data source in scope)
- Margin calculation (requires Amazon price — not in `stocktrack_results`)
- Editing existing watchlist rows from the scan results tab
- Pagination for >200 results (100-row limit is sufficient for 7-day window)

---

## Grounding Checkpoint

Colin runs in the browser after builder ships:

1. Navigate to `/hit-lists`
2. Confirm two tabs: "Book Lists" (existing ISBN tool) and "Scan Results"
3. Click "Scan Results" — confirm the table renders (or the empty state renders)
4. If results are present: click "+ Watch" on one row — confirm the button changes to "In Watchlist"
5. Verify via SQL: `SELECT product, status, created_at FROM retail_watchlist ORDER BY created_at DESC LIMIT 1` shows the row Colin just added

Pass criterion: both tabs render; watchlist add persists to DB; no JS errors in console.

---

## Open Questions

None. All ambiguities resolved above via codebase study.

---

## Files Expected to Change

- `app/(cockpit)/hit-lists/page.tsx` — wrap in Tabs (server component stays thin)
- `app/(cockpit)/hit-lists/_components/ScanResultsTab.tsx` — new file
- `app/api/stocktrack/results/route.ts` — new file (check existing `/api/stocktrack/` directory first)
- `app/api/retail/watchlist/route.ts` — new file (or beef up if it exists)
