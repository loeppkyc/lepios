# Net Worth Page — Acceptance

**Status:** approved (Colin authorized 2026-05-06: "scope acceptance, and build now")
**Owner branch:** `feat/net-worth-page`
**Migration slot:** `0133_net_worth_snapshots.sql`
**Sprint scope:** Life P&L (informational sibling page)

---

## 1 — Why this exists

Colin asked "how much money or value do I have right now?" The Life P&L page can't answer that — it shows income/expenses, not balance sheet. After paying off Tesla + the $82k loan, cash dropped but liabilities dropped by the same amount; net worth was unchanged. He needs a page that shows that math at a glance.

Streamlit baseline: [`streamlit_app/pages/61_Net_Worth.py`](../../../streamlit_app/pages/61_Net_Worth.py) — verified working. This is a **port-with-Beef-Up** per ARCHITECTURE.md §3.1: most of the data is already in `balance_sheet_entries` (seeded with real Mar 31 2026 balances), so we surface it in a "where do I sit?" view rather than rebuild from scratch.

---

## 2 — Check-Before-Build verdict

| Resource                                                           | Exists?              | Action                                                 |
| ------------------------------------------------------------------ | -------------------- | ------------------------------------------------------ |
| `balance_sheet_entries` table                                      | Yes (seeded)         | Reuse as data source. Do not migrate.                  |
| `/balance-sheet` page                                              | Yes (per-row editor) | Keep as the editing surface; link from Net Worth page. |
| `/api/balance-sheet` route                                         | Yes                  | Reuse as the upstream for current balances.            |
| Net Worth snapshot history                                         | No                   | Build new: `net_worth_snapshots` table.                |
| Personal-side balance fields (Personal Chequing, FHSA, RRSP, etc.) | No                   | Seed as new rows in `balance_sheet_entries`.           |
| `/net-worth` route                                                 | No                   | Build new.                                             |

**Default action: Beef-Up.** The existing Balance Sheet page is the accountant's view (per-row editor with categories). The Net Worth page is the "answer Colin's question" view (KPI banner + grouped breakdown + snapshot trend + tactile pillar split). Both stay; they serve different jobs.

---

## 3 — Data model

### 3.1 New table: `net_worth_snapshots` (migration 0133)

```sql
CREATE TABLE net_worth_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  total_assets numeric(14,2) NOT NULL,
  total_liabilities numeric(14,2) NOT NULL,
  net_worth numeric(14,2) NOT NULL,
  breakdown jsonb,           -- { "by_category": { "bank": 12458.86, ... }, "by_pillar": { "business": X, "personal": Y } }
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX net_worth_snapshots_date_idx ON net_worth_snapshots(snapshot_date DESC);
```

RLS: enabled, single-user app — same pattern as `balance_sheet_entries` (authenticated read/write).

### 3.2 New rows in `balance_sheet_entries` (seeded by migration, $0 balances)

Personal-side fields not yet tracked. Seed at $0 so they show up in the editor ready for Colin to fill in:

| name                 | account_type | category            | sort_order |
| -------------------- | ------------ | ------------------- | ---------- |
| TD Personal Chequing | asset        | personal_bank       | 50         |
| Personal Savings     | asset        | personal_bank       | 51         |
| FHSA                 | asset        | personal_investment | 52         |
| RRSP                 | asset        | personal_investment | 53         |
| TFSA                 | asset        | personal_investment | 54         |

Categories `personal_bank` and `personal_investment` are new but align with the freeform `category text` column already in the table — no schema change needed.

### 3.3 What counts in Net Worth math

```
Net Worth = Σ(balance WHERE account_type='asset') − Σ(balance WHERE account_type='liability')
```

**Equity rows are excluded.** They're an accounting balancing identity (Owner's Equity, Retained Earnings, Net Income YTD), not real wealth — including them double-counts.

---

## 4 — API surface

### 4.1 `GET /api/net-worth`

Returns current Net Worth snapshot computed live from `balance_sheet_entries`.

```ts
interface NetWorthResponse {
  totalAssets: number
  totalLiabilities: number
  netWorth: number
  asOfDate: string // most recent as_of_date across asset/liability rows
  byCategory: { category: string; account_type: 'asset' | 'liability'; total: number }[]
  byPillar: { business: number; personal: number } // splits by category prefix ('personal_*' = personal, all else = business)
  rows: BalanceSheetEntry[] // all asset/liability rows (no equity)
  latestSnapshot: NetWorthSnapshot | null
  changeSinceSnapshot: number | null // netWorth - latestSnapshot.net_worth
}
```

Auth: `auth.getUser()` — 401 if missing. (F-N5 invariant.)

### 4.2 `POST /api/net-worth/snapshot`

Inserts a new row into `net_worth_snapshots` using current totals from `balance_sheet_entries`.

Body: `{ notes?: string }` (optional)
Returns: `{ snapshot: NetWorthSnapshot }`

Auth: `auth.getUser()`.

### 4.3 `GET /api/net-worth/history`

Returns last N snapshots for trend chart.

Query: `?limit=24` (default 24, max 120)
Returns: `{ snapshots: NetWorthSnapshot[] }` ordered by `snapshot_date ASC`

---

## 5 — UI

### 5.1 Page: `app/(cockpit)/net-worth/page.tsx` + `_components/NetWorthPage.tsx`

**Layout (top-to-bottom):**

1. **Header** — "Net Worth" title + subtitle "How much money and value you have right now." + "as of {asOfDate}" + Save Snapshot button.

2. **Big KPI banner** — three numbers across:
   - Total Assets (gold)
   - Total Liabilities (red)
   - Net Worth (green if positive, red if negative) — biggest font, **the answer to the question**
   - If `latestSnapshot` exists: Δ since last snapshot (green/red arrow)

3. **Pillar tabs** — All / Business / Personal. Filters the breakdown table below. Default: All.

4. **Breakdown table** — rows grouped by category (Bank Accounts, Cash, Inventory, Equipment, Personal Banking, Personal Investments, Credit Cards, Loans, Tax). Each row: name + balance + as-of date + small "edit" link → `/balance-sheet`.

5. **Trend chart** — line chart of snapshot history. Three series: Total Assets, Total Liabilities, Net Worth. If <2 snapshots: "Save snapshots monthly to see your trend over time."

6. **Footer note** — "Equity rows (Retained Earnings, Owner's Draw, etc.) are excluded — they're accounting balances, not wealth. Edit any line on the [Balance Sheet]{/balance-sheet} page."

### 5.2 Sidebar nav

Add `{ label: 'Net Worth', href: '/net-worth' }` to the Dashboard section, right under Life P&L.

### 5.3 Cross-link from Life P&L

Add a small "Where do I sit right now? → Net Worth" link in the Life P&L header subtitle area.

### 5.4 F20 design enforcement

PayoutsPage, BalanceSheetPage, LifePnlPage all use heavy inline styles (pre-existing F20 violations). For consistency with sibling pages, **NetWorthPage will match the existing inline-style pattern** rather than introduce a one-off shadcn refactor. Tracked separately as F20 cleanup (see `docs/sprint-5/purpose-review-acceptance.md §9`).

### 5.5 Charts

Trend chart uses shadcn/ui Chart (`ChartContainer` + Recharts LineChart) per chart conventions in CLAUDE.md §8. Reference: `app/(cockpit)/amazon/_components/AmazonDailyChart.tsx`.

---

## 6 — Acceptance tests

| ID    | Test                                                                                  | File                          |
| ----- | ------------------------------------------------------------------------------------- | ----------------------------- |
| NW-T1 | `GET /api/net-worth` returns 401 when unauthenticated                                 | `tests/api/net-worth.test.ts` |
| NW-T2 | `GET /api/net-worth` excludes equity rows from totals                                 | same                          |
| NW-T3 | `byPillar.personal` sums only `personal_*` category rows                              | same                          |
| NW-T4 | `byPillar.business` sums all non-personal asset/liability rows                        | same                          |
| NW-T5 | `POST /api/net-worth/snapshot` inserts a row with totals matching live computation    | same                          |
| NW-T6 | `GET /api/net-worth/history` returns snapshots ordered ASC by date, capped at limit   | same                          |
| NW-T7 | `changeSinceSnapshot` = netWorth − latestSnapshot.net_worth (or null if no snapshots) | same                          |

All tests use mocked Supabase client following `tests/api/payouts-notes.test.ts` pattern.

---

## 7 — Grounding checkpoint

**Sanity-check the live math against current data:**

Using the seeded `balance_sheet_entries` snapshot from 2026-03-31:

- Assets sum = $225,477.61 (12 rows, ranging from -$2,503.26 Gift Card to $153,403.87 Inventory On Hand)
- Liabilities sum = $51,665.65 (10 rows, dominated by GST Payable $31,455.36 and CT MasterCard $18,404.98)
- **Net Worth = $173,811.96**

After Colin adds personal-side balances (Personal Chequing, Savings, FHSA, RRSP, TFSA), the number will go up. The page must surface this delta visibly.

If the live `GET /api/net-worth` response disagrees with this baseline by more than $1, builder must investigate before merging.

---

## 8 — Out of scope

- Plaid/banking integration (live balance pulls)
- Auto-pull Amazon Pending from `amazon_settlements` (already represented as "Amazon.ca Transfers" / "Amazon.com Transfers" rows)
- Auto-pull live inventory cost from `inventory_units` (already represented as "Inventory On Hand (Estimated)" — Colin updates manually)
- Refactor of Balance Sheet page to shadcn (F20 cleanup)
- Pie/donut chart for asset allocation (defer until trend chart is producing useful data)
- Liability bar chart (defer)
- Multi-user RLS — single-user app

---

## 9 — Definition of done

- [ ] Migration 0133 applied to prod
- [ ] `/net-worth` page renders Colin's real net worth (target ≈ $174k pre-personal-fields)
- [ ] Sidebar link works
- [ ] Life P&L header has cross-link
- [ ] Save Snapshot inserts a row and the trend chart shows at least 1 dot
- [ ] All NW-T1..T7 tests pass
- [ ] Typecheck + lint clean
- [ ] PR opened, CI green
