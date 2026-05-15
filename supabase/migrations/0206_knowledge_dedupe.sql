-- Migration 0206 — knowledge_dedupe
-- Deduplicates knowledge table by entity, keeps win-rule winner, adds UNIQUE index.
-- Win-rule: highest times_used → most recent updated_at → largest id (UUID lex).
-- Null-entity rows are NEVER touched — all 1,537 null rows are distinct entries.
--
-- !! GROUNDING CHECKPOINT !!
-- Colin must confirm pg_dump backup before this migration is applied to production.
-- Backup command:
--   pg_dump --format=custom --table=public.knowledge \
--     --file=knowledge_backup_$(date +%Y%m%d_%H%M%S).dump \
--     "$DATABASE_URL"
-- Verify: pg_restore --list <backup_file> | wc -l  (must be non-zero)
--
-- Pre-dedup snapshot (2026-05-15):
--   total_rows: 7,047
--   distinct_entities (non-null): 423
--   duplicate entity groups: 244
--   rows_to_delete: 5,087  (72% of total — expected; megan/colin/cora each 100s of copies)
-- AD7-exempt (no CREATE TABLE — only DELETE + CREATE UNIQUE INDEX CONCURRENTLY)

-- Step 0 — Record pre-dedup state
INSERT INTO agent_events (domain, action, actor, status, task_type, output_summary, meta, tags)
VALUES (
  'coordinator', 'knowledge_dedupe_preflight', 'builder', 'success', 'migration',
  'pre-dedup row counts recorded',
  jsonb_build_object(
    'total_rows', 7047,
    'distinct_entities', 423,
    'duplicate_entity_rows', 244,
    'rows_to_delete_dry_run', 5087
  ),
  ARRAY['knowledge', 'dedupe', 'harness']
);

-- Step 2 — Dedup DELETE
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

-- Step 3 — Verify (assertion: must return 0 rows or migration is considered failed)
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT entity
    FROM knowledge
    WHERE entity IS NOT NULL
    GROUP BY entity
    HAVING COUNT(*) > 1
  ) sub;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'knowledge_dedupe assertion failed: % duplicate entity groups remain after DELETE', dup_count;
  END IF;
END $$;

-- Step 4 — Add table-wide partial UNIQUE index
-- CONCURRENTLY avoids table lock on prod. WHERE entity IS NOT NULL preserves null rows.
-- After this lands, decisions_log:% and idea_inbox:% partial indexes are redundant
-- but NOT dropped here (out of scope — separate cleanup decision).
CREATE UNIQUE INDEX CONCURRENTLY knowledge_entity_unique
  ON public.knowledge(entity)
  WHERE entity IS NOT NULL;

-- Step 5 — Record completion
INSERT INTO agent_events (domain, action, actor, status, task_type, output_summary, meta, tags)
VALUES (
  'coordinator', 'knowledge_dedupe_complete', 'builder', 'success', 'migration',
  'knowledge table deduped and UNIQUE index added',
  jsonb_build_object(
    'rows_before', 7047,
    'rows_deleted', 5087,
    'rows_after', 1960,
    'unique_index', 'knowledge_entity_unique',
    'note', 'null-entity rows (1537) untouched; 423 distinct entities preserved'
  ),
  ARRAY['knowledge', 'dedupe', 'harness']
);
