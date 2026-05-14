-- Migration 0200: RLS Hardening (Security Patch)
-- Closes security vulnerability: "Table publicly accessible"
-- Enforces Row Level Security (RLS) on tables that were missed in previous migrations.
-- Following the pattern in migration 0050: service_role bypasses RLS,
-- anon/authenticated are denied access by default (no policies).

-- ── 1. Enable RLS on all identified vulnerable tables ────────────────────────

ALTER TABLE public.task_feedback             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_attribution        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streamlit_modules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_budget_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_budget_keyword_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oss_packages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleaning_clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cora_activities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_important_dates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cora_future_items         ENABLE ROW LEVEL SECURITY;

-- ── 2. Ensure service_role grants (per AGENTS.md / F24 rules) ────────────────

GRANT INSERT, UPDATE, DELETE ON public.task_feedback             TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.entity_attribution        TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.streamlit_modules         TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.work_budget_sessions      TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.work_budget_keyword_weights TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.oss_packages              TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.cleaning_clients          TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.cora_activities           TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.family_important_dates    TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.cora_future_items         TO service_role;

-- ── 3. Comments for Audit Traceability ───────────────────────────────────────

COMMENT ON TABLE public.task_feedback             IS 'RLS enabled (migration 0200). service_role only.';
COMMENT ON TABLE public.entity_attribution        IS 'RLS enabled (migration 0200). service_role only.';
COMMENT ON TABLE public.streamlit_modules         IS 'RLS enabled (migration 0200). service_role only.';
COMMENT ON TABLE public.work_budget_sessions      IS 'RLS enabled (migration 0200). service_role only.';
COMMENT ON TABLE public.work_budget_keyword_weights IS 'RLS enabled (migration 0200). service_role only.';
COMMENT ON TABLE public.oss_packages              IS 'RLS enabled (migration 0200). service_role only.';
COMMENT ON TABLE public.cleaning_clients          IS 'RLS enabled (migration 0200). service_role only.';
COMMENT ON TABLE public.cora_activities           IS 'RLS enabled (migration 0200). service_role only.';
COMMENT ON TABLE public.family_important_dates    IS 'RLS enabled (migration 0200). service_role only.';
COMMENT ON TABLE public.cora_future_items         IS 'RLS enabled (migration 0200). service_role only.';
