# T-005 Net Worth — Phase 1a Study + Phase 1b Twin Q&A

**Task ID:** ca9f3e22-1ca9-4b4e-9555-1e948b1beedc  
**Leverage target:** T-005 (docs/leverage-targets.md#t-005--net-worth)  
**Date:** 2026-05-10  
**Status:** 20% done → studying gap to 100%

---

## What it does (current state — 20%)

`/net-worth` renders a single-pane balance sheet view. Users see:

- KPI banner: Total Assets, Total Liabilities, Net Worth (with delta vs last snapshot)
- Pillar tabs: All / Business / Personal
- Category breakdown table: rows grouped by category, each row inline-editable (balance + as-of date)
- Raw SVG trend chart: multi-line (assets, liabilities, net worth over snapshot history)
- "Save Snapshot" button: manually captures current state to `net_worth_snapshots`
- "Edit Balances" link → `/balance-sheet`

**Data source:** exclusively `balance_sheet_entries` (assets + liabilities; equity rows excluded).

**APIs live:**
- `GET /api/net-worth` — pulls balance_sheet_entries, latest snapshot, computes totals + delta
- `POST /api/net-worth/snapshot` — computes totals from balance_sheet_entries, inserts to net_worth_snapshots
- `GET /api/net-worth/history?limit=N` — returns snapshot history sorted ASC for chart

**Schema shipped (migration 0133):**
- `net_worth_snapshots` table: id, snapshot_date, total_assets, total_liabilities, net_worth, breakdown jsonb, notes, person_handle
- RLS: authenticated-only policy
- personal-side balance_sheet_entries seeded: TD Personal Chequing, Personal Savings, FHSA, RRSP, TFSA

---

## Current balance_sheet_entries data (live)

### Assets
| Name | Category | Balance | As Of |
|---|---|---|---|
| TD Chequing (Business) | bank | $1,760 | 2026-05-06 |
| PayPal Business | bank | $63 | 2026-03-31 |
| TD USD Chequing | bank | $312 | 2026-05-06 |
| Amazon.ca Transfers | amazon | $4,923 | 2026-03-31 |
| Amazon.com Transfers | amazon | -$1,482 | 2026-03-31 |
| Gift Card | cash | $3,500 | 2026-05-06 |
| Petty Cash | cash | -$874 | 2026-03-31 |
| Business Equipment | equipment | $1,000 | 2026-03-31 |
| 2022 Tesla (Vehicle) | equipment | $39,500 | 2026-05-06 |
| Inventory On Hand (Estimated) | inventory | $10,000 | 2026-05-06 |
| TD Personal Chequing | personal_bank | $11,439 | 2026-05-06 |
| Personal Savings | personal_bank | $0 | 2026-05-06 |
| USD Daily Savings | personal_bank | $129 | 2026-05-06 |
| FHSA | personal_investment | $8,000 | 2026-05-06 |
| RRSP | personal_investment | $0 | 2026-05-06 |
| TFSA | personal_investment | $0 | 2026-05-06 |
| Prepaid Expenses | prepaid | $360 | 2026-03-31 |
| Loan to Friend | receivable | $10,000 | 2026-05-06 |

### Liabilities
| Name | Category | Balance |
|---|---|---|
| Canadian Tire MC | credit_card | $18,405 |
| BDC Loan | loan | $11,000 |
| Personal LOC | loan | $10,554 |
| GST/HST Payable | tax | $0 |
| Income Tax Payable | tax | $0 |
| Amex, Capital One, TD Visa | credit_card | $0 each |

---

## What T-005 done_state requires vs what exists

### Done vs Gap matrix

| Requirement | Status | Notes |
|---|---|---|
| `/net-worth` page | ✓ Done | Exists, functional |
| Total net worth KPI | ✓ Done | Banner with delta vs last snapshot |
| Asset class breakdown | ⚠ Partial | Missing: brokerage, crypto; vehicle is under `equipment` |
| Liabilities breakdown | ✓ Done | CC, loans, tax all present |
| Pulls from transactions | ✗ Missing | API only reads balance_sheet_entries |
| Pulls from inventory (at-cost) | ⚠ Partial | Manual entry; inventory_snapshots.value_at_cost not wired |
| Pulls from business_review | ✗ Missing | Not integrated |
| `manual_assets` table | ✗ Missing | Not in schema; no migration |
| Sankey or stacked-area trend | ⚠ Partial | Raw SVG multi-line chart exists; not Sankey/stacked-area |
| `net_worth_snapshots` daily roll-up | ⚠ Partial | Table exists; no daily cron; manual only |
| Morning digest line | ✗ Missing | No `buildNetWorthDigestLine()` function |
| Snapshot freshness metric (≤24h) | ✗ Missing | No staleness warning |
| F20 compliance (no style={}) | ✗ **Violation** | Entire NetWorthPage.tsx uses inline style={} throughout |

### F20 violation detail
Every component in `NetWorthPage.tsx` uses `style={{...}}` attributes — `KpiBlock`, `PillarTab`, `RowGroup`, `EditableRow`, all layout divs. Per rule F20, builder acceptance tests must fail on `style=` presence in TSX. This blocks builder acceptance without a plan to fix it.

---

## Related tables found in schema

| Table | Relevance | Key columns |
|---|---|---|
| `vehicles` | Vehicle market value source | `current_value_estimate`, `loan_remaining`, `current_value_updated_at` |
| `inventory_snapshots` | Inventory at-cost source | `snapshot_date`, `value_at_cost`, `source` |
| `transactions` | Business cash flow | (structure TBD — not read) |
| `balance_sheet_entries` | Current manual data source | account_type, category, balance, as_of_date |
| `net_worth_snapshots` | Snapshot table | snapshot_date, total_assets, total_liabilities, net_worth, breakdown |

**inventory_snapshots live data:**
- 2026-05-06: $10,000 (manual)
- 2025-12-31: $140,605.90 (qb_import)

**vehicles live data:** Has `current_value_estimate` column. Tesla is currently a manual balance_sheet_entries row ("2022 Tesla (Vehicle)" = $39,500).

---

## Domain rules embedded in current implementation

1. **Equity rows excluded** — `account_type NOT IN ('equity')`. Retained earnings, Net Income YTD, Owner's Draw are accounting balances, not wealth. Correct per standard net worth calculation.
2. **Personal vs business pillar** — categories starting with `personal_` are "personal pillar"; all others are "business pillar." Filter logic in component.
3. **Snapshot delta** — "change since last snapshot" = current net worth - latest snapshot net worth. Not delta-since-yesterday.
4. **Multiple snapshots per day allowed** — UNIQUE constraint on snapshot_date was dropped in migration 0133.
5. **No auto-dedup** — every "Save Snapshot" button click inserts a new row, even if one already exists for today.

---

## Edge cases noted

- Amazon AR entries can be negative (Amazon.com at -$1,482) — valid, represents negative float.
- Petty Cash is negative (-$874) — likely data entry issue or represents a reimbursement owed.
- Inventory "On Hand (Estimated)" is manual at $10k but inventory_snapshots has $140k from QB year-end import — 14× discrepancy that Colin would need to reconcile.
- `balance_sheet_entries.equipment` contains both the Tesla vehicle AND business equipment — conflated categories.

---

## Twin Q&A — blocked (endpoint unreachable)

Twin returned "Host not in allowlist" for all questions. All escalate to Colin.

## Pending Colin Questions

**Q1 — `manual_assets` table vs extending `balance_sheet_entries`:**  
The done_state says "+ `manual_assets` table for non-API items." Should a new `manual_assets` table be created (schema: id, name, category, balance, as_of_date, source, notes), or should the existing `balance_sheet_entries` table serve this role (adding new rows for crypto, etc.)? The current code already uses `balance_sheet_entries` as a manual entry mechanism — creating a second table may be redundant unless `manual_assets` needs different fields.

**Q2 — Inventory at-cost auto-pull:**  
Should the net worth API auto-pull `inventory_snapshots.value_at_cost` (latest snapshot) to replace the manual "Inventory On Hand (Estimated)" entry? Currently: $10,000 manual. inventory_snapshots shows $140,605 at 2025-12-31 (QB) and $10,000 at 2026-05-06 (manual again). Which is authoritative, and should this be auto-populated?

**Q3 — Vehicle value auto-pull:**  
The `vehicles` table has `current_value_estimate`. Currently "2022 Tesla (Vehicle)" is a manual row in `balance_sheet_entries.equipment` at $39,500. Should net worth auto-pull from `vehicles.current_value_estimate` instead? This would give live vehicle value without manual updates. If yes, should the manual row be removed?

**Q4 — "Pulls from transactions and business_review snapshots":**  
The done_state says the module "Pulls from existing tables (transactions, inventory, business_review snapshots)." What specific computed values from these tables should appear as net worth line items? Concrete examples: Amazon reserves from `payouts`? AR balance from `amazon_financial_events`? Nothing specific comes through reading the done_state — this needs Colin's intent.

**Q5 — F20 fix scope:**  
The entire `NetWorthPage.tsx` uses `style={}` inline attributes throughout (violates F20). Should fixing F20 compliance be included in this task (T-005), or treated as a separate cleanup task? Including it means builder rewrites the component in Tailwind/shadcn — approximately doubles the UI work.

**Q6 — Daily auto-snapshot:**  
The benchmark requires "daily snapshot ≤24h old." Should a nightly cron auto-create a snapshot (in addition to the manual button), or should the manual button be the only mechanism and we just surface a staleness warning when no snapshot exists within 24h?

**Q7 — Chart type:**  
The done_state says "Sankey or stacked area showing 90-day trend." The current implementation is a raw SVG multi-line chart (assets, liabilities, net worth as separate lines). Preference:  
(a) Keep the existing multi-line SVG (already useful, not technically a Sankey/stacked-area but close)  
(b) Replace with shadcn/ui Chart AreaChart (stacked — shows composition over time)  
(c) Implement a true Sankey (complex, requires additional library)  
If (b): this requires a shadcn/ui Chart migration from the raw SVG.

---

## 20% Better (Phase 1c)

Against the Streamlit baseline: no Streamlit net worth page found. Evaluating against current state:

| Category | Improvement |
|---|---|
| **Correctness** | Inventory discrepancy ($10k vs $140k) needs resolution path. Vehicle `equipment` category conflation should be split. |
| **Performance** | Current: 2 sequential fetches on load (net-worth + history). Can be parallelized (already is via Promise.all). No improvement needed. |
| **UX** | Staleness indicator missing — Colin has no way to know if data is stale. Add "last updated" age label per row. |
| **Extensibility** | Category enum is hardcoded in CATEGORY_LABELS. Adding crypto/brokerage requires code change. Should be DB-driven or at least extendable. |
| **Data model** | Vehicle conflated under `equipment`. Should be separate category `vehicle` for the net worth view (aligns with done_state asset class list). |
| **Observability** | No F18 metric surfaced. Snapshot freshness should be reported. Morning digest line is the key improvement. |

**Proposed 20% improvements for acceptance doc:**
1. Morning digest line (highest leverage — F18 required)
2. Daily auto-snapshot cron (makes benchmark measurable without Colin action)
3. Staleness warning on page ("Snapshot Xd old — save now" banner)
4. `vehicle` category split from `equipment` (correctness + aligns done_state spec)

---

## Grounding manifest

- `app/(cockpit)/net-worth/_components/NetWorthPage.tsx` — **read** (full UI, F20 violation confirmed)
- `app/api/net-worth/route.ts` — **read** (data sources: only balance_sheet_entries + net_worth_snapshots)
- `app/api/net-worth/snapshot/route.ts` — **read** (manual snapshot, no cron)
- `app/api/net-worth/history/route.ts` — **read** (history query)
- `supabase/migrations/0133_net_worth_snapshots.sql` — **read** (table schema confirmed)
- `balance_sheet_entries` live data — **queried** (full row set, 2026-05-10)
- `vehicles` schema — **queried** (current_value_estimate column confirmed)
- `inventory_snapshots` data — **queried** (two rows, $10k and $140k)
- `lib/orchestrator/digest.ts` — **read** (import pattern for morning digest lines confirmed)
- `docs/leverage-targets.md` — **read** (T-005 done_state contract)
