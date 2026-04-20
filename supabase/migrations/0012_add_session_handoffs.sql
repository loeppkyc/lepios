-- 0012_add_session_handoffs.sql
-- Machine-readable session handoff table (Step 2: Memory & State Management)
-- schema_version=1 stored both in payload and as a column for cheap filtering.

CREATE TABLE public.session_handoffs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     TEXT        NOT NULL UNIQUE,
  schema_version INT         NOT NULL DEFAULT 1,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  goal           TEXT        NOT NULL,
  status         TEXT        NOT NULL
                   CHECK (status IN ('completed', 'partial', 'blocked', 'deferred')),
  sprint         INT,
  payload        JSONB       NOT NULL
);

-- Fast recency lookup (primary access pattern)
CREATE INDEX session_handoffs_occurred_at_idx
  ON public.session_handoffs (occurred_at DESC);

-- RLS — service role bypasses; anon/authenticated read their own handoffs
ALTER TABLE public.session_handoffs ENABLE ROW LEVEL SECURITY;

-- Background jobs (service role) have full access; no explicit policy needed.
-- Authenticated users may read all handoffs (single-user app for now).
-- SPRINT5-GATE: tighten to person_handle when multi-user ships.
CREATE POLICY "authenticated can read handoffs"
  ON public.session_handoffs
  FOR SELECT
  TO authenticated
  USING (true);

-- Rollback:
--   DROP TABLE IF EXISTS public.session_handoffs;
