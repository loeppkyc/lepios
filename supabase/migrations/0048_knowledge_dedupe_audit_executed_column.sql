-- 0048_knowledge_dedupe_audit_executed_column.sql
-- Phase 2a-execute of the knowledge_dedupe project.
--
-- Schema change:
--   * knowledge_dedupe_audit gains an executed_at TIMESTAMPTZ column to mark
--     when each cluster's collapse was applied to the live knowledge table.
--
-- Data operations (one-time, scoped to dry-run run_id from migration 0047):
--   1. UPDATE 23 kept rows in knowledge with merged provenance from the audit.
--      For 4 burndown clusters with non-null merged_source_events: overwrite
--      knowledge.source_events with to_jsonb(merged_source_events). For the
--      other 19 (NULL provenance): leave source_events untouched.
--   2. DELETE 75 collapsed_ids from knowledge.
--   3. UPDATE 23 knowledge_dedupe_audit rows with executed_at = now().
--
-- Migration runs in a single transaction (apply_migration semantics): any
-- failure rolls back the schema change AND all data ops; knowledge stays at
-- its 10,418-row pre-execute state.
--
-- AD7 note: knowledge_dedupe_audit's GRANT lockdown (REVOKE UPDATE/DELETE
-- from service_role) is unaffected. The UPDATE in step 3 runs as the
-- postgres role via apply_migration, which bypasses GRANT — no column-level
-- service_role grant is added because no runtime job is expected to mark
-- audit rows; future runtime markers can add a column-level GRANT then.
--
-- Spec context:
--   audit 2026-04-28 (10,418 rows; 23 exact-content clusters; 75-row surface)
--   halt patch landed in 8e73d08 (lib/knowledge/patterns.ts)
--   dry-run audit set: run_id 'ea56aabb-f7f5-4272-96c6-dbb5671d7d79' (migration 0047)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Schema: add executed_at column
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.knowledge_dedupe_audit
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.knowledge_dedupe_audit.executed_at IS
  'Set by phase 2a-execute when the cluster collapse is applied to the live '
  'knowledge table. NULL = dry-run only, not yet executed.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Data: apply the dry-run plan to knowledge
-- ─────────────────────────────────────────────────────────────────────────────

-- 2a. Merge provenance + counters onto kept rows.
--   For the 4 burndown clusters: source_events is overwritten with the merged
--   set (which already includes the kept row's own source_events — see dry-run
--   semantics). For the 19 personal_correspondence clusters: merged_source_events
--   is NULL and the CASE keeps the existing knowledge.source_events untouched.
UPDATE public.knowledge k
SET
  source_events = CASE
    WHEN a.merged_source_events IS NOT NULL
      THEN to_jsonb(a.merged_source_events)
    ELSE k.source_events
  END,
  times_used    = a.merged_times_used,
  times_helpful = a.merged_times_helpful,
  updated_at    = now()
FROM public.knowledge_dedupe_audit a
WHERE k.id = a.kept_id
  AND a.run_id = 'ea56aabb-f7f5-4272-96c6-dbb5671d7d79';

-- 2b. Delete the 75 collapsed rows.
DELETE FROM public.knowledge
WHERE id IN (
  SELECT unnest(collapsed_ids)
  FROM public.knowledge_dedupe_audit
  WHERE run_id = 'ea56aabb-f7f5-4272-96c6-dbb5671d7d79'
);

-- 3. Stamp the audit rows.
UPDATE public.knowledge_dedupe_audit
SET executed_at = now()
WHERE run_id = 'ea56aabb-f7f5-4272-96c6-dbb5671d7d79';

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify (post-apply)
-- ─────────────────────────────────────────────────────────────────────────────
-- Run separately after apply:
--   SELECT COUNT(*) FROM knowledge;                                    -- expect 10343
--   SELECT COUNT(*) FROM knowledge
--     WHERE jsonb_array_length(source_events) >= 31;                   -- expect >= 1
--   SELECT COUNT(*) FROM knowledge_dedupe_audit
--     WHERE run_id = 'ea56aabb-f7f5-4272-96c6-dbb5671d7d79'
--       AND executed_at IS NOT NULL;                                   -- expect 23
--   WITH h AS (
--     SELECT md5(coalesce(title,'')||'||'||coalesce(problem,'')||'||'||
--                coalesce(solution,'')||'||'||coalesce(context,'')) AS hh
--     FROM knowledge
--   )
--   SELECT hh, COUNT(*) FROM h GROUP BY hh HAVING COUNT(*) > 1;        -- expect 0 rows
