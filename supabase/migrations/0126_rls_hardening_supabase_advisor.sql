-- 0126_rls_hardening_supabase_advisor.sql
--
-- Triggered by Supabase advisor email 2026-05-06 ("Action required: security
-- vulnerabilities detected in your projects"). Closes 3 classes of finding:
--
--   1. ERROR rls_disabled_in_public (8 tables) — direct PostgREST exposure.
--      Anyone with the published anon key could read these rows. Companion
--      to F-N5 (today's API-route auth fix); F-N5 closed the route surface,
--      this closes the direct table surface.
--
--   2. ERROR security_definer_view (v_trial_balance) — view runs with
--      creator's permissions instead of caller's. Switch to security_invoker.
--
--   3. WARN anon_security_definer_function_executable (5 functions) — anon
--      and authenticated roles can call internal maintenance RPCs. All 5
--      are called via createServiceClient() in lib/{knowledge,harness}/*
--      (verified 2026-05-06 grep), so service_role keeps EXECUTE while we
--      revoke from anon + authenticated.
--
-- Pattern: matches knowledge_authenticated policy (migration 0011). Server
-- routes that use createServiceClient() bypass RLS; the policy gates the
-- direct PostgREST surface that the anon/authenticated client would use.

-- ── 1. RLS enable + authenticated-only policy on 8 ERROR-level tables ───────

ALTER TABLE public.chart_of_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_imports          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_rules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gst_hst_filings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.self_repair_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chart_of_accounts_authenticated" ON public.chart_of_accounts
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "journal_entries_authenticated" ON public.journal_entries
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "journal_entry_lines_authenticated" ON public.journal_entry_lines
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "bank_imports_authenticated" ON public.bank_imports
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "pending_transactions_authenticated" ON public.pending_transactions
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "vendor_rules_authenticated" ON public.vendor_rules
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "gst_hst_filings_authenticated" ON public.gst_hst_filings
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "self_repair_watchlist_authenticated" ON public.self_repair_watchlist
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ── 2. v_trial_balance: SECURITY DEFINER → SECURITY INVOKER ────────────────
--
-- security_invoker = true means the view enforces the caller's RLS context
-- rather than the view-creator's. With underlying tables now RLS-gated (above),
-- this prevents the view from being a privilege-escalation surface.

ALTER VIEW public.v_trial_balance SET (security_invoker = true);

-- ── 3. Revoke EXECUTE from anon + authenticated on 5 SECURITY DEFINER fns ──
--
-- All 5 are server-side helpers called via createServiceClient() (verified
-- via grep in lib/knowledge/{client,patterns}.ts and lib/harness/task-pickup.ts).
-- service_role bypasses GRANT/REVOKE so server callers are unaffected.
-- Direct PostgREST RPC calls from anon/authenticated browsers are now closed.

REVOKE EXECUTE ON FUNCTION public.claim_next_task(text)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.knowledge_decay_stale(timestamp with time zone)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.knowledge_mark_used(uuid, boolean)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.rebuild_knowledge_ivfflat_index()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.reclaim_stale_tasks()
  FROM anon, authenticated;
