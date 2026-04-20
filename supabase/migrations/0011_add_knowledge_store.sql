-- 0011_add_knowledge_store.sql
--
-- Extends agent_events with RAG-required fields (schema was marked speculative in 0005).
-- Adds knowledge store and daily metrics tables.
-- Full-text search via tsvector generated column (standard Postgres, no extensions).
-- embedding_id is a forward placeholder — pgvector embeddings added in Sprint 5
-- when Ollama is ported to LepiOS TypeScript.

-- ── Extend agent_events ──────────────────────────────────────────────────────

ALTER TABLE public.agent_events
  ADD COLUMN IF NOT EXISTS entity      TEXT,
  ADD COLUMN IF NOT EXISTS error_type  TEXT,
  ADD COLUMN IF NOT EXISTS tokens_used INTEGER,
  ADD COLUMN IF NOT EXISTS confidence  REAL,
  ADD COLUMN IF NOT EXISTS parent_id   UUID REFERENCES public.agent_events(id);

-- Widen status constraint: keep 'error' (scan route uses it), add 'failure'
ALTER TABLE public.agent_events
  DROP CONSTRAINT IF EXISTS agent_events_status_check;

ALTER TABLE public.agent_events
  ADD CONSTRAINT agent_events_status_check
  CHECK (status IN ('success', 'error', 'failure', 'warning'));

CREATE INDEX IF NOT EXISTS agent_events_entity_idx    ON public.agent_events (entity);
CREATE INDEX IF NOT EXISTS agent_events_error_type_idx ON public.agent_events (error_type);

-- ── Knowledge store ──────────────────────────────────────────────────────────
-- Categorized entries with confidence scoring and full-text search.
-- categories: error_fix | workflow | pattern | rule | tip | debug_step |
--             failed_approach | translation_pattern

CREATE TABLE public.knowledge (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  category      TEXT         NOT NULL,
  domain        TEXT         NOT NULL,
  entity        TEXT,
  title         TEXT         NOT NULL,
  problem       TEXT,
  solution      TEXT,
  context       TEXT,
  confidence    REAL         NOT NULL DEFAULT 0.5,
  times_used    INT          NOT NULL DEFAULT 0,
  times_helpful INT          NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ,
  source_events JSONB,   -- array of agent_events.id strings
  tags          JSONB,
  embedding_id  TEXT,    -- SPRINT5-GATE: pgvector doc id, populated when Ollama ports
  -- Generated full-text search vector — auto-maintained by Postgres, no trigger needed
  fts           tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title,    '') || ' ' ||
      coalesce(problem,  '') || ' ' ||
      coalesce(solution, '') || ' ' ||
      coalesce(context,  '')
    )
  ) STORED
);

CREATE INDEX knowledge_category_idx ON public.knowledge (category);
CREATE INDEX knowledge_domain_idx   ON public.knowledge (domain);
CREATE INDEX knowledge_confidence_idx ON public.knowledge (confidence DESC);
CREATE INDEX knowledge_fts_idx      ON public.knowledge USING GIN (fts);

ALTER TABLE public.knowledge ENABLE ROW LEVEL SECURITY;
-- SPRINT5-GATE: tighten to profiles.id when multi-user auth lands (MN-3)
CREATE POLICY "knowledge_authenticated" ON public.knowledge
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── knowledge_mark_used RPC ──────────────────────────────────────────────────
-- Atomic increment + confidence adjustment. Avoids read-modify-write race.

CREATE OR REPLACE FUNCTION public.knowledge_mark_used(
  p_id      UUID,
  p_helpful BOOLEAN DEFAULT TRUE
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_helpful THEN
    UPDATE public.knowledge SET
      times_used    = times_used + 1,
      times_helpful = times_helpful + 1,
      last_used_at  = now(),
      confidence    = LEAST(confidence + 0.05, 1.0),
      updated_at    = now()
    WHERE id = p_id;
  ELSE
    UPDATE public.knowledge SET
      times_used   = times_used + 1,
      last_used_at = now(),
      confidence   = GREATEST(confidence - 0.03, 0.1),
      updated_at   = now()
    WHERE id = p_id;
  END IF;
END;
$$;

-- ── knowledge_decay_stale RPC ────────────────────────────────────────────────
-- Reduce confidence on entries not used in the last N days.
-- Called by nightly learn job.

CREATE OR REPLACE FUNCTION public.knowledge_decay_stale(
  p_cutoff TIMESTAMPTZ
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.knowledge SET
    confidence = GREATEST(confidence - 0.05, 0.1),
    updated_at = now()
  WHERE (last_used_at IS NULL OR last_used_at < p_cutoff)
    AND confidence > 0.1;
END;
$$;

-- ── Daily metrics rollup ─────────────────────────────────────────────────────

CREATE TABLE public.daily_metrics (
  id     UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  date   DATE  NOT NULL,
  domain TEXT  NOT NULL,
  metric TEXT  NOT NULL,
  value  REAL  NOT NULL,
  UNIQUE (date, domain, metric)
);

CREATE INDEX daily_metrics_date_idx ON public.daily_metrics (date DESC);

ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;
-- SPRINT5-GATE: tighten to profiles.id when multi-user auth lands (MN-3)
CREATE POLICY "daily_metrics_authenticated" ON public.daily_metrics
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Rollback:
--   DROP TABLE IF EXISTS public.daily_metrics;
--   DROP TABLE IF EXISTS public.knowledge;
--   DROP FUNCTION IF EXISTS public.knowledge_decay_stale(TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS public.knowledge_mark_used(UUID, BOOLEAN);
--   -- agent_events column additions (entity, error_type, tokens_used, confidence, parent_id) cannot be
--   -- cleanly reverted without risk of data loss — treat as forward-only if rows exist.
