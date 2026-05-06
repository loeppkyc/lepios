-- 0127_revoke_security_definer_from_public.sql
--
-- Companion to 0126. The earlier REVOKE FROM anon, authenticated did not close
-- the SECURITY DEFINER WARN findings because Supabase grants EXECUTE to PUBLIC
-- by default, and anon/authenticated inherit from PUBLIC. Revoking from PUBLIC
-- closes the inheritance loop.
--
-- service_role bypasses GRANT/REVOKE entirely, so server callers (all of which
-- use createServiceClient() — verified 2026-05-06 grep) keep EXECUTE access.

REVOKE EXECUTE ON FUNCTION public.claim_next_task(text)
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.knowledge_decay_stale(timestamp with time zone)
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.knowledge_mark_used(uuid, boolean)
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.rebuild_knowledge_ivfflat_index()
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.reclaim_stale_tasks()
  FROM PUBLIC;
