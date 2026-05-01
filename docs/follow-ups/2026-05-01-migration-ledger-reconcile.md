# Follow-up: reconcile migration file prefixes with `supabase_migrations.schema_migrations`

**Logged:** 2026-05-01
**Owner:** unassigned
**Severity:** medium (will bite anyone running `supabase db push` or `supabase migration list`)

## What

Production prod (`xpanlbcjueimeofgsara`) has all schema artifacts from migrations
0041–0051 applied — verified by introspection of `pg_tables`, `pg_indexes`,
`pg_trigger`, `information_schema.columns`, and live row counts (e.g.,
`harness_components` shows 21 rows / SUM(weight_pct) = 100, the post-0043 shape).

But `supabase_migrations.schema_migrations` records only timestamp-versioned
entries (`20260427…` through `20260501…`), not the file-prefix names
(`0041_pending_drain_triggers`, etc.). The DDL was applied via direct
`apply_migration` MCP calls during the 2026-04-28 → 2026-05-01 window, which
stamps a fresh timestamp version each time and does NOT carry the file prefix
into the ledger.

## Why it matters

Anyone who:
- runs `supabase db push` against prod, or
- runs `supabase migration list` and tries to reconcile against
  `ls supabase/migrations/`, or
- spins up a fresh local DB from the repo migrations,

…will see a mismatch. `db push` would attempt to re-apply 0041–0051 because the
file prefixes aren't in the ledger. The first such re-apply (0043) would
`DELETE FROM public.harness_components` and wipe live `completion_pct` drift.

## What we know

- Schema state in prod matches the post-state of all 11 files exactly.
- `supabase_migrations.schema_migrations` HEAD timestamp: `20260501125617`.
- File prefixes 0041, 0043–0051 are present on `main` HEAD `4208b81` but the
  ledger does not record them by name.

## Options

1. **Backfill the ledger by name.** Insert rows into
   `supabase_migrations.schema_migrations` with file-derived versions
   (e.g., `0041_pending_drain_triggers`) so future `supabase migration list`
   shows alignment. Risk: changes the ledger format if the rest of the table
   uses timestamps; mixed format may confuse the CLI.
2. **Mark the file prefixes as applied via `supabase migration repair`.**
   Standard CLI path for this exact situation. Run once per file with
   `--status applied`. Preferred.
3. **Convert files to timestamp prefixes going forward only.** Leaves
   0041–0051 as orphans in the ledger but stops the bleed.

## Recommendation

Option 2 — `supabase migration repair --status applied <version>` for each of
0041, 0043, 0044, 0045, 0046, 0047, 0048, 0049, 0050, 0051. Confirm via
`supabase migration list` that the ledger and `supabase/migrations/` reconcile.
Run this from a workstation with the prod DB password, not from CI.

## How not to repeat this

Standardise on one of:
- `supabase migration up` (file-prefixed, ledger uses file name), OR
- `apply_migration` MCP (timestamp-versioned, treat repo files as documentation
  and don't expect `supabase db push` to work).

Mixing the two is what caused this drift. Pick one and document it in
`CLAUDE.md §8` next to the Supabase MCP table.

## Verification queries used

```sql
-- Did the schema-level changes from each file actually land?
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='pending_drain_triggers') AS m0041,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='product_components')   AS m0043,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='decisions_log')        AS m0044,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='agent_actions')        AS m0045_aa,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='capability_registry')  AS m0045_cr,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='agent_capabilities')   AS m0045_ac,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='decisions_log_updated_at')                       AS m0046,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='knowledge_dedupe_audit') AS m0047,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name='knowledge_dedupe_audit' AND column_name='executed_at')                AS m0048,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name='knowledge' AND column_name='content_hash')                            AS m0049,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_knowledge_content_hash_entity')           AS m0049_idx;
-- Result 2026-05-01: all true.

-- 0047 dry-run cohort confirmed: 23 clusters / 75 collapsed_ids / 23 executed.
SELECT COUNT(DISTINCT content_hash)              AS clusters,
       SUM(array_length(collapsed_ids, 1))       AS collapsed_ids_total,
       COUNT(*) FILTER (WHERE executed_at IS NOT NULL) AS executed_rows
FROM public.knowledge_dedupe_audit
WHERE run_id = 'ea56aabb-f7f5-4272-96c6-dbb5671d7d79';

-- Live harness rollup post-0043:
SELECT ROUND(SUM(weight_pct * completion_pct) / NULLIF(SUM(weight_pct), 0), 2) AS rollup_pct,
       SUM(weight_pct) AS total_weight
FROM public.harness_components;
-- Result: 58.38% on a 100 denominator.
```
