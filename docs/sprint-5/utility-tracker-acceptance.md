# Utility Tracker — Acceptance Doc

**Sprint:** 5 (parallel track — Streamlit module port)
**Chunk:** `utility-tracker`
**Coordinator task:** `8b3d7030-a873-431a-b82f-6dbd4ceda83d`
**Study doc:** `docs/sprint-5/utility-tracker-streamlit-study.md`
**Date:** 2026-04-27
**Cache-match:** DISABLED (Sprint 4 baseline carry-forward — explicit override in sprint-state.md)

---

## Scope

Port the Utility Tracker page to LepiOS as a Supabase-backed Next.js App Router page with
summary metrics, bar charts, data table, and an add/update form.

**Acceptance criterion:** Colin can (a) view existing utility bills with 4 summary metrics and
two bar charts, (b) add a new month entry via the form, (c) update an existing month entry via
the same form, and (d) see data refreshed immediately after save — with zero Google Sheets
dependency.

---

## Out of scope

- Historical data migration from Google Sheets (separate follow-on task if requested)
- PDF/email import from Metergy statements (future automation)
- Multi-property support
- Budget targets or forecast lines on charts
- Mobile camera scan of bills

---

## Files expected to change

| File | Change |
|------|--------|
| `supabase/migrations/0039_utility_bills.sql` | New — creates `utility_bills` table |
| `supabase/migrations/0040_register_utility_tracker_component.sql` | New — registers `harness:streamlit_rebuild_utility_tracker` in `harness_components` at 100% |
| `app/(cockpit)/utility/page.tsx` | New — server component: renders metrics, charts, table |
| `app/(cockpit)/utility/_components/UtilityEntryForm.tsx` | New — client component: add/update form |
| `app/(cockpit)/utility/actions.ts` | New — server action: upsert entry into `utility_bills` |
| `app/(cockpit)/layout.tsx` | Update — add nav entry for `/utility` if nav list is explicit |
| `tests/utility-tracker.test.ts` | New — F21 acceptance tests (written before implementation) |

---

## Check-Before-Build findings

| Check | Result |
|-------|--------|
| `utility_bills` table in Supabase | Not found — build fresh |
| Existing utility page in `app/` | Not found — build fresh |
| Google Sheets client in `lib/` | Not found — no dependency; Supabase-native |
| Streamlit `load_utility_data` logic | Recovered from knowledge corpus (2 chunks); fully reconstructed |
| Next migration number available | 0039 ✓ (0037 is last applied; 0038 exists locally, unapplied) |

---

## External deps tested

| Dep | Status | Notes |
|-----|--------|-------|
| Supabase (lepios project) | Live, healthy | createServiceClient pattern confirmed working in money/page.tsx |
| Google Sheets | NOT used | Intentional — data moves to Supabase |
| Twin endpoint | Unreachable from build env | All Phase 1b questions resolved by design decision (see study doc) |

---

## Schema spec

```sql
-- 0039_utility_bills.sql
CREATE TABLE utility_bills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month       text NOT NULL UNIQUE,  -- YYYY-MM, unique constraint enforces upsert key
  kwh         numeric(8,2) NOT NULL CHECK (kwh >= 0),
  amount_cad  numeric(8,2) NOT NULL CHECK (amount_cad >= 0),
  provider    text NOT NULL DEFAULT 'Metergy',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE utility_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON utility_bills
  USING (auth.role() = 'service_role');

-- Index for chronological display
CREATE INDEX utility_bills_month_idx ON utility_bills (month DESC);
```

> **Safety Agent review required:** Migration creates a new table with RLS. No destructive ops.
> Schema is reversible (DROP TABLE). Service-role-only policy is the standard LepiOS pattern.

**Component registration (0040_register_utility_tracker_component.sql):**
```sql
INSERT INTO harness_components (id, display_name, weight_pct, completion_pct, notes, updated_at)
VALUES (
  'harness:streamlit_rebuild_utility_tracker',
  'Streamlit rebuild — Utility Tracker',
  1.0,
  100.0,
  'Tier 3 port of pages/52_Utility_Tracker.py. Supabase-backed; no Sheets dependency.',
  now()
);
```

---

## Page spec

### Route
`app/(cockpit)/utility/page.tsx` → URL: `/utility`

### Server component data fetch
```typescript
const { data: bills } = await supabase
  .from('utility_bills')
  .select('id, month, kwh, amount_cad, provider, notes, updated_at')
  .order('month', { ascending: false })  // newest first
  .limit(60)                              // ~5 years of data
```

### Summary metrics (4 tiles)
| Metric | Formula | Format |
|--------|---------|--------|
| Total Billed | `SUM(amount_cad)` | `$X,XXX.XX` |
| Avg Monthly Cost | `AVG(amount_cad)` | `$XX.XX` |
| Avg Monthly kWh | `AVG(kwh)` | `XXX kWh` |
| Latest Bill | `bills[0].amount_cad` (newest row) | `$XX.XX` + delta vs prior month |

**20% Better — Latest Bill metric:** Add month-over-month delta (▲/▼ vs previous month amount_cad)
as a secondary line. If no prior month, show the month label only.

### Charts
Two bar charts side by side using shadcn/ui `<BarChart>` or a thin wrapper over Recharts:
- Left: Monthly kWh (amber token: `var(--color-pillar-growing)`)
- Right: Monthly Cost in CAD (gold token: `var(--color-pillar-money)`)
- X-axis: month labels `MMM YYYY` format
- Data ordered oldest-to-newest on chart (ascending), table displayed newest-first

### Data table
shadcn/ui `<Table>` component. Columns: Month | kWh | Amount | Provider | Notes
- kWh formatted to 1 decimal
- Amount formatted as `$XX.XX`
- Provider column hidden if all rows share the same value (show as caption note instead)
- Newest first (data fetched DESC)

### Add/Update form (Client Component)
`UtilityEntryForm.tsx`:
- Fields: Month (YYYY-MM text input), kWh (number), Amount $ (number), Provider (text, default "Metergy"), Notes (text optional)
- Validation: month matches `/^\d{4}-\d{2}$/`, kWh ≥ 0, amount ≥ 0
- Month normalization: normalize single-digit month to two digits before send (fixes Streamlit upsert dup bug)
- Submit calls `saveUtilityBill()` server action
- On success: router.refresh() to reload server component data
- Error display: inline below the form (not a toast)

### Server action (`actions.ts`)
```typescript
'use server'
// Upsert: ON CONFLICT (month) DO UPDATE — no positional column dependency
await supabase.from('utility_bills').upsert({
  month, kwh, amount_cad: amount, provider, notes,
  updated_at: new Date().toISOString(),
}, { onConflict: 'month' })

// F18: log agent_events
await supabase.from('agent_events').insert({
  domain: 'finance', action: 'utility_bill_saved', actor: 'user',
  status: 'success', meta: { month, kwh, amount_cad: amount }
})
```

---

## F17 — Behavioral ingestion justification

Monthly electricity cost is a personal finance signal. Each save logs to `agent_events`
(`action='utility_bill_saved'`), feeding the improvement loop. YTD total and month-over-month
delta are surfaceable via `morning_digest` Q&A. Signal is low-frequency (one entry/month) but
persistent — Colin can ask "how much did I spend on electricity this year?" and get a DB-sourced
number. Satisfies F17 minimum bar: measurable, autonomous-queryable.

---

## F18 — Measurement + benchmark

| Metric | How to query | Benchmark |
|--------|-------------|-----------|
| Total entries | `SELECT COUNT(*) FROM utility_bills` | Should grow by 1/month |
| YTD total | `SELECT SUM(amount_cad) FROM utility_bills WHERE month LIKE '2026-%'` | Colin's target: N/A (track actuals) |
| Month-over-month delta | `SELECT month, amount_cad, LAG(amount_cad) OVER (ORDER BY month) FROM utility_bills` | Stable or decreasing |
| Save events | `SELECT COUNT(*) FROM agent_events WHERE action='utility_bill_saved'` | Should match row count |

---

## Grounding checkpoint

After builder ships and migration is applied:

1. `SELECT * FROM utility_bills ORDER BY month DESC LIMIT 5` — verify table exists and is queryable
2. Load `/utility` — verify page renders with 4 metrics (all showing `—` or `$0` if no data yet)
3. Enter one month of data via the form (e.g. Month: `2026-01`, kWh: `456`, Amount: `78.90`)
4. Verify the entry appears in the table, newest first
5. Re-enter the same month with updated values — verify UPDATE semantics (row count stays at 1 for that month)
6. `SELECT * FROM agent_events WHERE action='utility_bill_saved' ORDER BY occurred_at DESC LIMIT 3` — verify F18 events
7. `SELECT * FROM harness_components WHERE id = 'harness:streamlit_rebuild_utility_tracker'` — verify component at 100%

**NOT a grounding checkpoint:** tests pass. Tests verify code, not live behavior.

---

## Kill signals

- Page renders but form save always errors → block builder, diagnose Supabase RLS/policy
- Migration 0039 conflicts with a concurrently applied migration → rename to next available number
- Colin says the Utility Tracker is unused / being retired → stop, close task as won't-fix

---

## F20 compliance requirements

Builder acceptance tests MUST grep `app/(cockpit)/utility/` for `style=` and verify:
- No arbitrary values (hex colors, pixel values, string widths) in `style={}`
- CSS design-token vars (`var(--color-*)`, `var(--font-*)`, etc.) are allowed
- All layout via Tailwind utility classes (`flex`, `gap-*`, `p-*`, `grid`, etc.)

---

## Open questions

None. Design decisions in study doc `## Twin Q&A — blocked` section cover all ambiguities.

---

## META-C evaluation

**Cache-match DISABLED** — explicit override `cache_match_enabled: false` in sprint-state.md
(Sprint 4 baseline, rule 4 of Phase 0). Every acceptance doc escalates to Colin.

This doc is submitted to Colin for explicit approval before going to builder.
