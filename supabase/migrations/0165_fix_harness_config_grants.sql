-- 0165_fix_harness_config_grants.sql
--
-- ROOT CAUSE: Migration 0029_harness_config.sql contained a wrong comment:
--   "Service role bypasses RLS by default in Supabase -- no explicit policy needed."
-- This is TRUE for RLS row-level policies but FALSE for PostgreSQL-level GRANT privileges.
-- service_role bypasses RLS enforcement but still requires explicit GRANT for INSERT/UPDATE/DELETE.
-- Without these grants, every app-side write via createServiceClient() was silently denied
-- with "permission denied for table harness_config" (postgres log showed authenticator role).
--
-- AUDIT: All other tables were checked via the service_role grant audit query.
-- All other tables missing write grants (agent_actions, knowledge_dedupe_audit,
-- agent_capabilities, capability_registry, sandbox_runs, self_repair_runs) are
-- intentionally restricted per the AD7 append-only / read-only contract. See 0045, 0047, 0067.
-- harness_config is the only unintentional gap.
--
-- FIX: Grant write privileges to service_role on harness_config.
-- RLS remains enabled; anon + authenticated are still locked out (no RLS policies).

GRANT INSERT, UPDATE, DELETE ON public.harness_config TO service_role;

-- Correct the misleading table comment from migration 0029.
COMMENT ON TABLE public.harness_config IS
  'Runtime config store for autonomous harness agents (coordinator, builder, cron jobs). '
  'Reads: createServiceClient() (service_role has SELECT). '
  'Writes: createServiceClient() (service_role has INSERT, UPDATE, DELETE — granted by 0165). '
  'RLS: enabled, no policies — anon and authenticated roles have zero access. '
  'WARNING: service_role bypasses RLS policies but still requires explicit PostgreSQL GRANTs '
  'for write operations. Do not omit GRANT statements assuming RLS bypass equals full access.';

-- Verify grants landed correctly (runs at migration time; output visible in migration logs).
DO $$
DECLARE
  has_insert boolean;
  has_update boolean;
  has_delete boolean;
BEGIN
  SELECT has_table_privilege('service_role', 'public.harness_config', 'INSERT') INTO has_insert;
  SELECT has_table_privilege('service_role', 'public.harness_config', 'UPDATE') INTO has_update;
  SELECT has_table_privilege('service_role', 'public.harness_config', 'DELETE') INTO has_delete;

  IF NOT (has_insert AND has_update AND has_delete) THEN
    RAISE EXCEPTION 'Grant verification failed: service_role missing write privileges on harness_config';
  END IF;
END $$;
