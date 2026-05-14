# Acceptance Doc — knowledge_dedupe

**Status:** awaiting-colin-approval
**Task ID:** 94748a6f-a64c-4b4d-b64b-8d9a78bff7d8
**Written:** 2026-05-14
**Author:** coordinator
**Spec reference:** `docs/harness/MEMORY_LAYER_SPEC.md` §M3 Redline (2026-04-28)

---

## What (plain English)

The `knowledge` table has accumulated duplicate rows for the same `entity` value — same-named thing, multiple rows. The worst offenders (e.g. `megan`, `Colin Loeppky`, `colin`, `cora`) each have hundreds of copies. This blocks us from adding a table-wide `UNIQUE` constraint on `entity`, which is required for the `idea_inbox` and `decisions_log` mirror triggers to work correctly.

This chunk defines the win-rule, builds a dedup script, runs it with a backup safety net, and then adds a table-wide `UNIQUE` index — finishing what the MEMORY_LAYER_SPEC §M3 partial-index redline deferred.

---

## Data snapshot (pre-dedup, grounded 2026-05-14)

From live Supabase project `xpanlbcjueimeofgsara`:

**Schema:**

| Column             | Type                 |
| ------------------ | -------------------- |
| id                 | uuid                 |
| created_at         | timestamptz          |
| updated_at         | timestamptz          |
| category           | text                 |
| domain             | text                 |
| entity             | text                 |
| title              | text                 |
| problem            | text                 |
| solution / context | text                 |
| confidence         | real                 |
| times_used         | integer              |
| times_helpful      | integer              |
| last_used_at       | timestamptz          |
| source_events      | jsonb                |
| tags               | jsonb                |
| embedding_id       | text                 |
| fts                | tsvector (generated) |
| embedding          | vector               |
| content_hash       | text                 |

**Top duplicate entities (query run 2026-05-14):**

| entity                        | row count |
| ----------------------------- | --------- |
| NULL                          | 1,537     |
| megan                         | 1,179     |
| Colin Loeppky                 | 765       |
| colin                         | 504       |
| cora                          | 259       |
| parents                       | 173       |
| Janice Jones                  | 130       |
| Heath Shoup                   | 88        |
| pages/tax_centre/colin_tax.py | 79        |
| Jones Cosman                  | 74        |
| Business_Review.py            | 45        |
| pages/21_PageProfit.py        | 45        |
| Heath                         | 41        |
| utils/auth.py                 | 41        |
| utils/amazon.py               | 40        |

Spec context (MEMORY_LAYER_SPEC §M3 redline): "~270 duplicate non-null `entity` values" in total.

**Existing indices relevant to this work:**

| Index                                   | Type                                                                           | Notes                           |
| --------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| `knowledge_pkey`                        | UNIQUE btree(id)                                                               | PK — safe                       |
| `knowledge_decisions_log_entity_unique` | UNIQUE btree(entity) WHERE entity LIKE 'decisions_log:%'                       | Partial — already enforced      |
| `knowledge_idea_inbox_entity_unique`    | UNIQUE btree(entity) WHERE entity LIKE 'idea_inbox:%'                          | Partial — already enforced      |
| `idx_knowledge_content_hash_entity`     | UNIQUE btree(content_hash, COALESCE(entity,'')) WHERE content_hash IS NOT NULL | Partial — already enforced      |
| `knowledge_embedding_idx`               | ivfflat(embedding)                                                             | Must rebuild after mass deletes |

---

## Win-rule (from MEMORY_LAYER_SPEC §M3 redline)

For each duplicated non-null `entity` value, keep the **one row** that wins by:

1. **Highest `times_used`** — the row that has been retrieved most is the most valuable.
2. **Tiebreaker: most recent `updated_at`** — if `times_used` is equal, keep the freshest version.
3. **Final tiebreaker: largest `id` (UUID lexicographic)** — deterministic, avoids arbitrary deletion.

Delete all other rows for that entity.

**Null-entity rows are excluded from dedup entirely.** All 1,537 null-entity rows are distinct knowledge entries that happen to have no entity tag — they must not be deleted. The dedup WHERE clause must include `WHERE entity IS NOT NULL`.

**`decisions_log:%` and `idea_inbox:%` prefixed rows** already have partial unique indexes enforcing uniqueness. Verify no violations exist before running but do not re-process them in the main dedup loop.

---

## Scope

**In scope:**

- PostgreSQL migration script that:
  1. Takes a `pg_dump` backup of the `knowledge` table (documented command, not automated)
  2. Records pre-dedup row count in `agent_events`
  3. Runs the win-rule DELETE for all non-null duplicate entities
  4. Records post-dedup row count in `agent_events`
  5. Verifies zero duplicates remain (assertion query)
  6. Adds `CREATE UNIQUE INDEX CONCURRENTLY knowledge_entity_unique ON knowledge(entity) WHERE entity IS NOT NULL` if assertion passes
  7. Records completion event in `agent_events`

**Out of scope:**

- Changing the `knowledge` table schema (no column adds, drops, or type changes)
- Touching any table other than `knowledge`
- Merging/combining duplicate rows' content (no value aggregation — delete losing rows cleanly)
- Rebuilding the `knowledge_embedding_idx` (expensive; leave for scheduled VACUUM/ANALYZE)
- Null-entity dedup (out of scope — separate decision needed on what those rows represent)
- UI changes

---

## GitHub prior art check (Check-Before-Build)

Standard Postgres dedup patterns:

- `DELETE ... WHERE id NOT IN (SELECT id FROM ... WHERE ROW_NUMBER() OVER (PARTITION BY entity ORDER BY times_used DESC, updated_at DESC, id DESC) = 1)` — battle-tested pattern, no library needed.
- `CREATE UNIQUE INDEX CONCURRENTLY` — standard Postgres command, no lock required; safe on prod.
- No external library needed. This is pure SQL + `pg_dump`.

Existing repo scripts checked:

- `scripts/` directory has no existing dedup utilities.
- `supabase/migrations/` — no prior migration handles knowledge dedup. Migration 0044 deferred it explicitly.

---

## Builder instructions (precise)

### Step 0 — Record pre-dedup state

```sql
-- Run and note the output in the commit message / handoff
SELECT COUNT(*) AS total_rows FROM knowledge;
SELECT COUNT(DISTINCT entity) AS distinct_entities FROM knowledge WHERE entity IS NOT NULL;
SELECT COUNT(*) AS duplicate_entity_rows
FROM (SELECT entity FROM knowledge WHERE entity IS NOT NULL GROUP BY entity HAVING COUNT(*) > 1) sub;
```

Insert agent_events row:

```sql
INSERT INTO agent_events (domain, action, actor, status, task_type, output_summary, meta, tags)
VALUES (
  'coordinator', 'knowledge_dedupe_preflight', 'builder', 'success', 'migration',
  'pre-dedup row counts recorded',
  jsonb_build_object('total_rows', <N>, 'distinct_entities', <N>, 'duplicate_entity_rows', <N>),
  ARRAY['knowledge','dedupe','harness']
);
```

### Step 1 — pg_dump backup (Colin runs manually before builder proceeds)

```bash
pg_dump \
  --format=custom \
  --table=public.knowledge \
  --file=knowledge_backup_$(date +%Y%m%d_%H%M%S).dump \
  "$DATABASE_URL"
```

> **Colin must confirm backup completed and note file size before builder proceeds to Step 2.**
> This is the grounding checkpoint (see below).

### Step 2 — Dedup DELETE (exact logic)

```sql
-- Delete all losing rows for each duplicate non-null entity.
-- Keep: highest times_used, then most recent updated_at, then largest id (UUID lex).
DELETE FROM knowledge
WHERE id NOT IN (
  SELECT DISTINCT ON (entity) id
  FROM knowledge
  WHERE entity IS NOT NULL
  ORDER BY entity, times_used DESC, updated_at DESC, id DESC
)
AND entity IS NOT NULL;
```

> **Dry-run first:** wrap in `BEGIN; ... ROLLBACK;` and check `DELETE` count matches
> `duplicate_entity_rows` from Step 0 minus the surviving rows. The number deleted should be
> approximately `SUM(cnt - 1)` across all duplicated entities.

### Step 3 — Verify

```sql
-- Acceptance criterion — must return 0
SELECT COUNT(*) FROM (
  SELECT entity FROM knowledge
  WHERE entity IS NOT NULL
  GROUP BY entity
  HAVING COUNT(*) > 1
) sub;

-- Also verify row count is reasonable (total_rows minus rows_deleted)
SELECT COUNT(*) AS post_dedup_total FROM knowledge;
```

If the first query returns any non-zero value: **abort. Do not add the UNIQUE index. Escalate to Colin.**

### Step 4 — Add table-wide partial UNIQUE index (only if Step 3 passes)

```sql
-- CONCURRENTLY avoids table lock. WHERE entity IS NOT NULL preserves null-entity rows.
CREATE UNIQUE INDEX CONCURRENTLY knowledge_entity_unique
  ON public.knowledge(entity)
  WHERE entity IS NOT NULL;
```

> Note: this index name differs from the existing partial-scope indexes.
> After this lands, the `decisions_log:%` and `idea_inbox:%` partial indexes are redundant
> but NOT dropped in this chunk (out of scope — separate cleanup decision).

### Step 5 — Record completion

```sql
INSERT INTO agent_events (domain, action, actor, status, task_type, output_summary, meta, tags)
VALUES (
  'coordinator', 'knowledge_dedupe_complete', 'builder', 'success', 'migration',
  'knowledge table deduped and UNIQUE index added',
  jsonb_build_object(
    'rows_before', <pre_dedup_total>,
    'rows_after', <post_dedup_total>,
    'rows_deleted', <rows_before - rows_after>,
    'unique_index', 'knowledge_entity_unique'
  ),
  ARRAY['knowledge','dedupe','harness']
);
```

### Migration file

Write this as `supabase/migrations/<next_number>_knowledge_dedupe.sql`. Claim the next migration number via `node scripts/next-migration-number.mjs`.

**Do NOT use `apply_migration` until Colin has confirmed the pg_dump backup.**

---

## Acceptance criterion

```sql
-- Must return 0 after the migration runs
SELECT COUNT(*)
FROM (
  SELECT entity
  FROM knowledge
  WHERE entity IS NOT NULL
  GROUP BY entity
  HAVING COUNT(*) > 1
) sub;
```

**Secondary:** `SELECT indexname FROM pg_indexes WHERE tablename='knowledge' AND indexname='knowledge_entity_unique'` returns one row.

---

## Risk flags

| Risk                                                 | Severity | Mitigation                                                                                                                  |
| ---------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Irreversible data deletion**                       | HIGH     | `pg_dump` backup required before any DELETE runs. Colin confirms backup before builder proceeds.                            |
| **Win-rule ambiguity**                               | MEDIUM   | Tie-breaker chain (`times_used DESC → updated_at DESC → id DESC`) is deterministic. No ties possible.                       |
| **Null-entity mass delete**                          | HIGH     | WHERE clause explicitly scoped to `entity IS NOT NULL`. Null rows are never touched.                                        |
| **`decisions_log:%` / `idea_inbox:%` rows affected** | LOW      | Partial unique indexes already enforce uniqueness on these prefixes. Verify with assertion before DELETE.                   |
| **`CREATE UNIQUE INDEX CONCURRENTLY` fails mid-run** | MEDIUM   | If it fails (constraint violation found), Step 3 already caught it — means the DELETE missed something. Abort and escalate. |
| **Embedding index fragmentation**                    | LOW      | Mass DELETEs will fragment `knowledge_embedding_idx` (ivfflat). Plan a `REINDEX` or `VACUUM ANALYZE` after, separately.     |

---

## Grounding checkpoint

**Colin must perform before builder runs the DELETE:**

1. Confirm `pg_dump` backup completed:
   - `pg_restore --list knowledge_backup_<timestamp>.dump | wc -l` returns a non-zero count.
   - Note the backup file size.
2. Review the dry-run output: confirm DELETE count is plausible (not suspiciously large).
3. After DELETE runs: eyeball post-dedup total row count. Spot-check 2–3 entities (e.g. `megan`, `colin`) now have exactly 1 row each.

---

## Kill signals

- Dry-run DELETE count is unexpectedly large (e.g. >95% of all rows deleted).
- `decisions_log:%` or `idea_inbox:%` rows appear in the duplicate-entity query (would mean existing partial indexes are broken — escalate before touching anything).
- pg_dump fails (disk space, auth, connection issue) — do not proceed.

---

## Cached-principle decisions

- Win-rule sourced verbatim from MEMORY_LAYER_SPEC §M3 redline (Colin-authored). No interpretation needed.
- `WHERE entity IS NOT NULL` exclusion: null rows have no entity to dedupe on; this is the correct and obvious scope boundary. Cached as reversible (scope can expand later if null-dedup is needed).
- `CREATE UNIQUE INDEX CONCURRENTLY` vs ALTER TABLE ADD CONSTRAINT: CONCURRENTLY avoids table lock on a prod table. Standard safe choice. Reversible with `DROP INDEX`.

**Confidence: high.** All decisions match existing Colin-authored spec or standard-safe Postgres practice.

---

## Open questions

None. Win-rule, scope, and safety constraints are fully specified in MEMORY_LAYER_SPEC §M3 redline.
