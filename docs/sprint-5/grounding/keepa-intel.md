# Grounding Doc — Keepa Intel (73_Keepa_Intel.py)

**Prepared:** 2026-04-27  
**Status:** Pre-staged. Do NOT fire until ec1d00c7 outcome confirmed.  
**Overlap category:** PARTIAL  
**Migration slots:** 0041 (keepa_deals), 0042 (keepa_price_alerts)

---

## 1. What Already Exists in LepiOS

### Keepa lib (grounded — read 2026-04-27)

| File                   | Exports                                           | Token cost                                                                                      |
| ---------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `lib/keepa/client.ts`  | `keepaFetch(asin, domain=6)`, `keepaConfigured()` | stats=90 only (~1 token/ASIN). F7 rule encoded in comments.                                     |
| `lib/keepa/product.ts` | `getKeepaProduct(asin)` → `KeepaProduct`          | Uses client.ts. Returns bsr, avgRank90d, rankDrops30, monthlySold, velocityBadge, tokensLeft    |
| `lib/keepa/history.ts` | `getBsrHistory(asin)` → `BsrHistoryResult`        | Uses `history=1,stats=90` (higher cost — 6h Supabase cache). Reads/writes `keepa_history_cache` |

### Existing migrations (grounded)

| Migration | Table                 | Relevant columns                                       |
| --------- | --------------------- | ------------------------------------------------------ |
| 0006      | `scan_results`        | keepa_tokens_left, keepa BSR fields                    |
| 0008      | `keepa_history_cache` | asin (unique), points (jsonb), tokens_left, fetched_at |

### Existing routes

None. No `/api/keepa/*` routes exist. `keepaFetch` is called server-side from `/api/scan/route.ts` only.

### Charting

**Resolved 2026-04-27:** shadcn/ui Chart (Recharts) adopted. See `docs/decisions/chart-library-strategy.md`.

- `components/ui/chart.tsx` is scaffolded and live.
- Pattern: `ChartContainer` + `ChartConfig` + Recharts primitives.
- BSR history line chart: use `<LineChart>` + `<Line dataKey="rank">` with `getBsrHistory()` data.
- Token budget bar: use `<BarChart>` with single `<Bar>`.
- Sparklines (small inline): keep raw SVG (see `QualityTrends.tsx` pattern).

**Reference implementation:** `app/(cockpit)/amazon/_components/AmazonDailyChart.tsx` — BarChart with dual Bar + ChartTooltipContent. Use as the template.

---

## 2. Streamlit Source Analysis

Source: `pages/73_Keepa_Intel.py` (410 lines, 4 tabs)

### Tab 1 — Token Status

```python
# Source lines 46–98
status = get_token_status()  # cached — calls Keepa /product with domain check
c1.metric("Tokens Remaining", f"{status['tokens_left']:,}")
c2.metric("Refill Rate", f"{status['refill_rate']}/min")
c3.metric("Next Refill", f"{refill_min:.0f} min")
# Token Budget Planner: user inputs n_products + with_history, shows estimate
est_cost = estimate_token_cost(n_products, with_history)
```

**LepiOS equivalent:** New `GET /api/keepa/tokens` route — calls Keepa `/product` with a known safe ASIN (B08N5WRWNW or similar) using `stats=0` (0 tokens) to read token status from response headers. Returns tokensLeft, refillRate, refillIn. The `keepaFetch` in client.ts already receives `tokensLeft` from the API response — wire through a dedicated status endpoint.

### Tab 2 — Deal Finder

```python
# Source lines 104–210
deals = query_category_deals(category, domain, min_discount, max_rank, max_products)
# query_category_deals: fetches bestsellers for category, then get_products_batch
# find_deals_in_products: filters by discount %, rank, computes ROI
# save_deals_batch: writes to Google Sheets
# index_deals_to_chromadb: ChromaDB PersistentClient — NOT porting
```

**LepiOS equivalent:**

- Keep bestseller scan + deal filtering logic (port to server action or API route)
- Persistence: `keepa_deals` Supabase table (see schema below) — NOT Google Sheets
- ChromaDB indexing: **SKIP entirely** — no ChromaDB in LepiOS; pgvector is live in twin corpus. Deal indexing can be a future add-on using `lib/knowledge/client.ts` pattern.
- ROI calculation: Keepa-only (no FBA fees in this tab) — simpler than scan_results ROI

### Tab 3 — Price Alerts

```python
# Source lines 216–302
# save_alert: writes to Google Sheets "Keepa Alerts" tab
# check_price_alerts: for each alert, calls get_product(asin), compares threshold
# highlight_triggered: row coloring when Triggered == "YES"
```

**LepiOS equivalent:** `keepa_price_alerts` Supabase table. Alert check is a manual trigger in the UI (same as Streamlit). Could be extended with a cron check later (20% Better).

### Tab 4 — Data Explorer

```python
# Source lines 308–405
# Browses deals saved to Sheets; filter by search/category/status
# Quick AI Questions: ChromaDB query — NOT porting
```

**LepiOS equivalent:** Browse rows from `keepa_deals` table with filter UI. **Skip** "Quick AI Questions" section (ChromaDB only, no equivalent in LepiOS v1).

---

## 3. Decisions (Resolved Pre-fire)

| Decision             | Resolution                                                                               | Source                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| ChromaDB vs pgvector | **Skip ChromaDB entirely in v1.** pgvector is live but not wired to deals — future work. | No ChromaDB in LepiOS; twin uses pgvector but deals are not the same corpus. |
| Token status API     | New `GET /api/keepa/tokens` route. Use a `stats=0` call (0 tokens consumed).             | `keepaFetch` already receives tokensLeft; this is a lightweight wrapper.     |
| Deal persistence     | Supabase `keepa_deals` table, NOT Sheets                                                 | Architecture rule: Supabase is the data layer in LepiOS                      |
| Alert check trigger  | Manual button only in v1 (same as Streamlit). Cron add-on is 20% Better backlog.         | Complexity tradeoff                                                          |
| Domain selector      | CA (domain=6) as default; US (domain=1) optional                                         | Keepa client already defaults to domain=6                                    |
| Charting             | Tailwind proportional bars (AmazonDailyChart pattern). No chart lib.                     | Confirmed no recharts/d3/nivo in package.json                                |

---

## 4. What to Port / Skip / Rebuild

| Item                    | Action           | Reason                                                          |
| ----------------------- | ---------------- | --------------------------------------------------------------- |
| Token status metrics    | **PORT**         | Direct translation; Keepa client already has tokensLeft         |
| Token budget planner    | **PORT**         | Simple math on token estimate; useful                           |
| Category deal finder    | **PORT** (adapt) | Bestseller fetch + deal filtering; replace Sheets with Supabase |
| Manual ASIN check       | **PORT**         | Uses existing `keepaFetch` / `getKeepaProduct`                  |
| Price alerts CRUD       | **PORT** (adapt) | Replace Sheets with `keepa_price_alerts` table                  |
| Alert check now         | **PORT**         | Manual trigger; calls existing `keepaFetch`                     |
| Data explorer browse    | **PORT** (adapt) | Query `keepa_deals` table with filters                          |
| ChromaDB indexing       | **SKIP**         | No ChromaDB in LepiOS                                           |
| Quick AI Questions      | **SKIP**         | ChromaDB-only feature                                           |
| Trending products panel | **PORT**         | Uses rankDrops30 — already in `KeepaProduct` type               |
| BSR history charts      | **PORT**         | `getBsrHistory()` is live + cached in Supabase                  |

---

## 5. New Schema (Coordinator Must Spec)

### `keepa_deals` (migration 0041)

```sql
-- Required columns (grounded from Streamlit DEALS_HEADERS)
asin text not null,
title text,
current_price numeric,           -- cents or dollars TBD (match existing scan_results)
avg_90d_price numeric,
discount_pct numeric,
sales_rank int,
rank_trend text,                 -- 'improving' | 'stable' | 'declining'
est_profit numeric,
roi_pct numeric,
category text,
domain int default 6,
source text,                     -- 'category_scan' | 'manual_lookup'
status text default 'new',
scanned_at timestamptz default now()
```

### `keepa_price_alerts` (migration 0042)

```sql
asin text not null,
title text,
alert_type text not null,        -- 'Price Below' | 'Price Above' | 'Rank Below' | 'Rank Above'
threshold numeric not null,
current_value numeric,
last_checked_at timestamptz,
triggered boolean default false,
notes text,
created_at timestamptz default now()
```

---

## 6. New Route / Page Structure

```
app/(cockpit)/keepa/page.tsx           — main page, 4 tabs
app/(cockpit)/keepa/_components/
  KeepaTokenStatus.tsx                 — Tab 1
  KeepaDeals.tsx                       — Tab 2
  KeepaPriceAlerts.tsx                 — Tab 3
  KeepaExplorer.tsx                    — Tab 4
app/api/keepa/tokens/route.ts          — GET → token status (new)
app/api/keepa/deals/route.ts           — GET (list) / POST (scan + save)
app/api/keepa/alerts/route.ts          — GET (list) / POST (add) / PATCH (check all)
```

---

## 7. 20% Better Opportunities

1. **Alert cron**: Add a daily/hourly cron to check all active alerts and push triggered ones to Telegram via `outbound_notifications`. Streamlit requires manual "Check All Alerts Now" click.
2. **Deal dedup via Supabase unique**: `UNIQUE(asin, scanned_at::date)` prevents duplicate deal rows within a scan session. Streamlit has no dedup.
3. **Token burn tracking**: Log tokensLeft to `agent_events` after each deal scan — enables "Keepa budget this week" query that Streamlit can't do.

---

## 8. Blockers / Open Questions

| Item                                                         | Status                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| Keepa API key configured in Vercel?                          | Verify via `harness_config` or Vercel dashboard before fire |
| `keepa_history_cache` column `tokens_left` — is it nullable? | Read migration 0008 before speccing alert check logic       |
| Price units: cents or dollars in `keepa_deals`?              | Match `scan_results.profit_cad` (cents) for consistency     |

---

## 9. Grounding Manifest

| Claim                                               | Evidence                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `lib/keepa/client.ts` uses stats=90 only            | Grounded — read file 2026-04-27 (line 38: `url.searchParams.set('stats', '90')`) |
| `keepa_history_cache` table exists (migration 0008) | Grounded — confirmed via Glob on supabase/migrations/                            |
| No `/api/keepa/*` routes exist                      | Grounded — Glob returned no matches                                              |
| No charting library in LepiOS                       | Grounded — AmazonDailyChart.tsx line 3 comment                                   |
| ChromaDB not in LepiOS                              | Grounded — no import of chromadb in lib/; no package found                       |
| `lib/keepa/product.ts` exports VelocityBadge        | Grounded — read file 2026-04-27                                                  |
