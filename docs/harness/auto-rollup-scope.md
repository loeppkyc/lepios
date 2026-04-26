# Harness Auto-Rollup — Scope Doc

**Status:** Blocked — missing DB foundation. Do not build rollup logic until
schema described below is applied and seeded.

**Requested feature:** `computeHarnessRollup()` called by `morning_digest`,
appends a line like:

```
Harness rollup: 83.8% (up from 78.2% yesterday)
```

---

## Audit findings (2026-04-27)

### What exists today

- Rollup model lives entirely in `memory/harness_tracker.md` — a hand-curated
  table updated manually after major milestones.
- `task_queue` schema: `id, task, description, priority, status, source,
metadata (JSONB), result (JSONB), estimated_minutes, actual_minutes,
estimation_error_pct` — **no `weight` column, no harness component tag**.
- No Supabase table maps tasks to harness components or stores component
  completion %.

### Why the direct approach (weight on task_queue) won't work

`task_queue` holds individual work items, not harness components. A single
harness component (e.g. "Digital Twin Q&A") spans multiple tasks across
multiple sprints. Attaching a per-task `weight` and summing them would give
queue throughput, not component completion %.

---

## Schema changes required

### Option A — `harness_components` table (recommended)

One row per harness component. Manually updated (or updated by automation)
when a component milestone ships.

```sql
-- migration 0032_harness_components.sql
CREATE TABLE public.harness_components (
  id            TEXT PRIMARY KEY,           -- slug: 'coordinator_loop', 'remote_invocation', …
  display_name  TEXT NOT NULL,
  weight_pct    NUMERIC(5,2) NOT NULL,      -- e.g. 20.00 — must sum to 100
  completion_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (completion_pct BETWEEN 0 AND 100),
  notes         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Seed with current values from `memory/harness_tracker.md`:

| id                | display_name                 | weight_pct | completion_pct |
| ----------------- | ---------------------------- | ---------- | -------------- |
| coordinator_loop  | Coordinator/builder loop     | 20         | 100            |
| remote_invocation | Remote invocation            | 15         | 100            |
| telegram_phase4   | Telegram thumbs (Phase 4)    | 20         | 60             |
| task_pickup       | Task pickup                  | 10         | 80             |
| deploy_gate       | Deploy gate                  | 10         | 100            |
| digital_twin      | Digital Twin Q&A interface   | 15         | 65             |
| improvement_loop  | 20% Better feedback loop     | 10         | 85             |
| attribution       | Attribution (branch naming)  | 5          | 0              |
| ollama_daytime    | Step 6.5 Ollama daytime tick | 5          | 10             |

> Weights sum to 110% in the current memory table (9 components × assigned
> weights). Renormalize to 100 before seeding. Suggested: drop two 5% components
> to 0 weight until they start shipping, or redistribute.

### Option B — `component_tag` JSONB on task_queue (not recommended)

Tag individual tasks with `metadata.harness_component = 'coordinator_loop'`
and derive completion from `completed / total` per component. Fragile: tasks
don't have uniform effort, and many harness milestones aren't tracked as
task_queue rows.

---

## Implementation plan (once schema exists)

### 1. `lib/harness/rollup.ts`

```typescript
export interface HarnessRollup {
  percent: number // weighted completion, 0–100
  components: ComponentRow[]
  delta_pct: number | null // vs. yesterday's logged value, null if no prior
}

export async function computeHarnessRollup(): Promise<HarnessRollup>
```

Query:

```sql
SELECT id, display_name, weight_pct, completion_pct
FROM harness_components
ORDER BY weight_pct DESC;
```

Rollup math:

```
percent = SUM(weight_pct * completion_pct / 100) / SUM(weight_pct) * 100
```

Day-over-day delta: read yesterday's `rollup_computed` event from
`agent_events` where `meta->>'rollup_pct'` is set, subtract.

### 2. Digest line (appended in `sendMorningDigest`)

```typescript
const rollupLine = await buildHarnessRollupLine()
messageToSend = `${messageToSend}\n${rollupLine}`
```

Returns `"Harness rollup: 83.8% (up from 78.2% yesterday)"` or
`"Harness rollup: unavailable (no harness_components rows)"`.

### 3. F18 event logging

After computing, insert to `agent_events`:

```typescript
{
  domain: 'harness',
  action: 'rollup_computed',
  actor: 'morning_digest',
  status: 'success',
  meta: { rollup_pct: percent, component_count: components.length }
}
```

This enables the day-over-day delta on the next digest run.

### 4. Acceptance tests

```
Mock harness_components with known rows → rollup matches expected math
Empty table → returns 0 with "no harness_components rows" message
All 100% completion → 100%
Day-over-day delta computed correctly from prior agent_events row
```

---

## Prerequisite checklist (before any code is written)

- [ ] Decide on weight normalization (must sum to 100%)
- [ ] Apply migration `0032_harness_components.sql`
- [ ] Seed table with current component values
- [ ] Verify weights sum to 100 via `SELECT SUM(weight_pct) FROM harness_components`
- [ ] Confirm `vercel.json` cron count unchanged (this is a function, not a new cron)

---

## What was NOT built (and why)

The feature was scoped but not implemented because the DB foundation is absent.
Building `computeHarnessRollup()` against a missing table would produce a
function that always returns the "no data" fallback — providing false confidence
that rollup tracking is live.

Once the migration is applied and seeded, the implementation in §"Implementation
plan" above is straightforward (~1h build, no schema uncertainty).
