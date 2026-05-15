# Acceptance Doc — cockpit-money-pnl-wiring
task_id: 9c6cbd80-7b8f-4307-8e6c-c045eefa4f96
coordinator_run_id: b9c4861b-db2c-43b4-b5ec-5cb8ac7936b0
created_at: 2026-05-15

---

## Scope

Wire live Amazon settlement income and business expense data into the Money pillar cockpit
page (`app/(cockpit)/money/page.tsx`). Currently the P&L arc gauge is hardcoded to `value={0}`,
the Amazon and Expenses PillBars are hardcoded to `value={0}`, and the summary readout shows
"awaiting data".

**Acceptance criterion:** After this change, loading `/money` in production shows:
- Arc gauge: non-zero % computed from live DB data (formula defined below)
- Amazon PillBar: non-zero CAD from `amazon_settlements`
- Expenses PillBar: non-zero CAD from `business_expenses`
- Summary readout: net profit CAD (amazon_net − expenses) for the current calendar month

---

## Out of scope

- No new database schema (all tables exist and are populated)
- No new API route (page.tsx is a server component — query Supabase directly, same
  pattern as `app/api/cash-forecast/route.ts`)
- No changes to the Betting tile or Amazon Deals tile below the gauge row
- Trading PillBar remains `value={0}` — no trading income table exists yet
- No harness_config tunable max values — hardcoded reasonable defaults for now
- Cron/background refresh — `export const dynamic = 'force-dynamic'` is already set,
  so each page load fetches live data

---

## Data queries (proven against production DB 2026-05-15)

### Amazon income — current calendar month

```sql
SELECT COALESCE(SUM(net_payout), 0) AS amazon_net_cad
FROM amazon_settlements
WHERE period_end_at >= DATE_TRUNC('month', CURRENT_DATE)
  AND period_end_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month';
-- Result 2026-05-15: $8,012.82 CAD (4 settlements)
```

### Business expenses — current calendar month

```sql
SELECT COALESCE(SUM(pretax * business_use_pct / 100.0), 0) AS expenses_cad
FROM business_expenses
WHERE date >= DATE_TRUNC('month', CURRENT_DATE)
  AND date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month';
-- Result 2026-05-15: $1,461.31 CAD (4 expenses)
```

### 6-month trend data (for sparkline)

```sql
SELECT
  DATE_TRUNC('month', period_end_at) AS month,
  SUM(net_payout) AS amazon_net
FROM amazon_settlements
WHERE period_end_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
GROUP BY 1 ORDER BY 1 ASC;
-- Returns 6 rows: Dec 2025 → May 2026
```

---

## Wiring spec

### P&L arc gauge (OPEN QUESTION — see §Colin Questions)

Proposed formula (builder implements, Colin confirms at grounding):

```ts
const pnlGaugePct = amazonNet > 0
  ? Math.round(Math.max(0, Math.min(100, ((amazonNet - expensesCad) / amazonNet) * 100)))
  : 0
// For May 2026: (8012.82 - 1461.31) / 8012.82 × 100 = 81.8% → 82
```

If Colin prefers a different definition (goal attainment vs monthly target), builder overrides
this formula. The gauge label remains "P&L" regardless of formula.

### Amazon PillBar

```tsx
<PillBar
  label="Amazon"
  value={Math.round(amazonNet)}
  max={15000}   // $15k CAD monthly target — see open question on max
  unit=" CAD"
  color="var(--color-pillar-money)"
/>
```

`max={15000}` is a reasonable upper bound given recent monthly data ($8k–$28k range);
change to `max={Math.max(amazonNet * 1.5, 15000)}` if Colin wants a dynamic bar.

### Expenses PillBar

```tsx
<PillBar
  label="Expenses"
  value={Math.round(expensesCad)}
  max={5000}   // $5k monthly cap; ~$1,461 actual May 2026
  unit=" CAD"
  color="var(--color-critical)"
  height={6}
/>
```

### Summary readout

Replace "—" / "awaiting data" with:

```tsx
const netProfit = amazonNet - expensesCad
// Display: "+$6,552" or "-$1,234" in color-positive/critical
```

### Page subtitle

Replace:
```
Sprint 1 skeleton — P&L gauge placeholder until orders data arrives
```
with:
```
Money pillar — live Amazon settlements + expenses · {current month name}
```

### Trend sparkline (OPEN QUESTION — see §Colin Questions)

If Colin confirms the trend chart is in scope: add a raw SVG sparkline below the PillBars
row showing 6 months of `amazon_net` data. Use the `Sparkline` function pattern from
`app/(dashboard)/autonomous/_components/QualityTrends.tsx` as the reference implementation.
Width: 100% of the container; height: 40px. Show month labels on x-axis (abbreviated:
"Dec", "Jan", etc.).

If Colin says trend chart is out of scope: skip this — gauge + PillBars wiring only.

---

## Files expected to change

| File | Change |
|------|--------|
| `app/(cockpit)/money/page.tsx` | Add 3 Supabase queries at top of MoneyPage(); wire amazonNet, expensesCad, pnlGaugePct into gauge/PillBars/summary; optionally add Sparkline component; fix subtitle |

No other files. No migration. No new packages.

---

## Check-Before-Build findings

- `amazon_settlements.net_payout` — exists, populated (recent months: Apr $8,118, May $8,013 partial)
- `business_expenses.pretax`, `.date`, `.business_use_pct` — all exist, populated (5,442 rows)
- Identical query patterns already in production: `app/api/cash-forecast/route.ts` lines 62–82
- Sparkline pattern: `app/(dashboard)/autonomous/_components/QualityTrends.tsx` — raw SVG, copy the `function Sparkline` definition
- No prior `app/api/money/` API route — page.tsx is already a server component, direct Supabase query is correct

---

## External deps tested

- `amazon_settlements` table: confirmed present and populated (2026-05-15 MCP query)
- `business_expenses` table: confirmed present and populated (2026-05-15 MCP query)
- No external API calls required

---

## Grounding checkpoint

Colin visits `https://lepios-one.vercel.app/money` after deploy and verifies:

1. **Arc gauge is non-zero**: should show approximately 82 (May P&L margin) — exact value
   varies with the month's settlement timing
2. **Amazon PillBar is non-zero**: should show approximately $8,013 CAD for May
3. **Expenses PillBar is non-zero**: should show approximately $1,461 CAD for May
4. **Summary readout**: shows net profit (approximately +$6,552 CAD for May 2026)
5. (If trend chart added) Sparkline renders 6 bars without console errors

No DB write required for this grounding check — all read-only.

---

## Kill signals

- `amazon_settlements` query returns error → escalate, do not ship a broken gauge
- `business_expenses` query returns error → escalate, do not ship
- Builder produces a client component that makes API calls for this data → wrong; the
  page is a server component; builder must query Supabase directly in the page function

---

## Cached-principle decisions

None applied for this doc — twin was unreachable (host not in allowlist in coordinator
sandbox, 2026-05-15). All open questions escalated to Colin below. Doc cannot be
auto-proceeded; must wait for Colin approval.

---

## Twin Q&A — blocked (endpoint unreachable)

All three questions added to pending_colin_qs:

1. **Gauge definition**: "What percentage should the P&L arc gauge show — net profit
   margin as (amazon_net - expenses) / amazon_net × 100, or goal attainment as
   current_month_amazon_net / monthly_target × 100? If goal attainment, what is the
   monthly target in CAD?"

2. **Amazon PillBar max**: "What is the correct max value for the Amazon income PillBar?
   Current code has max=5000 CAD but actual monthly net settlements range from $8k to $97k.
   Should the bar max be dynamic (trailing 3-month avg × 1.5) or a fixed target (e.g. $15k)?"

3. **Trend chart scope**: "Is adding a 6-month amazon net payout sparkline trend chart
   below the PillBars in scope for this task, or should the fix be limited to wiring the
   gauge and PillBars to live data?"

---

## Open questions (for Colin)

See Twin Q&A section above — all three questions require Colin's decision, not corpus
lookup. The acceptance doc is written with sensible defaults (net margin %, max=15000,
trend chart included if feasible). Colin can override any of these at approval time.

---

## GitHub prior art

- No open-source library needed — this is a data wiring change in an existing Next.js
  server component
- Reference implementation: `app/api/cash-forecast/route.ts` — same Supabase query
  pattern using `amazon_settlements` and `business_expenses` tables
- Sparkline reference: `app/(dashboard)/autonomous/_components/QualityTrends.tsx`

---

## F17 — Behavioral ingestion justification

Money pillar gauge wiring surfaces a live P&L margin metric. Once live:
- Provides a real-time signal for "is the business profitable this month?"
- The trend sparkline feeds a visual pattern for month-over-month Amazon revenue
- Both contribute to the financial awareness loop in Colin's behavioral model

F17 satisfied: live financial metric, directly useful for daily money decisions.

---

## F18 — Measurement + benchmark

- **Metric captured**: `agent_events` row on page load (existing pattern if Money page
  has error handling) — or a simple `SELECT COUNT(*) FROM amazon_settlements WHERE
  period_end_at >= DATE_TRUNC('month', CURRENT_DATE)` as the data-freshness signal
- **Benchmark**: P&L margin goal ≥ 70% (if Colin confirms net-margin definition)
- **Surfacing**: Monthly P&L page already surfaces the deeper breakdown; Money pillar
  is the at-a-glance cockpit number
