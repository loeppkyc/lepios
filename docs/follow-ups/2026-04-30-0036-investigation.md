# 0036 migration collision — investigation result

Investigated: 2026-05-01
Status: **Benign. No action required on production. Disk cosmetics only.**

## Files on disk (main)

```
supabase/migrations/0036_amazon_settlements.sql
supabase/migrations/0036_register_tax_sanity_component.sql
```

## What each file does

**`0036_amazon_settlements.sql`** (PR #25, commit dd355bf)
- Creates `public.amazon_settlements` table (id, period_start/end, currency, net_payout,
  gross, fees_total, refunds_total, fund_transfer_status, raw_json, timestamps)
- 3 indexes: `period_end_at`, `fund_transfer_status`, `currency`
- Enables RLS + creates `amazon_settlements_authenticated` policy (authenticated role)
- Inserts `harness:amazon_settlements_sync` component into `harness_components` (ON CONFLICT DO NOTHING)
- Rollback: `DROP TABLE amazon_settlements`

**`0036_register_tax_sanity_component.sql`** (PR #22, commit 7f97409)
- Data-only migration: inserts `harness:tax_sanity` component into `harness_components`
  (weight 1, completion 100%, ON CONFLICT DO NOTHING)
- No DDL, no tables created

## Production state (queried 2026-05-01)

### Both migrations applied

Supabase tracks migrations by **full filename**, not the numeric prefix. Both are in
`supabase_migrations.schema_migrations`:

| version (timestamp) | name |
|---|---|
| 20260426231742 | 0036_register_tax_sanity_component |
| 20260427012352 | 0036_amazon_settlements |

`0036_register_tax_sanity_component` applied first (April 26), `0036_amazon_settlements`
applied second (April 27). Alphabetical sort order within the same prefix was not the
deciding factor — Supabase CLI applied them in the order they were pushed to the linked
project.

### `amazon_settlements` table: EXISTS ✓

Confirmed via `information_schema.tables`. The table is live and in active use by
`0057_amazon_financial_events.sql` (PR #43) which adds columns to it.

### `harness_components` inserts: rows NOT present

Neither `harness:amazon_settlements_sync` nor `harness:tax_sanity` appear in the
current `harness_components` table. The table was repurposed during Sprint 5 to track
autonomous harness infrastructure (coordinator, builder, digital twin, etc.). The 21 current
rows are all harness-infrastructure components. The original Amazon/tax component rows
from 0034–0036 era were cleared in that repurposing. This is a separate concern from
the collision — both inserts DID run at the time, they just aren't load-bearing now.

## Verdict

**The collision is benign.** Both files applied and are tracked independently. No "dead"
migration exists. A fresh clone would also apply both correctly because Supabase uses
full filename as the migration key.

## Risks going forward

1. **Confusion**: Two files sharing prefix `0036` looks wrong and could mislead a future
   developer doing a migration audit.
2. **Tooling drift**: If a future version of the Supabase CLI adds strict validation
   requiring unique numeric prefixes, both would fail validation. Currently no issue.
3. **Alphabetical sort scripts**: Any script that processes migrations by sorting filenames
   and treating the prefix as a unique key would silently drop one file.

## Proposed fix (low urgency, do before any fresh-environment provisioning)

1. Rename `0036_register_tax_sanity_component.sql` → `0036b_register_tax_sanity_component.sql`
   on disk only (git mv).
2. Production already has the original applied — the rename means a fresh clone will
   attempt to apply `0036b_register_tax_sanity_component` as a new migration. Since the
   insert uses `ON CONFLICT DO NOTHING`, this is idempotent and safe.
3. Do NOT run `supabase migration repair` or force-remove the old version from production
   unless specifically migrating a fresh environment.

**Prerequisite before renaming:** confirm no script or doc references the exact filename
`0036_register_tax_sanity_component.sql` by name.

```bash
grep -rn "0036_register_tax_sanity" . --include="*.ts" --include="*.md" --include="*.sql"
```

## Notes

- `0036_amazon_settlements.sql` should NOT be renumbered — it has a downstream dependency
  (`0057_amazon_financial_events.sql` adds columns to the table it creates).
- The `harness:tax_sanity` component and `harness:amazon_settlements_sync` component
  are not currently tracked in `harness_components`. If re-registering them becomes
  relevant, write a new migration to insert them (don't modify the 0036 files).
