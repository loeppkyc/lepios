CREATE TABLE public.keepa_history_cache (
  asin        TEXT PRIMARY KEY,
  points      JSONB NOT NULL,          -- [{t: unix_seconds, rank: number}, ...]
  tokens_left INT,                     -- tokensLeft from Keepa response, for audit
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON public.keepa_history_cache (fetched_at);

ALTER TABLE public.keepa_history_cache ENABLE ROW LEVEL SECURITY;
-- SPRINT5-GATE: policy currently allows any authenticated user to read any ASIN's
-- cache (fine for single-operator today). Review and tighten when multi-user auth
-- lands per ARCHITECTURE.md §7.3 hard gate. BSR history is not user-sensitive data,
-- but the policy pattern must still be audited with all other RLS policies at that time.
CREATE POLICY "keepa_history_cache_authenticated" ON public.keepa_history_cache
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
