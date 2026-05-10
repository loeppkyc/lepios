# Acceptance Doc — F18 Ceiling Metric Layer

**task_id:** a3de7bed-2bce-4832-a1a1-28b87f104d62  
**chunk:** f18-ceiling  
**sprint:** 5  
**status:** awaiting-colin-approval  
**prepared:** 2026-05-10  
**study doc:** docs/sprint-5/f18-ceiling-study.md

---

## Scope

**One sentence:** Add a `module_ceiling_metrics` table seeded with 3 examples (vercel cron frequency, Ollama embed throughput, Twin answer rate), a read API endpoint, and a minimal dashboard table at a new `/harness/ceiling` route.

**Acceptance criterion:** After deploy, Colin navigates to `/harness/ceiling` and sees a table with 3 rows showing module name, current value, benchmark, ceiling value, ceiling cause category (with traffic-light color), lift cost, and estimated gain — matching the seeded data exactly.

---

## Out of scope

- F17 integration (ceiling-lift decisions → path engine agent_events signal) — follow-up chunk
- Morning digest ceiling summary line — follow-up chunk
- Retrofitting more than 3 seed rows in v1 — new rows added via INSERT
- Automated syncing of `current_value` from live data — all values are manually maintained in v1
- Merging with `harness_resource_budgets` — separate concept, separate table (see study doc §2)

---

## Files expected to change

| File | Change |
|------|--------|
| `supabase/migrations/0171_module_ceiling_metrics.sql` | New migration: table + RLS + 3 seed rows |
| `app/api/metrics/ceiling/route.ts` | New GET endpoint: returns all rows, service role |
| `app/(cockpit)/harness/ceiling/page.tsx` | New dashboard page: table with traffic-light coloring |
| `app/(cockpit)/harness/ceiling/_components/CeilingTable.tsx` | Table component, uses shadcn/ui Table |

> If `/harness` route group doesn't exist: builder creates it. Colin's call on whether this goes under `/harness`, `/metrics`, or standalone `/ceiling`.

---

## Check-Before-Build findings

| Area | What exists | Decision |
|------|-------------|----------|
| `harness_resource_budgets` (0159) | Count-of-resources ceiling (vercel crons=18, deps=300) | Keep separate — different concept. New table. |
| `lib/metrics/rollups.ts` | Aggregation helpers | Reuse pattern; do NOT add ceiling rollup here in v1 |
| `lib/payouts/benchmark.ts` | BENCHMARK constant + pace compute | Pattern only — ceiling data is DB-resident, not TS constants |
| `app/(cockpit)/` | 38 cockpit modules, 2 F18-compliant | No dashboard component for ceiling exists |
| Migration `0170_dropbox_capability.sql` | Most recent migration | Next available: `0171` |

---

## Migration schema — `module_ceiling_metrics`

```sql
CREATE TABLE public.module_ceiling_metrics (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  module                 TEXT         NOT NULL,
  metric_name            TEXT         NOT NULL,
  metric_unit            TEXT,
  current_value          NUMERIC,
  benchmark_value        NUMERIC,
  ceiling_value          NUMERIC,
  ceiling_cause          TEXT         NOT NULL,
  ceiling_cause_category TEXT         NOT NULL CHECK (ceiling_cause_category IN ('money', 'hardware', 'time')),
  ceiling_lift_cost      TEXT,
  ceiling_lift_gain_pct  NUMERIC,
  benchmark_source       TEXT         CHECK (benchmark_source IN ('colin-target', 'industry', 'known-good')),
  last_updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  notes                  TEXT,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE public.module_ceiling_metrics ENABLE ROW LEVEL SECURITY;
-- Same posture as harness_config: service role bypasses RLS; anon/authenticated locked out.

-- Seed: 3 examples from task description
INSERT INTO public.module_ceiling_metrics
  (module, metric_name, metric_unit, current_value, benchmark_value, ceiling_value,
   ceiling_cause, ceiling_cause_category, ceiling_lift_cost, ceiling_lift_gain_pct,
   benchmark_source, notes)
VALUES
  (
    'vercel-cron',
    'Task pickup frequency',
    'runs/day',
    24,
    24,
    24,
    'Vercel Hobby plan: max 1 hourly cron (24 runs/day). Pro plan allows sub-hourly.',
    'money',
    '~$20/month Vercel Pro → continuous cron possible (every 5 min = 288/day)',
    1100,
    'colin-target',
    'Currently at ceiling but benchmark is met. Lift needed only if queue grows beyond 24 tasks/day.'
  ),
  (
    'ollama-embed',
    'Corpus embedding throughput',
    'docs/min',
    10,
    50,
    15,
    'RAM constraint on current hardware limits Ollama parallel inference batch size.',
    'hardware',
    'GPU/RAM upgrade OR switch to cloud embedding API (OpenAI ada-002 ~$0.10/1M tokens)',
    500,
    'colin-target',
    'Weekly re-embed of ~500 docs: at 10 docs/min takes 50 min; at ceiling 15 docs/min = 33 min; at benchmark 50 docs/min = 10 min.'
  ),
  (
    'twin',
    'Self-answer rate',
    '% answered without Colin escalation',
    NULL,
    50,
    75,
    'Corpus density — design-intent questions lack ingested context (sprint acceptance docs, CLAUDE.md entries, architecture decisions).',
    'time',
    'Passive — grows as project generates more ingestible content. Accelerated by ingest-claude-md runs.',
    50,
    'colin-target',
    'current_value NULL until live measurement wired. Ceiling estimate 75% based on gap analysis; time-fixable as corpus matures.'
  );
```

---

## API contract — `GET /api/metrics/ceiling`

**Auth:** CRON_SECRET bearer OR authenticated Supabase session  
**Response shape:**

```json
{
  "rows": [
    {
      "id": "uuid",
      "module": "vercel-cron",
      "metric_name": "Task pickup frequency",
      "metric_unit": "runs/day",
      "current_value": 24,
      "benchmark_value": 24,
      "ceiling_value": 24,
      "ceiling_cause": "Vercel Hobby plan: max 1 hourly cron...",
      "ceiling_cause_category": "money",
      "ceiling_lift_cost": "~$20/month Vercel Pro",
      "ceiling_lift_gain_pct": 1100,
      "benchmark_source": "colin-target",
      "last_updated_at": "2026-05-10T...",
      "notes": "...",
      "status": "at_ceiling"
    }
  ]
}
```

**`status` field (computed at read time):**
- `at_ceiling` — current_value >= ceiling_value (or within 5%)
- `below_benchmark` — current_value < benchmark_value (room to improve before ceiling matters)
- `ok` — current_value >= benchmark_value and below ceiling

---

## Dashboard — `/harness/ceiling`

**Component:** `CeilingTable` — shadcn/ui Table  
**Columns:** Module | Metric | Current | Benchmark | Ceiling | Category | Lift Cost | Gain %  
**Sorting:** hardest-to-fix category first: `hardware` → `money` → `time`  
**Category coloring:** 🔴 hardware | 🟡 money | 🟢 time (Tailwind color classes only; no `style={}`)  
**Staleness:** rows with `last_updated_at` older than 30 days show a ⚠️ stale indicator  
**No inline style attributes** (F20 enforced; builder tests grep for `style=` on new TSX files)

---

## External deps tested

- `module_ceiling_metrics` table: new (this migration creates it)
- `/harness` route group: builder verifies or creates
- No external API calls

---

## Grounding checkpoint

After deploy, Colin runs:

```sql
SELECT module, metric_name, current_value, benchmark_value, ceiling_value, ceiling_cause_category
FROM module_ceiling_metrics
ORDER BY created_at;
-- Expect 3 rows: vercel-cron, ollama-embed, twin
-- Verify ceiling_cause_category = 'money', 'hardware', 'time' respectively
-- Verify ceiling_value = 24, 15, 75 respectively
```

Then navigates to `/harness/ceiling` and confirms:
- 3 rows render
- Categories show correct traffic-light coloring
- `current_value = NULL` for twin row shows gracefully (not NaN or crash)

---

## Kill signals

- Builder cannot create the route group without touching `app/layout.tsx` or shared navigation — escalate immediately, do not self-approve
- Dashboard requires auth middleware change — escalate
- Migration conflicts with another PR at `0171` — check `.claude/migration-claims.json` before applying

---

## Cached-principle decisions

None applied. Cache-match is enabled per sprint-state.md but this acceptance doc is escalated to Colin for explicit approval due to:
1. Twin endpoint blocked for all 3 Q&A questions — insufficient confidence to proceed without Colin input
2. Dashboard location is a Colin design decision (new route vs. existing page)
3. This is new terrain for F18 (no prior ceiling metrics pattern established)

META-C condition (b) fails: confidence cannot be `high` with 3 unresolved design questions.

---

## Open questions (require Colin response before builder can proceed)

**Q1 — Dashboard location:**  
Coordinator proposes `/harness/ceiling` (new route under `app/(cockpit)/harness/ceiling/`).  
Alternatives: section on existing `/metrics` page (if it exists) or appended to harness scoring dashboard.  
→ **Colin: confirm route location**

**Q2 — harness_resource_budgets link:**  
New `module_ceiling_metrics` table is a separate concept (performance ceilings vs. count limits). Should the two be cross-linked in the dashboard (e.g., "resource limits" and "performance ceilings" as two sections on one page)?  
→ **Colin: separate pages or combined?**

**Q3 — twin current_value:**  
Twin answer rate `current_value` is NULL in seed data because the coordinator sandbox can't reach the twin endpoint. Should builder:  
(a) Leave NULL until measurement is wired (v1 behavior), or  
(b) Wire a live query from `agent_events` WHERE action IN ('twin.answer', 'twin.escalate') and auto-compute current_value on page load?  
Coordinator recommends (a) for tight scope — add live measurement in a follow-up chunk.  
→ **Colin: option (a) or (b)?**

---

## F17 + F18 compliance for this chunk

**F17:** Ceiling-lift decisions are named as a preference signal for the path engine (CLAUDE.md). This chunk establishes the data layer; signal emission deferred. Justification: the table schema includes `ceiling_cause_category` which is the key field for future preference signal routing. Baseline established.

**F18 capture:** `module_ceiling_metrics` rows updated at last_updated_at — observable in DB.  
**F18 benchmark:** Table stores benchmark_value per row with source column.  
**F18 surfacing:** Dashboard page at `/harness/ceiling` provides the "Colin asks, gets a number + comparison" path.

---

## Cost estimate

Builder session: ~2 hours (1 migration + 1 API route + 1 page + 1 component). No external integrations, no complex business logic.
