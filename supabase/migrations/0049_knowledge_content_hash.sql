-- 0049_knowledge_content_hash.sql
-- Phase 2b — structural prevention of duplicate knowledge ingestion.
--
-- Schema additions:
--   1. knowledge.content_hash — STORED generated md5 over the four content
--      fields (title, problem, solution, context). NULLs coalesced to '' so
--      the hash is always non-NULL. The same expression is computed on the
--      client side in saveKnowledge() before lookup; the two MUST stay in
--      lockstep.
--   2. UNIQUE INDEX on (content_hash, coalesce(entity, '')) — enforces "one
--      row per unique content + entity scope." NULL-safe via coalesce so
--      NULL-entity rows participate in uniqueness too (19 of 23 dedup'd
--      clusters in phase 2a had NULL entity).
--
-- Defense-in-depth ordering:
--   * Halt patch (>= 0.3) at lib/knowledge/patterns.ts:413 — first line.
--   * saveKnowledge same-entity hash guard (this migration's companion code
--     change) — looks up by (content_hash, entity) and reinforces on hit.
--   * UNIQUE INDEX (this migration) — DB-level final backstop. A racing
--     INSERT that bypasses the application guard will fail with
--     constraint violation (Postgres error code 23505) instead of
--     silently creating a duplicate.
--
-- Pre-apply state: 10,343 unique rows after phase 2a-execute (migration
-- 0048). Verified post-execute that GROUP BY (md5_hash, entity) yields zero
-- clusters with COUNT > 1. The unique index creation will not fail on
-- existing data.
--
-- Spec context:
--   audit 2026-04-28 (10,418 rows pre-cleanup; 23 exact-content clusters)
--   halt patch landed in 8e73d08
--   phase 2a-execute landed in db80b93 (run_id ea56aabb-f7f5-4272-96c6-dbb5671d7d79)
--   docs/harness/PENDING_ADDITIONS.md "Implementation gaps"

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Generated content_hash column
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.knowledge
  ADD COLUMN content_hash text GENERATED ALWAYS AS (
    md5(
      coalesce(title, '') || '||' ||
      coalesce(problem, '') || '||' ||
      coalesce(solution, '') || '||' ||
      coalesce(context, '')
    )
  ) STORED;

COMMENT ON COLUMN public.knowledge.content_hash IS
  'Deterministic md5 of the four content fields (title || problem || solution || '
  'context, with NULLs coalesced to empty string and ''||'' separator). STORED '
  'generated column — Postgres maintains it on every INSERT/UPDATE. The expression '
  'must be kept in lockstep with the client-side computation in saveKnowledge().';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Unique index on (content_hash, entity-with-null-as-empty)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX idx_knowledge_content_hash_entity
  ON public.knowledge (content_hash, coalesce(entity, ''))
  WHERE content_hash IS NOT NULL;

COMMENT ON INDEX public.idx_knowledge_content_hash_entity IS
  'DB-level dedup enforcement. (content_hash, coalesce(entity, '''')) must be '
  'unique across the table. WHERE content_hash IS NOT NULL is technically '
  'redundant (the generated column is never NULL by construction) but kept '
  'as documentation of the intent.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify (post-apply)
-- ─────────────────────────────────────────────────────────────────────────────
--   SELECT COUNT(*) FROM knowledge WHERE content_hash IS NULL;        -- expect 0
--   SELECT COUNT(*) FROM knowledge;                                    -- expect 10343 (unchanged from phase 2a)
--   SELECT indexname FROM pg_indexes
--     WHERE indexname = 'idx_knowledge_content_hash_entity';           -- expect 1 row
--   -- Round-trip uniqueness check:
--   SELECT content_hash, coalesce(entity,'') AS e, COUNT(*)
--   FROM knowledge
--   GROUP BY content_hash, coalesce(entity, '')
--   HAVING COUNT(*) > 1;                                               -- expect 0 rows
