# Resource Budget Tracker (P5-4)

> One registry for "am I close to a limit?" so silent contention surfaces before it bites. Companion to migration 0159 (`harness_resource_budgets`) and `scripts/check-budgets.mjs`.

## Why this exists

Three incidents in two months had the same root cause: a hard ceiling reached without warning.

- **F-L11 / F-N9** — Vercel Hobby silently rejected `vercel.json` past 18 crons. No deploy record was created; main was undeployable for ~12 hours before someone noticed. Fix: hard-coded ceiling check in `scripts/check-vercel-cron-count.mjs`.
- **F-L7** — coordinator routine quota exhausted mid-day. ~4 hours of agent lockout, three pre-staged tasks idle. No warning before the cliff.
- (Anticipated) Vercel env var ceiling, Supabase RLS policy explosion per table — same shape, no guard yet.

The cron-count guard worked. The pattern generalizes: every external resource has a ceiling; we'd rather hit a tripwire at 85% than a silent rejection at 100%.

## What's in v1

A central registry (`harness_resource_budgets` table, seeded by migration 0159) that lists every resource Colin cares about, its ceiling, and where the count comes from. A pre-commit hook (`scripts/check-budgets.mjs`) evaluates **file-resident** budgets and aborts the commit if any exceed the ceiling.

| Key                  | Max | Source         | Category | How counted                                   | Status                                       |
| -------------------- | --- | -------------- | -------- | --------------------------------------------- | -------------------------------------------- |
| `vercel.crons`       | 18  | `vercel.json`  | platform | length of `crons` array                       | Pre-commit gate ✅                           |
| `package.deps_total` | 300 | `package.json` | code     | `dependencies` + `devDependencies` key counts | Pre-commit gate ✅                           |
| `vercel.env_vars`    | 100 | Vercel API     | platform | (sync job — not yet shipped)                  | Registered in DB, refreshed by future job ⏳ |

The cron-count gate (`scripts/check-vercel-cron-count.mjs`) covers the same ceiling separately and also enforces sub-hourly cadence — `check-budgets.mjs` only mirrors the count check so the registry is the canonical source for "what budgets exist."

## How the gate behaves

- Touches `vercel.json` or `package.json` in a commit, ≥85% of any ceiling → printed warning, commit proceeds.
- Touches a budgeted file and would push over the ceiling → commit blocks with the offending key, current/max, and source.
- Doesn't touch a budgeted file → script exits 0 immediately. Zero overhead on every commit.

Bypass once: `BUDGETS_CHECK_BYPASS=1 git commit ...`. Use only when intentionally raising a ceiling (and edit the registry + migration in the same commit).

## How to add a new budget

1. **File-resident (gate-checkable):**
   - Add a row to migration 015X (or a follow-up) in `supabase/migrations/`.
   - Append a `BUDGETS` entry in `scripts/check-budgets.mjs` with a matching `evaluator` function name.
   - Add the evaluator to `EVALUATORS` map.
   - Add a test case in `tests/scripts/check-budgets.test.ts`.

2. **Externally-synced (DB-only, surfaced via digest):**
   - Add a row to a new migration with `source` = `external:<provider>_api`.
   - Wire the count refresh into `scripts/sync-resource-budgets.mjs` (future) — runs daily, hits the provider, writes `current_count` + `last_checked`.
   - The pre-commit gate skips it; morning_digest reads from the table.

## Status semantics

The DB row's `current_count` + `max_count` columns are the authority. `status` is computed at read time:

```sql
SELECT
  key, current_count, max_count, source,
  CASE
    WHEN current_count >= max_count            THEN 'at_limit'
    WHEN current_count >= max_count * 0.85     THEN 'warning'
    ELSE 'ok'
  END AS status
FROM harness_resource_budgets
ORDER BY (current_count::float / max_count) DESC;
```

The pre-commit gate uses the same thresholds in JS for consistency.

## Future work

- **Sync job** (`scripts/sync-resource-budgets.mjs`) — daily cron that hits Vercel API for env var count + Supabase `pg_policies` for RLS policy density per table, writes back to the table. Without this, externally-sourced rows stay at `current_count = 0`.
- **Morning digest line** — surface any `warning` or `at_limit` rows in the daily digest so Colin sees ceilings approaching even when no commit touches the gate.
- **Per-table RLS policy budget** — once the sync job lands, expand the registry with `db.rls_policies.<table>` keys for high-policy-count tables.

Tracked in the sprint-6 backlog as P5-4. The framework's foundation ships in this PR; expansion is incremental.
