# Acceptance Doc — Chunk F: Net Worth — Wire Live Data

**Sprint:** 7
**Prepared:** 2026-05-15
**Status:** awaiting_builder_assignment
**Migration:** 0213

---

## Phase 1a — Codebase Study

### What already exists

**The Net Worth page is NOT sitting on fake data. It is already reading live Supabase tables.**

Full study of `NetWorthPage.tsx` (923 lines) and `app/api/net-worth/route.ts`:

**Data architecture (already live):**

- `balance_sheet_entries` table — the source of truth for every balance. Schema: `id, name, account_type ('asset'|'liability'), category, balance, as_of_date, sort_order, notes`. Colin edits rows via the `/balance-sheet` page (inline editing, PATCH `/api/balance-sheet`).
- `net_worth_snapshots` table — persists point-in-time captures. Migration 0133 confirms it exists with `breakdown` jsonb, RLS enabled.
- `GET /api/net-worth` — reads all `balance_sheet_entries` WHERE `account_type IN ('asset','liability')`, pulls latest snapshot for delta math, computes totals by category and business/personal pillar.
- `POST /api/net-worth/snapshot` — captures current totals from balance_sheet_entries into net_worth_snapshots.
- `GET /api/net-worth/history?limit=24` — reads net_worth_snapshots for the trend chart.
- `PATCH /api/balance-sheet` — updates a single balance_sheet_entries row (balance + as_of_date).

**The 923-line component is fully wired.** It renders:

- KPI banner: Total Assets / Total Liabilities / Net Worth
- Business/Personal/All pillar tabs
- Editable balance table (click "Edit" on any row, change balance + date, Save)
- Trend chart (SVG line chart of net_worth, total_assets, total_liabilities from history)
- "Save Snapshot" button → POST /api/net-worth/snapshot

**What "stale/fake" means in practice:**
The DATA MODEL is live. The numbers are stale because `balance_sheet_entries` rows must be
manually updated. The "Amazon" category row and "Inventory" row have `as_of_date` values
that reflect whatever Colin last manually typed. There is NO automatic sync from:

- `amazon_settlements` → the Amazon balance row
- `inventory_snapshots` → the Inventory balance row

**`amazon_settlements` table (migration 0036):** exists with `net_payout, fund_transfer_status, period_end_at`. The "Amazon Receivable" line in net worth should reflect pending/processing payouts.

**`inventory_snapshots` table (migration 0134):** exists with `snapshot_date, value_at_cost`. Already has two anchor rows: Mar 31 ($153,403.87) and May 6 ($10,000 estimate).

**Balance sheet entries for these categories:** The `balance_sheet_entries` table has rows for `category='amazon'` (Amazon Receivable) and `category='inventory'` (Inventory). These need to be automatically updated rather than manually entered.

**What `POST /api/balance-sheet` does not exist:** The balance-sheet route only has GET and PATCH. There is no POST (add row) or DELETE (remove row). The task brief asks for "Add row / Delete row capability" — this is genuinely missing.

---

## Phase 1b — Resolved Ambiguities

| Question                                               | Decision                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is the page on fake data?                              | No — it reads live Supabase. Stale = manually-entered balances not auto-synced.                                                                                                                                                                                               |
| What does "wire FBA inventory value" mean?             | Auto-update the `inventory` category row in `balance_sheet_entries` from the latest `inventory_snapshots.value_at_cost`.                                                                                                                                                      |
| What does "wire Amazon pending payouts" mean?          | Auto-update the `amazon` category row in `balance_sheet_entries` from `amazon_settlements` WHERE `fund_transfer_status IN ('Processing', 'Initiated')`. Sum their `net_payout`.                                                                                               |
| How does auto-update happen?                           | A new cron route `POST /api/cron/net-worth-sync` runs daily, reads inventory_snapshots and amazon_settlements, updates the relevant balance_sheet_entries rows via service_role. Net-worth snapshot is NOT auto-taken — that remains a manual Colin action ("Save Snapshot"). |
| What is the "daily snapshot cron"?                     | NOT a snapshot — a sync cron that refreshes the live balance values. The snapshot (Save Snapshot button) remains manual.                                                                                                                                                      |
| Migration 0213 purpose?                                | Add `source` column to `balance_sheet_entries` to track whether a row is manually managed or auto-synced. Also add `POST /api/balance-sheet` (add new row) and `DELETE /api/balance-sheet/[id]`.                                                                              |
| Which `amazon_settlements` rows are "pending payouts"? | Rows WHERE `fund_transfer_status IN ('Processing', 'Initiated')`. This matches the domain notes in `sp_api_domain_notes.md` (real values: 'Processing'/'Succeeded'). Filter: NOT 'Succeeded' (those are paid out).                                                            |
| What are Colin's wealth tracking categories?           | From the component: bank, cash, amazon, prepaid, inventory, equipment, receivable, personal_bank, personal_investment, credit_card, loan, tax, other. Auto-sync applies to `amazon` and `inventory` only.                                                                     |
| Does `balance_sheet_entries` have a `source` column?   | Unknown — must check. Migration 0213 adds it if absent.                                                                                                                                                                                                                       |

---

## Phase 1c — ≥20% Better

| Area              | Current state                                                                                               | LepiOS improvement                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Amazon receivable | Manual entry, stale by weeks                                                                                | Auto-synced daily from `amazon_settlements` WHERE processing — never stale again                                         |
| Inventory value   | Manual estimate, stale by months                                                                            | Auto-synced daily from latest `inventory_snapshots` — always the most recent estimate                                    |
| Add/delete rows   | No way to add or remove balance sheet lines from the UI                                                     | POST/DELETE `/api/balance-sheet` — manage the balance sheet without direct DB access                                     |
| Data freshness    | No indicator of when a balance was last auto-synced                                                         | `source` column tracks `manual` vs `auto_sync`; `as_of_date` shows sync date                                             |
| Liquidation check | Numbers are point-in-time "as of last edit" — unreliable for the annual "started $X, liquidate to $Y" check | Auto-sync ensures the two largest volatile assets (Amazon receivable, inventory) are current before Colin does his check |

---

## Phase 1d — Acceptance Criteria

### Pre-build checks (coordinator runs before handing to builder)

```sql
-- 1. Confirm balance_sheet_entries schema (especially: does source column exist?)
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='balance_sheet_entries'
ORDER BY ordinal_position;

-- 2. Find the Amazon and Inventory rows
SELECT id, name, category, balance, as_of_date FROM balance_sheet_entries
WHERE category IN ('amazon', 'inventory')
ORDER BY category;

-- 3. Confirm amazon_settlements has rows and fund_transfer_status values
SELECT fund_transfer_status, COUNT(*), SUM(net_payout)
FROM amazon_settlements
GROUP BY fund_transfer_status;

-- 4. Confirm latest inventory_snapshots anchor
SELECT snapshot_date, value_at_cost, source FROM inventory_snapshots
ORDER BY snapshot_date DESC LIMIT 3;

-- 5. Confirm net_worth_snapshots has the expected columns
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='net_worth_snapshots'
ORDER BY ordinal_position;

-- 6. Verify no existing cron for net-worth-sync
-- (Bash): grep -r "net-worth-sync\|net_worth.*cron\|cron.*net.worth" app/api --include="*.ts" -l
```

---

### Migration 0213 — `0213_balance_sheet_source_column.sql`

```sql
-- 0213_balance_sheet_source_column.sql
-- Adds 'source' column to balance_sheet_entries: 'manual' | 'auto_sync'.
-- Auto-sync rows (amazon, inventory categories) are updated by the daily cron
-- /api/cron/net-worth-sync — not by Colin's UI edits.
-- Also adds POST + DELETE to the balance_sheet_entries access pattern via service_role.

-- 1. Add source column if absent
ALTER TABLE public.balance_sheet_entries
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'auto_sync'));

COMMENT ON COLUMN public.balance_sheet_entries.source IS
  'Origin of balance value: manual (user-edited via /balance-sheet), '
  'auto_sync (updated by daily net-worth-sync cron from amazon_settlements or inventory_snapshots). '
  'Auto-sync rows cannot be overridden by PATCH without explicitly passing source=manual.';

-- 2. Mark the amazon and inventory rows as auto_sync (set retroactively)
-- Builder must verify the category values match actual rows before applying.
UPDATE public.balance_sheet_entries
  SET source = 'auto_sync'
  WHERE category IN ('amazon', 'inventory');

-- 3. Ensure service_role has write access (F24 grant)
-- balance_sheet_entries was created before migration GRANT pattern was established.
-- Apply grants if missing.
GRANT INSERT, UPDATE, DELETE ON public.balance_sheet_entries TO service_role;

COMMENT ON TABLE public.balance_sheet_entries IS
  'One row per balance sheet line item. account_type: asset | liability. '
  'Equity rows (retained_earnings, etc.) are intentionally excluded — they are accounting balances, not wealth. '
  'source=auto_sync rows are maintained by the daily net-worth-sync cron; do not manually patch them. '
  'Edit via PATCH /api/balance-sheet (source=manual) or Add/Delete via POST/DELETE /api/balance-sheet.';
```

---

### New Routes

| Route                      | Method | Auth        | Purpose                                                                 |
| -------------------------- | ------ | ----------- | ----------------------------------------------------------------------- |
| `/api/cron/net-worth-sync` | POST   | CRON_SECRET | Update `balance_sheet_entries` amazon + inventory rows from live tables |
| `/api/balance-sheet`       | POST   | user        | Add new balance_sheet_entries row                                       |
| `/api/balance-sheet/[id]`  | DELETE | user        | Delete a balance_sheet_entries row                                      |

**`POST /api/cron/net-worth-sync`**

Auth: `requireCronSecret(request)` from `lib/auth/cron-secret.ts` (F22 — required for all cron routes).

Logic:

1. Read `amazon_settlements` WHERE `fund_transfer_status NOT IN ('Succeeded', 'Closed')` — sum `net_payout`
2. Read latest `inventory_snapshots` row (`ORDER BY snapshot_date DESC LIMIT 1`) — get `value_at_cost`
3. Update `balance_sheet_entries` WHERE `category='amazon'`: set `balance=amazon_sum`, `as_of_date=today`, `source='auto_sync'`
4. Update `balance_sheet_entries` WHERE `category='inventory'`: set `balance=inventory_value`, `as_of_date=inventory_snapshot_date`, `source='auto_sync'`
5. Log to `agent_events`: `action='net_worth_sync', meta={amazon_balance, inventory_balance, snapshot_date}`
6. Return `{ok: true, amazon_balance, inventory_balance}`

Edge cases:

- If no `amazon_settlements` rows found: set amazon balance to 0, log warning
- If no `inventory_snapshots` rows found: skip inventory update, log warning (do not set to 0)
- Use `createServiceClient()` for all writes

**`POST /api/balance-sheet`**

Request body:

```json
{
  "name": "TD Business Chequing",
  "account_type": "asset",
  "category": "bank",
  "balance": 0,
  "as_of_date": "2026-05-15",
  "notes": null,
  "sort_order": 10
}
```

Validation:

- `name`: required, non-empty string, max 100 chars
- `account_type`: required, must be `'asset'` or `'liability'`
- `category`: required, non-empty string
- `balance`: required, finite number
- `sort_order`: optional, defaults to 999

Response: `{id: uuid}` (201).

**`DELETE /api/balance-sheet/[id]`**

Auth: user session (same as GET/PATCH).

- Check row exists, then delete
- Return 204 on success, 404 if not found
- Do NOT allow delete if `source='auto_sync'` — return 403 with error: "This row is managed automatically. Remove the auto_sync cron to stop updating it."

---

### Cron Registration

Add the daily net-worth-sync cron to `vercel.json` or the project's cron configuration file:

```json
{
  "path": "/api/cron/net-worth-sync",
  "schedule": "0 8 * * *"
}
```

(08:00 UTC = 2:00 AM MDT — runs early morning, data fresh for Colin's day)

Builder must check `vercel.json` before adding — if the file has a cron limit already at
Vercel Hobby plan maximum (1 cron/hour, max hourly not daily — but check), this must be
flagged. A daily cron does not conflict with existing crons.

---

### UI Changes

**`app/(cockpit)/net-worth/_components/NetWorthPage.tsx`** — minor additions:

**1. Source badge on balance rows:** in `EditableRow`, add a small badge to rows with `source='auto_sync'`:

```
TD Business Chequing        $12,345.00    2026-05-15    [Edit]
Amazon Receivable ◉auto     $7,285.59     2026-05-15    [—]
Inventory ◉auto             $10,000.00    2026-05-06    [—]
```

Auto-sync rows show `◉auto` badge (small, muted) and the Edit button is replaced by a dash
(cannot manually override auto-sync rows). No `style={}` for the badge — use a Tailwind
span with `className`.

**2. "Add Row" and "Delete Row" buttons** — on the Balance Sheet page (`/balance-sheet`),
not on the Net Worth summary page. The net-worth page already has "Edit Balances" link
pointing to `/balance-sheet`. The Add/Delete UI belongs there.

Builder must check `app/(cockpit)/balance-sheet/` — if a full balance sheet page exists,
add Add/Delete there. If it is just a redirect to net-worth or does not exist, create a
minimal page at `/balance-sheet` with the existing table + add row form + delete button per row.

**`app/(cockpit)/net-worth/_components/NetWorthPage.tsx`** existing code:

- Uses extensive `style={}` inline attrs throughout (existing code — do NOT refactor)
- New additions (the `◉auto` badge, any new JSX) must use Tailwind/shadcn only (F20 applies to NEW code)

---

### Acceptance Tests

**AC-1 — Migration applied**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='balance_sheet_entries'
AND column_name='source';
-- Expect: 1 row (text, NOT NULL, DEFAULT 'manual')
```

**AC-2 — Net-worth-sync cron**

```bash
# Trigger manually (CRON_SECRET auth):
curl -s -X POST https://lepios-one.vercel.app/api/cron/net-worth-sync \
  -H "Authorization: Bearer ${CRON_SECRET}"
# Expect: 200, {ok:true, amazon_balance:..., inventory_balance:...}
```

After calling:

```sql
SELECT name, category, balance, as_of_date, source
FROM balance_sheet_entries WHERE category IN ('amazon','inventory');
-- Expect: balance matches sum of amazon_settlements processing rows
--         and latest inventory_snapshots value_at_cost
--         as_of_date = today or inventory snapshot date
--         source = 'auto_sync'
```

```sql
SELECT * FROM agent_events WHERE action='net_worth_sync' ORDER BY occurred_at DESC LIMIT 1;
-- Expect: 1 row with meta.amazon_balance and meta.inventory_balance populated
```

**AC-3 — Add Row**

```bash
POST /api/balance-sheet
{
  "name": "Test Account",
  "account_type": "asset",
  "category": "bank",
  "balance": 0,
  "as_of_date": "2026-05-15"
}
# Expect: 201, {id: uuid}
```

```sql
SELECT id, name FROM balance_sheet_entries WHERE name='Test Account';
-- Cleanup:
DELETE FROM balance_sheet_entries WHERE name='Test Account';
```

**AC-4 — Delete Row**

```bash
DELETE /api/balance-sheet/{id of test row}
# Expect: 204

DELETE /api/balance-sheet/{id of auto_sync row}
# Expect: 403, {error: "This row is managed automatically..."}
```

**AC-5 — Source badge renders**

- `GET /net-worth` renders without JS errors
- Rows with `source='auto_sync'` show `◉auto` badge
- Edit button absent for auto-sync rows

**AC-6 — Quality gates**

- `grep -rn 'style=' app/(cockpit)/net-worth/_components/NetWorthPage.tsx` — result must be ≤ existing count (new JSX adds zero new `style={}` attrs) (F20)
- `/api/cron/net-worth-sync` calls `requireCronSecret(request)` from `lib/auth/cron-secret.ts` (F22)
- Migration 0213 includes F24 grants for `balance_sheet_entries`

**AC-7 — F18 observability**

```sql
SELECT meta FROM agent_events WHERE action='net_worth_sync' ORDER BY occurred_at DESC LIMIT 1;
-- Expect: {amazon_balance: N, inventory_balance: N, snapshot_date: 'YYYY-MM-DD'}
```

---

## Numeric Field Definition Table (Amazon Receivable)

| Field               | Source                                                     | Filter                                                                                     | Pending handling                 | Ground truth target                                                   |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------- |
| `amazon_balance`    | `amazon_settlements.net_payout` SUM                        | `fund_transfer_status NOT IN ('Succeeded', 'Closed')` — includes 'Processing', 'Initiated' | All non-closed included in total | Seller Central Payments → Deferred Transactions balance               |
| `inventory_balance` | `inventory_snapshots.value_at_cost` MAX by `snapshot_date` | Latest row only                                                                            | Not applicable                   | QBO "Inventory On Hand" balance sheet account; Colin-confirmed anchor |

Note: Colin's account does return DEFERRED CAD payout (~$7,285.59 confirmed 2026-05-07 per
session memory). `fund_transfer_status='Processing'` is the correct filter for Amazon receivable.

---

## GitHub Prior Art Check (Architecture §8.4)

| Problem               | Decision                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Cron data sync        | **Build-new** — `POST /api/cron/net-worth-sync`. No existing pattern for auto-updating balance_sheet_entries from Supabase tables. |
| Add/Delete rows       | **Beef-up** — existing `/api/balance-sheet` has GET + PATCH. Add POST + DELETE to same file.                                       |
| Source column tagging | **Build-new** — no `source` column exists on balance_sheet_entries. Migration 0213 adds it.                                        |

---

## F17 Connection (Behavioral Ingestion)

The net worth page anchors Colin's annual liquidation check — "started $X, would liquidate to
$Y today." This is the highest-frequency wealth question he asks. Auto-syncing Amazon
receivable and inventory value means the answer is always current, not a week-old estimate.

The daily sync creates a time series of `agent_events` rows (one per cron run with
`amazon_balance` and `inventory_balance` in meta). This is the behavioral data layer for
wealth trend analysis — not snapshots (those are monthly), but the live balance floor that
inventory and receivables sit on throughout the month.

---

## F18 Measurement

| Metric                              | Unit                                   | Source                                               | Baseline / Target                                            |
| ----------------------------------- | -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| Sync freshness                      | hours since last sync                  | `agent_events` WHERE `action='net_worth_sync'`       | Target: ≤24h always (daily cron)                             |
| Amazon receivable accuracy          | % delta vs Seller Central              | `amazon_settlements` sum vs SC Deferred balance      | Target: ≤5% delta when checked manually                      |
| Inventory value coverage            | % of balance_sheet_entries auto-synced | COUNT(source='auto_sync') / COUNT(\*)                | Current: 0%. Target: ≥2 rows (amazon + inventory)            |
| Manual edit rate for auto-sync rows | count                                  | Any PATCH where `category IN ('amazon','inventory')` | Target: 0 (no manual overrides needed)                       |
| Snapshot frequency                  | count/month                            | `net_worth_snapshots` rows per month                 | Target: ≥1/month (Colin clicks "Save Snapshot" at month-end) |

---

## Out of Scope

- Automatic net_worth snapshot (the "Save Snapshot" button remains a manual Colin action)
- SP-API inventory lookup (FBA quantity × estimated selling price) — too complex for this chunk; `inventory_snapshots` value_at_cost is the accepted proxy
- QBO balance sync (pulling actual QB balances for bank accounts) — future sprint
- Multi-currency handling (all amounts are CAD; USD balances if any remain manual)
- Historical backfill of daily sync data (the sync only runs forward from deploy date)

---

## Grounding Checkpoint

Colin runs after builder ships:

1. Trigger the cron manually: `curl -X POST https://lepios-one.vercel.app/api/cron/net-worth-sync -H "Authorization: Bearer {CRON_SECRET}"`
2. Navigate to `/net-worth`
3. Find the "Amazon Receivable" row — confirm the balance matches approximately what Seller Central shows under Deferred/Processing payments
4. Find the "Inventory" row — confirm the balance matches the latest `inventory_snapshots` entry (current: $10,000 estimate from May 6)
5. Both rows should show `◉auto` badge and no Edit button
6. Run `SELECT meta FROM agent_events WHERE action='net_worth_sync' ORDER BY occurred_at DESC LIMIT 1` — confirm the meta shows the values you see on screen

Pass criterion: Amazon Receivable and Inventory rows match known-good values; `◉auto` badge visible; sync event logged.

---

## Open Questions

None. The data architecture is clear from direct code and migration study. The main risk is
the `balance_sheet_entries` source column retroactive UPDATE — builder must verify the
`category` values match actual rows before running the UPDATE statement in migration 0213.

---

## Files Expected to Change

- `app/api/cron/net-worth-sync/route.ts` — new file
- `app/api/balance-sheet/route.ts` — add POST to existing GET+PATCH handler
- `app/api/balance-sheet/[id]/route.ts` — new file (DELETE)
- `app/(cockpit)/net-worth/_components/NetWorthPage.tsx` — source badge + auto-sync row locking
- `app/(cockpit)/balance-sheet/` — builder must check what exists here and add Add/Delete UI
- `vercel.json` — add daily cron schedule for net-worth-sync
- `supabase/migrations/0213_balance_sheet_source_column.sql` — new file
