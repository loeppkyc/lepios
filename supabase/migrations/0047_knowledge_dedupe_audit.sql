-- 0047_knowledge_dedupe_audit.sql
-- Append-only audit table for the knowledge_dedupe phase 2a cleanup.
--
-- Records one row per content-hash cluster collapsed by the dedupe job:
-- which row survives, which rows would be / were deleted, and the merged
-- provenance (source_events, times_used, times_helpful) carried forward
-- onto the kept row. Dry-run inserts populate this table without touching
-- the knowledge table; a follow-on phase 2a-execute reads from here to
-- perform the actual DELETE.
--
-- AD7 GRANT lockdown: service_role can SELECT + INSERT only.
-- No UPDATE, no DELETE. Audit rows are immutable post-write.
--
-- Spec context:
--   docs/harness/PENDING_ADDITIONS.md "### Implementation gaps"
--   audit 2026-04-28 (10,418 rows; 23 exact-content clusters; 75-row surface)
--   halt patch landed in commit 8e73d08 (lib/knowledge/patterns.ts)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. knowledge_dedupe_audit table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.knowledge_dedupe_audit (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID         NOT NULL,
  content_hash          TEXT         NOT NULL,
  kept_id               UUID         NOT NULL,
  collapsed_ids         UUID[]       NOT NULL,
  merged_source_events  UUID[],
  merged_times_used     INT,
  merged_times_helpful  INT,
  entity                TEXT,
  cluster_size          INT          NOT NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CHECK (cluster_size >= 2),
  CHECK (array_length(collapsed_ids, 1) = cluster_size - 1)
);

CREATE INDEX knowledge_dedupe_audit_run_idx
  ON public.knowledge_dedupe_audit (run_id, created_at);

CREATE INDEX knowledge_dedupe_audit_hash_idx
  ON public.knowledge_dedupe_audit (content_hash);

-- RLS: defense-in-depth. SELECT + INSERT for authenticated; no UPDATE/DELETE policies.
ALTER TABLE public.knowledge_dedupe_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "knowledge_dedupe_audit_insert" ON public.knowledge_dedupe_audit
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "knowledge_dedupe_audit_select" ON public.knowledge_dedupe_audit
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- AD7: GRANT-level append-only contract. Service_role gets NO exception.
REVOKE ALL ON public.knowledge_dedupe_audit FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT, INSERT ON public.knowledge_dedupe_audit TO authenticated, service_role;
-- No GRANT UPDATE. No GRANT DELETE. Postgres (migrations) keeps full access by default.

COMMENT ON TABLE public.knowledge_dedupe_audit IS
  'Append-only audit table for knowledge dedupe runs. One row per content-hash cluster '
  'that was collapsed: kept_id survives, collapsed_ids were/will be deleted, merged_* '
  'columns capture the provenance carried forward. AD7: service_role can SELECT + INSERT '
  'only — no UPDATE, no DELETE. Modifications require a postgres-role migration.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
-- After apply:
--   SELECT COUNT(*) FROM knowledge_dedupe_audit;          -- expect 0
--   SELECT has_table_privilege('service_role', 'public.knowledge_dedupe_audit', 'UPDATE');  -- expect false
--   SELECT has_table_privilege('service_role', 'public.knowledge_dedupe_audit', 'DELETE');  -- expect false
--   SELECT has_table_privilege('service_role', 'public.knowledge_dedupe_audit', 'INSERT');  -- expect true
--   SELECT has_table_privilege('service_role', 'public.knowledge_dedupe_audit', 'SELECT');  -- expect true
