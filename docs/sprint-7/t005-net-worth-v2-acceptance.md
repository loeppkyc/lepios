# Acceptance Doc — T-005 Net Worth: Completion (Chunk 2)

**Status:** awaiting_builder_assignment
**Task ID:** ca9f3e22-1ca9-4b4e-9555-1e948b1beedc (chunk 2)
**Branch:** harness/task-ca9f3e22-net-worth
**Written:** 2026-05-14
**Author:** coordinator
**Spec reference:** `docs/leverage-targets.md#t-005--net-worth` + `docs/sprint-5/t005-net-worth-study.md`

---

## Context — What Chunk 1 Built

Chunk 1 (5bf82bc + 7944715) shipped:

- `manual_assets` table (migration 0205) with vehicle/real_estate/cash/investment/other classes
- `GET /api/net-worth/snapshot` — cron-secret, idempotent on today UTC
- `ManualAssetsSection` — editable table wired into NetWorthPage, F20-clean

Chunk 2 closes the remaining gap to T-005 done_state (estimated: 40% → 100%).

---

## Design Decisions (7 from study Q1–Q7)

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| Q1 | `manual_assets` vs extend `balance_sheet_entries` | ✓ Done — separate table | Shipped in chunk 1 |
| Q2 | Inventory auto-pull from `inventory_snapshots` | **YES** — inject latest snapshot as synthetic `inventory` category; exclude `balance_sheet_entries` rows with `category='inventory'` to prevent double-count | Freshest data; avoids stale manual entry |
| Q3 | Vehicle auto-pull from `vehicles` table | **YES** — inject `SUM(current_value_estimate)` as synthetic `vehicle` category; exclude `balance_sheet_entries` rows where `category='equipment' AND name ILIKE '%vehicle%'` | Live value without manual updates; clean dedup |
| Q4 | Pull from transactions / business_review | **DEFER** — too ambiguous for this chunk; no concrete values specified in done_state | Avoids scope creep; can add in T-005 chunk 3 if needed |
| Q5 | F20 fix on existing NetWorthPage.tsx | **DEFER** — existing inline styles are pre-existing debt, not in scope for this chunk; all NEW code F20-clean | F20 rule scopes to new TSX files; fixing old file is separate cleanup task |
| Q6 | Daily auto-snapshot cron | **YES** — add `/api/net-worth/snapshot` entry to vercel.json at `0 7 * * *` UTC (1 AM MDT); add staleness banner to page when no snapshot within 24h | cron GET handler already built; wiring is 1-line vercel.json + 1-line UI |
| Q7 | Chart type | **shadcn/ui AreaChart** — replace raw SVG trend with `ChartContainer + AreaChart` (Recharts); 3 series: total_assets / total_liabilities / net_worth | CLAUDE.md §8 chart conventions mandate shadcn/ui Chart; done_state says "stacked area"; reference: `AmazonDailyChart.tsx` |

---

## What This Chunk Builds (Delta Only)

1. **API: vehicles + inventory auto-pull** — modify `app/api/net-worth/route.ts`
2. **AreaChart component** — replace raw SVG in `NetWorthPage.tsx` with shadcn/ui `AreaChart`
3. **Staleness banner** — add 24h freshness check to `NetWorthPage.tsx`
4. **Daily cron** — add net-worth snapshot entry to `vercel.json`
5. **Morning digest line** — new `lib/net-worth/digest.ts` + wire into `lib/orchestrator/digest.ts`

No new migration. `vehicles` and `inventory_snapshots` tables already exist.

---

## File Changes

### 1 — `app/api/net-worth/route.ts` (modify)

Add two parallel queries alongside the existing `balance_sheet_entries` fetch:

```typescript
// Vehicles auto-pull
const { data: vehicles } = await supabase
  .from('vehicles')
  .select('current_value_estimate, current_value_updated_at, name')
  .not('current_value_estimate', 'is', null)

// Inventory auto-pull
const { data: inventorySnap } = await supabase
  .from('inventory_snapshots')
  .select('value_at_cost, snapshot_date')
  .order('snapshot_date', { ascending: false })
  .limit(1)
```

**Dedup logic in the aggregation loop:**

- Exclude `balance_sheet_entries` rows where `category = 'equipment'` AND `name ILIKE '%vehicle%'` when `vehicles` table has ≥1 row with a non-null `current_value_estimate`.
- Exclude `balance_sheet_entries` rows where `category = 'inventory'` when `inventorySnap` has a row.

**Inject synthetic rows after the loop:**

```typescript
// Inject vehicle synthetic total
if (vehicles && vehicles.length > 0) {
  const vehicleTotal = vehicles.reduce((sum, v) => sum + Number(v.current_value_estimate), 0)
  totalAssets += vehicleTotal
  byCatMap.set('asset:vehicle', { category: 'vehicle', account_type: 'asset', total: r2(vehicleTotal) })
}

// Inject inventory synthetic total
if (inventorySnap && inventorySnap.length > 0) {
  const invValue = Number(inventorySnap[0].value_at_cost)
  totalAssets += invValue
  byCatMap.set('asset:inventory', { category: 'inventory', account_type: 'asset', total: r2(invValue) })
}
```

**Add to `NetWorthResponse` interface:**

```typescript
vehiclesAutoValue: number | null      // sum from vehicles table, null if no rows
inventoryAutoValue: number | null     // from inventory_snapshots, null if no snapshot
inventorySnapshotDate: string | null  // for UI staleness display
```

### 2 — `app/(cockpit)/net-worth/_components/NetWorthPage.tsx` (modify)

**Replace raw SVG trend chart** (lines ~225–292) with a shadcn/ui AreaChart.

Pattern from `AmazonDailyChart.tsx`:

```typescript
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const chartConfig = {
  total_assets:      { label: 'Assets',      color: 'var(--color-pillar-money)' },
  total_liabilities: { label: 'Liabilities', color: 'hsl(var(--destructive))' },
  net_worth:         { label: 'Net Worth',   color: 'hsl(var(--primary))' },
}
```

- Chart data: `history` array from `GET /api/net-worth/history?limit=24`
- `x` key: `snapshot_date`
- Three `<Area>` series: `total_assets`, `total_liabilities`, `net_worth`
- `stackId` NOT set (unstacked, overlapping fills with opacity — cleaner than stacked for this use case)
- `fill` with opacity 0.15, `stroke` at full opacity per series

**Add staleness banner** above the KPI row:

```typescript
const snapshotAgeDays = latestSnapshot
  ? Math.floor((Date.now() - new Date(latestSnapshot.snapshot_date).getTime()) / 86_400_000)
  : null

{snapshotAgeDays !== null && snapshotAgeDays > 1 && (
  <div className="mb-4 rounded border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
    Snapshot {snapshotAgeDays}d old — save a fresh one to update the trend.
  </div>
)}
```

> All new JSX uses Tailwind utility classes only. No `style={}`. (F20)

### 3 — `vercel.json` (modify)

Add one cron entry to the existing `crons` array:

```json
{
  "path": "/api/net-worth/snapshot",
  "schedule": "0 7 * * *"
}
```

Fires at 1:00 AM MDT daily. The existing `GET /api/net-worth/snapshot` handler (chunk 1) is cron-secret-authed and idempotent — no code change needed.

### 4 — `lib/net-worth/digest.ts` (new file)

```typescript
import { createServiceClient } from '@/lib/supabase/service'

export async function buildNetWorthDigestLine(): Promise<string> {
  const supabase = createServiceClient()

  // Latest snapshot
  const { data: snaps } = await supabase
    .from('net_worth_snapshots')
    .select('net_worth, snapshot_date, total_assets, total_liabilities')
    .order('snapshot_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(2)

  if (!snaps || snaps.length === 0) return '💼 Net Worth: no snapshot yet'

  const latest = snaps[0]
  const prior = snaps[1] ?? null
  const nw = Number(latest.net_worth)
  const delta = prior ? nw - Number(prior.net_worth) : null
  const fmt = (n: number) =>
    n < 0
      ? `-$${Math.abs(Math.round(n / 1000))}k`
      : `$${Math.round(n / 1000)}k`
  const deltaStr = delta !== null
    ? ` (${delta >= 0 ? '+' : ''}${fmt(delta)} vs prior)`
    : ''

  const ageDays = Math.floor(
    (Date.now() - new Date(latest.snapshot_date).getTime()) / 86_400_000
  )
  const staleStr = ageDays > 1 ? ` ⚠️ ${ageDays}d old` : ''

  return `💼 Net Worth: ${fmt(nw)}${deltaStr}${staleStr}`
}
```

### 5 — `lib/orchestrator/digest.ts` (modify)

Add import at the top of the imports block:

```typescript
import { buildNetWorthDigestLine } from '@/lib/net-worth/digest'
```

Add call in the message assembly section (after `buildOllamaTunnelHealthLine` call or in the wealth section — keep with financial lines):

```typescript
const netWorthLine = await buildNetWorthDigestLine()
messageToSend = `${messageToSend}\n${netWorthLine}`
```

---

## GitHub Prior Art (Check-Before-Build §8.4)

- AreaChart: Recharts + shadcn/ui `ChartContainer` — already in use (see `AmazonDailyChart.tsx`). Reference, don't duplicate.
- Digest line pattern: same as 12 other lines already in `digest.ts`. Reference.
- No new libraries needed.

---

## Acceptance Criteria

- [ ] `GET /api/net-worth` returns `vehiclesAutoValue` and `inventoryAutoValue` fields
- [ ] Vehicle value matches `SUM(vehicles.current_value_estimate)` — no Tesla double-count in totals
- [ ] Inventory value matches latest `inventory_snapshots.value_at_cost`
- [ ] `/net-worth` trend chart renders as AreaChart with 3 series (no raw SVG fallback for ≥2 datapoints)
- [ ] Staleness banner visible when latest snapshot is >1 day old
- [ ] `vercel.json` has `GET /api/net-worth/snapshot` cron at `0 7 * * *`
- [ ] `lib/net-worth/digest.ts` exported `buildNetWorthDigestLine` compiles
- [ ] Morning digest message includes net worth line
- [ ] No `style=` attributes in any new or modified `.tsx` lines added by this task (F20)
- [ ] No TypeScript errors (`tsc --noEmit` clean on touched files)

---

## F-Rule Compliance

| Rule | How |
|------|-----|
| F20 | New JSX in NetWorthPage changes and new components use Tailwind only |
| F17 | Net worth is a direct wealth signal; digest line feeds daily behavioral context |
| F18 | Digest line surfaces net_worth + delta every morning; staleness banner is the observability surface |

---

## Risk Flags

| Risk | Severity | Mitigation |
|------|----------|------------|
| Double-count vehicles if balance_sheet_entries row not excluded | HIGH | Dedup logic: exclude `category='equipment' AND name ILIKE '%vehicle%'` when vehicles table non-empty |
| Double-count inventory if balance_sheet_entries row not excluded | HIGH | Dedup logic: exclude `category='inventory'` when inventory_snapshots non-empty |
| `vehicles.current_value_estimate` all null | LOW | SUM returns null → vehiclesAutoValue=null → no injection; existing balance_sheet_entries rows used as-is |
| AreaChart import not tree-shaken in bundle | LOW | Recharts already used in AmazonDailyChart; no new dep |

---

## Out of Scope

- F20 refactor of existing NetWorthPage.tsx inline styles (separate cleanup task)
- Pulling from `transactions` or `business_review` tables (Q4 deferred)
- Brokerage / crypto asset classes (no tables exist yet)
- Adding / deleting balance_sheet_entries rows (Colin cleans up the Tesla equipment entry separately)
