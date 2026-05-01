-- Migration 0051: Enable RLS on harness-internal tables
-- Closes the remaining 6 ERROR-level rls_disabled_in_public findings on lepios
-- after migration 0050 (Gmail + window_sessions, 2026-04-29).
--
-- Tables (all confirmed harness-internal: no user_id column, no Colin PII):
--   - entity_attribution         (54 rows: harness action attribution log)
--   - task_feedback              (17 rows: F18 quality scoring feedback)
--   - streamlit_modules          (234 rows: Streamlit port catalog metadata)
--   - work_budget_sessions       (1 row: F19 work-budget telemetry)
--   - work_budget_keyword_weights(14 rows: F19 keyword -> minutes lookup)
--   - pending_drain_triggers     (0 rows: notification drain queue)
--
-- Access model:
--   service_role  -> full access (BYPASSRLS, no policy needed)
--   authenticated -> DENY (no user_id column to scope by)
--   anon          -> DENY (no public-facing reads)
--
-- All current readers use createServiceClient() (verified 2026-04-29):
--   - lib/attribution/writer.ts                  (entity_attribution)
--   - app/api/attribution/[entity_type]/[entity_id]/route.ts
--   - lib/harness/pickup-runner.ts               (task_feedback)
--   - lib/harness/stall-check.ts
--   - lib/work-budget/{tracker,parser,estimator,calibrator}.ts
--   - app/api/telegram/webhook/route.ts          (work_budget_sessions)
--   - app/api/harness/notifications-drain/route.ts (pending_drain_triggers)
--   - scripts/populate-streamlit-modules.ts      (uses SUPABASE_SERVICE_ROLE_KEY)
--   - scripts/generate-port-catalog.ts           (uses SUPABASE_SERVICE_ROLE_KEY)
--
-- Strategy: ENABLE RLS with no policies (matches harness_config / migration 0050
-- pattern). PostgREST returns empty arrays to anon/authenticated SELECT and
-- rejects writes; service_role continues to bypass RLS.

ALTER TABLE public.entity_attribution          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_feedback               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streamlit_modules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_budget_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_budget_keyword_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_drain_triggers      ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.entity_attribution IS
  'RLS enabled 2026-04-29 (migration 0051). No policies -- service_role only.';

COMMENT ON TABLE public.task_feedback IS
  'RLS enabled 2026-04-29 (migration 0051). No policies -- service_role only.';

COMMENT ON TABLE public.streamlit_modules IS
  'RLS enabled 2026-04-29 (migration 0051). No policies -- service_role only.';

COMMENT ON TABLE public.work_budget_sessions IS
  'RLS enabled 2026-04-29 (migration 0051). No policies -- service_role only.';

COMMENT ON TABLE public.work_budget_keyword_weights IS
  'RLS enabled 2026-04-29 (migration 0051). No policies -- service_role only.';

COMMENT ON TABLE public.pending_drain_triggers IS
  'RLS enabled 2026-04-29 (migration 0051). No policies -- service_role only.';
