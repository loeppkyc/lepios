-- Migration 0201: agent_events hardening
--
-- ROOT CAUSE: Migration 0005 created a broad RLS policy allowing all authenticated users
-- to read/write all agent_events. This leaks sensitive financial data (from QBO/Amazon syncs)
-- that is logged to this table.
--
-- FIX: Drop the broad policy. Lockdown agent_events to service_role access only.
-- All LepiOS backend agents and API routes use createServiceClient() which bypasses RLS.
-- No permissive policies are required for the standard autonomous operation.

DROP POLICY IF EXISTS "agent_events_authenticated" ON public.agent_events;

-- Ensure RLS is enabled (it was enabled in 0005, but we reinforce it here).
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;

-- Grant INSERT, UPDATE, DELETE to service_role to maintain compatibility with 
-- non-migration writes from background agents.
GRANT INSERT, UPDATE, DELETE ON public.agent_events TO service_role;

COMMENT ON TABLE public.agent_events IS 
  'Structured activity log for autonomous agents. Hardened in 0201: locked to service_role only. '
  'Contains behavioral ingestion data including financial summaries — must remain RLS-locked.';
