# Life P&L — Real COGS Recognition

**Status:** approved (Colin authorized 2026-05-06: "lets do number 3")
**Owner branch:** `feat/life-pnl-real-cogs`
**Migration slot:** `0134_inventory_snapshots.sql`
**Sprint scope:** Life P&L correctness

---

## 1 — Why this exists

Life P&L currently shows YTD Net Profit of **$96,616** on $168k revenue (57% net margin, 85% gross margin). Colin's bank reality check: "if I pay off all my debt I have ~$15k left." A business that genuinely cleared $96k YTD profit wouldn't leave him that thin. The page is misleading.

**Two specific gaps:**

1. **Inventory drawdown is not recognized as COGS.** Mar 31 inventory was $153,403.87; current is ~$10,000. That ~$143k of inventory turned into revenue but no matching cost-of-goods entry hit the P&L. Inventory purchases sit on the balance sheet as `Inventory Asset` and never recognize COGS when sold (because COGS journal entries aren't being posted in QB).

2. **FBA fees are classified as OpEx instead of COGS.** $42,612 YTD across `FBA Selling Fees`, `FBA Transactions Fees`, `FBA Inventory and Inbound Services Fees`. For a 100% FBA business these are direct selling costs and should reduce gross profit, not OpEx.

Net effect: Life P&L overstates profit by **~$185k YTD**. The real number is near break-even or slightly negative.

---

## 2 — Approach: Periodic Inventory Method (the right model for pallet operations)

For Colin's pallet-based book arbitrage, per-unit COGS attribution is impractical (one pallet = many ASINs at flat cost). The accounting-clean and CRA-accepted method is **periodic inventory**:

```
Period COGS = Beginning Inventory + Purchases − Ending Inventory
```

Plus reclassify FBA fees as COGS (selling-side direct costs).

**Period granularity:** monthly.

---

## 3 — Data model

### 3.1 New table: `inventory_snapshots` (migration 0134)

```sql
CREATE TABLE inventory_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  value_at_cost numeric(14,2) NOT NULL,
  source       text NOT NULL DEFAULT 'manual',   -- 'manual' | 'qb_import' | 'computed'
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_snapshots_date_unique UNIQUE (snapshot_date)
);
CREATE INDEX inventory_snapshots_date_idx ON inventory_snapshots (snapshot_date DESC);
```

RLS enabled, authenticated-only policy (same pattern as net_worth_snapshots).

**Convention:** `snapshot_date` represents inventory value **at end of that day**. So Mar 31 snapshot = Q1 ending = Q2 beginning.

### 3.2 Reused tables

- `cogs_entries` (per-ASIN purchases) — already exists, 3 rows. Purchases will be summed by `purchased_at` month for the COGS formula.
- `pallet_invoices` (per-pallet purchases) — already exists, 0 rows. Purchases will be summed by `invoice_month`. Backfill is Colin's job in a later session.
- `business_expenses` (current P&L source) — keep, but COGS bucketing logic changes.

### 3.3 Seed data (in migration)

Two anchor snapshots from confirmed numbers:

| Date       | Value       | Source                                |
| ---------- | ----------- | ------------------------------------- |
| 2026-03-31 | $153,403.87 | qb_import (per QB-as-of-Mar-31)       |
| 2026-05-06 | $10,000.00  | manual (per Colin 2026-05-06 session) |

For Jan + Feb, no snapshots. The P&L will show "Pending — needs inventory snapshot" for those months. Colin can backfill if he has records.

---

## 4 — `/api/pnl` rewrite

### 4.1 New COGS computation (per month)

```ts
// For each month bucket:
const beginningInventory = lookupSnapshotAt(monthStart - 1day) ?? null
const endingInventory    = lookupSnapshotAt(monthEnd)         ?? null
const purchasesInMonth   = sumCogsEntries(month) + sumPalletInvoices(month)
const fbaFeesInMonth     = sumBusinessExpenses(month, FBA_FEE_CATEGORIES)

const cogs = (beginningInventory != null && endingInventory != null)
  ? beginningInventory + purchasesInMonth - endingInventory + fbaFeesInMonth
  : null  // mark as "Pending"
```

If either snapshot is missing, COGS for that month is reported as `null` and flagged. UI shows a warning + the FBA-fees portion only (still informative).

### 4.2 OpEx changes

Remove FBA fee categories from OpEx (they now go to COGS):

```ts
const COGS_FBA_FEE_CATEGORIES = new Set([
  'FBA Selling Fees (Amazon.ca)',
  'FBA Transactions Fees (Amazon.ca)',
  'FBA Inventory and Inbound Services Fees (Amazon.ca)',
  'FBA Transactions Fees Refunds (Amazon.ca)', // negative, reduces COGS
  'Seller Fee Refunds (Amazon.ca)', // negative
  'Refund Administration Fees (Amazon.ca)',
  'Seller Fulfilled Selling Fees (Amazon.ca)',
  'Other Transaction Fees (Amazon.ca)',
  'Fulfillment Centre Charges',
  'Amazon Seller Fees and Charges',
  'Shipping and delivery expense', // existing data uses this label
])
```

The legacy `'Inventory — Books (Pallets)'`, `'Inventory'`, `'Shipping & Delivery'` keys stay matched (defensive) but generally won't have data in `business_expenses`.

### 4.3 Response shape changes

```ts
interface MonthlyPnlRow {
  month: string
  revenue: number
  cogs: number | null // null if periodic inventory missing snapshot
  cogsApprox: boolean // true when only FBA-fee portion was computable
  cogsBreakdown: {
    beginningInventory: number | null
    endingInventory: number | null
    purchases: number
    fbaFees: number
    inventoryDrawdown: number | null // β + P − E, or null
  }
  grossProfit: number | null
  opex: number
  netProfit: number | null
}
```

Totals row: same fields summed where defined; null if any monthly piece is null.

---

## 5 — UI changes (app/(cockpit)/life-pnl/\_components/LifePnlPage.tsx)

### 5.1 KPI banner

- "Net Profit" KPI shows the value when computable; if any month is null, append "— needs snapshots" link.
- Add tooltip on hover: "COGS = Beginning Inventory + Purchases − Ending Inventory + FBA fees"

### 5.2 Monthly table

- COGS cell:
  - When fully computed: show numeric, gold
  - When approx (FBA fees only): show numeric in muted color with `≈` prefix, tooltip
  - When null: show "—" with link "Add snapshot"

### 5.3 New section: "Inventory Snapshots" (collapsible)

Below the existing expense breakdown, a small sub-section listing snapshots by date with inline-edit (reusing the EditableRow pattern from /net-worth). Buttons:

- Add Snapshot (date picker + value input + notes)
- Edit existing
- Delete

Calls a new endpoint `/api/inventory-snapshots` (GET/POST/PATCH/DELETE).

### 5.4 Footer note

Update from current single-line note to:

> **Revenue** = Amazon settlement net_payout. **COGS** = Beginning Inventory + Purchases − Ending Inventory + FBA fees (selling/transaction/inbound). **OpEx** = remaining business expenses (pretax). For months without inventory snapshots, COGS shows only the FBA-fee portion and is marked approximate.

---

## 6 — `/api/inventory-snapshots` (new)

| Method | Purpose                                                          |
| ------ | ---------------------------------------------------------------- |
| GET    | List all snapshots ordered by date DESC                          |
| POST   | Add snapshot `{ snapshot_date, value_at_cost, notes? }`          |
| PATCH  | Update existing `{ id, value_at_cost?, snapshot_date?, notes? }` |
| DELETE | Remove snapshot by id                                            |

All require `auth.getUser()` (F-N5). UNIQUE constraint on `snapshot_date` — POST returns 409 on collision; UI suggests using PATCH instead.

---

## 7 — Tests

| ID     | Test                                                                                        | File                                    |
| ------ | ------------------------------------------------------------------------------------------- | --------------------------------------- |
| PNL-T1 | COGS includes inventory drawdown when both snapshots present                                | `tests/api/pnl.test.ts` (new)           |
| PNL-T2 | COGS includes FBA fee categories                                                            | same                                    |
| PNL-T3 | OpEx excludes FBA fee categories                                                            | same                                    |
| PNL-T4 | Month with missing snapshot returns `cogs: null, cogsApprox: false`, fbaFees still computed | same                                    |
| PNL-T5 | Negative refund categories reduce COGS                                                      | same                                    |
| INV-T1 | GET /api/inventory-snapshots requires auth (401 without)                                    | `tests/api/inventory-snapshots.test.ts` |
| INV-T2 | POST inserts row, returns it                                                                | same                                    |
| INV-T3 | POST returns 409 on duplicate snapshot_date                                                 | same                                    |
| INV-T4 | PATCH updates value_at_cost                                                                 | same                                    |
| INV-T5 | DELETE removes row                                                                          | same                                    |

All vitest, mocked supabase client (existing pattern).

---

## 8 — Grounding checkpoint

After migration + seed + code:

- April 2026 row should show: revenue ≈ $8.1k, FBA fees portion of COGS, but null full COGS (no Apr 30 snapshot)
- Q2 partial computation: Mar 31 → May 6 drawdown = $143,403.87 + FBA fees ≈ $186k recognized cost
- YTD Net Profit should land **near zero or modestly negative** — matching Colin's reality check

If YTD profit still shows >$50k after this lands, the diagnosis is wrong. Builder should investigate before ship.

---

## 9 — Out of scope (Phase 2+)

- UI for entering pallet_invoices (Colin will populate via SQL or future UI)
- UI for entering cogs_entries (per-ASIN)
- Auto-post COGS from order shipments using cogs_entries weighted-average
- Pallet-cost allocation algorithm across ASINs
- Real-time inventory drawdown (currently snapshot-driven)

---

## 10 — Definition of done

- [ ] Migration 0134 applied to prod
- [ ] Mar 31 + May 6 inventory snapshots seeded
- [ ] /api/pnl response shows realistic monthly COGS
- [ ] Life P&L page visually shows the new COGS breakdown + approximate badges
- [ ] Inventory Snapshots section editable inline
- [ ] All tests pass; full suite still green
- [ ] PR opened, CI green, merged
- [ ] Colin sees a YTD Net Profit number that matches his bank-account intuition (near break-even)
