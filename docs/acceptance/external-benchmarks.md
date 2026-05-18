# External Benchmarking Layer — Acceptance Doc

**Migration:** `0270_external_benchmarks.sql` (pre-claimed, branch `feat/external-benchmarks`)
**F-rules:** F17, F18, F20, F21, F22, F24

---

## Schema

```sql
CREATE TABLE public.external_benchmarks (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_name TEXT          NOT NULL,
  vs_system      TEXT          NOT NULL,
  parity_score   NUMERIC(5,2)  NOT NULL CHECK (parity_score >= 0 AND parity_score <= 100),
  notes          TEXT,
  measured_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_eb_vs_system_measured ON public.external_benchmarks (vs_system, measured_at DESC);
CREATE INDEX idx_eb_measured_at ON public.external_benchmarks (measured_at DESC);

ALTER TABLE public.external_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "external_benchmarks_authenticated" ON public.external_benchmarks
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- F24 — required
GRANT INSERT, UPDATE, DELETE ON public.external_benchmarks TO service_role;
```

---

## API Routes — `app/api/benchmarks/route.ts`

### GET `/api/benchmarks`
- Auth: `requireUser({ minRole: 'business' })` (match existing Systems page routes — grep for this pattern)
- Query: `SELECT * FROM external_benchmarks ORDER BY measured_at DESC LIMIT 100`
- Response: `200 { benchmarks: ExternalBenchmark[], fetchedAt: string }`
- `parity_score` must be cast to `Number()` (Supabase returns numeric as string)

### POST `/api/benchmarks`
- Auth: `requireCronSecret(request)` from `lib/auth/cron-secret.ts` — **F22, call this first**
- Body: `{ benchmark_name: string, vs_system: string, parity_score: number (0–100), notes?: string, measured_at?: string }`
- Validate: all required fields non-empty, parity_score in [0,100]
- Response: `201 { ...row }` on success, `400 { error: string }` on validation fail

```typescript
export interface ExternalBenchmark {
  id: string
  benchmark_name: string
  vs_system: string
  parity_score: number
  notes: string | null
  measured_at: string
}
```

---

## UI — Systems Page Widget

Read the existing Systems page before touching it:
- `app/(cockpit)/systems/page.tsx` — server component
- `app/(cockpit)/systems/_components/SystemsShell.tsx` — client shell

**New component:** `app/(cockpit)/systems/_components/BenchmarkTable.tsx` (client component)

- Props: `{ initialBenchmarks: ExternalBenchmark[] }`
- Renders shadcn/ui `Table` with columns: System | Benchmark | Score | Measured | Notes
- Score coloring (Tailwind classes only, NO `style={}`):
  - `>= 80`: `text-positive` (or equivalent green CSS var)
  - `60–79`: `text-warning`
  - `< 60`: `text-destructive` (or red equivalent)
- Empty state: "No benchmarks recorded yet."
- Fetch failure: "Could not load benchmarks."

**Extend `SystemsShell.tsx`:** add `initialBenchmarks: ExternalBenchmark[]` prop, render `<BenchmarkTable>` in a new `<section>` with a `<div className="border-t border-border" />` divider before it.

**Extend `page.tsx`:** add one more Supabase query inside the existing `Promise.all`:
```typescript
supabase
  .from('external_benchmarks')
  .select('id, benchmark_name, vs_system, parity_score, notes, measured_at')
  .order('measured_at', { ascending: false })
  .limit(100)
```
Pass result as `initialBenchmarks` to `SystemsShell`.

**F20 hard rule:** `grep -n "style=" app/(cockpit)/systems/_components/BenchmarkTable.tsx` must return zero matches.

---

## Acceptance Criteria

### Migration
- [ ] `supabase/migrations/0270_external_benchmarks.sql` exists
- [ ] `GRANT INSERT, UPDATE, DELETE ON public.external_benchmarks TO service_role;` present (F24)
- [ ] RLS enabled, SELECT policy for `auth.uid() IS NOT NULL`
- [ ] `parity_score CHECK (>= 0 AND <= 100)` present
- [ ] `scripts/lint-migration-grants.mjs` passes

### GET /api/benchmarks
- [ ] Returns 401 if unauthenticated
- [ ] Returns `200 { benchmarks: [], fetchedAt }` with empty table
- [ ] `parity_score` is a number in response (not string)

### POST /api/benchmarks
- [ ] Returns 401 without correct CRON_SECRET
- [ ] Returns 500 if CRON_SECRET env var missing (requireCronSecret contract)
- [ ] Returns 400 for missing `benchmark_name`
- [ ] Returns 400 for `parity_score: 101`
- [ ] Returns 201 with all fields on valid POST

### UI
- [ ] `BenchmarkTable.tsx` renders rows correctly
- [ ] `grep -n "style=" BenchmarkTable.tsx` returns 0 matches (F20)
- [ ] Score `>= 80` gets green class, `60-79` warning, `< 60` destructive/red
- [ ] Empty state renders without throwing
- [ ] Existing gauges and BrainDumpFeed still render (no regression)
- [ ] `next build` exits 0 with no TypeScript errors

---

## Out of Scope
- Trend charts / sparklines
- Edit/delete UI (append-only)
- Aggregated rollup gauge
- Automated measurement cron

## F17
Feeds Growing-pillar capability trajectory. Each row = timestamped capability datapoint. Series of `parity_score` over time = growth curve for that dimension.

## F18
- **Metric:** parity_score per (benchmark_name, vs_system)
- **Benchmark:** >= 80% parity = competitive (Colin's threshold)
- **Query:** `SELECT vs_system, benchmark_name, parity_score, measured_at FROM external_benchmarks ORDER BY vs_system, benchmark_name, measured_at DESC`
