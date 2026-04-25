-- 0023_add_streamlit_modules.sql
--
-- Adds the streamlit_modules catalog table for the Streamlit inventory sweep.
-- One row per .py module in streamlit_app/; used to track port status, tier,
-- deps, F17/F18 fields, and suggested decomposition chunks.
--
-- Also adds the rebuild_knowledge_ivfflat_index() RPC, called by
-- scripts/embed-streamlit-source.ts after the corpus embed pass to reindex
-- with lists=50 (appropriate for ~3,000-5,000 rows vs. the original lists=10).

-- ── streamlit_modules table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.streamlit_modules (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  path                 text        NOT NULL UNIQUE,   -- relative to streamlit_app/, e.g. 'utils/amazon.py'
  lines                int         NOT NULL DEFAULT 0,
  classification       text        NOT NULL DEFAULT 'util'
                                   CHECK (classification IN ('page','util','client','config','test','dead')),
  deps_in              text[]      NOT NULL DEFAULT '{}',  -- files that import this module
  deps_out             text[]      NOT NULL DEFAULT '{}',  -- files this module imports
  external_deps        text[]      NOT NULL DEFAULT '{}',  -- external services
  suggested_tier       int         CHECK (suggested_tier BETWEEN 1 AND 5),
  suggested_chunks     jsonb,                              -- array of {task, scope, estimated_lines}
  f17_signal           text,                               -- how this module feeds the path probability engine
  f18_metric_candidate text,                               -- what metric this module should expose in LepiOS
  port_status          text        NOT NULL DEFAULT 'pending'
                                   CHECK (port_status IN ('pending','in_progress','complete','deferred','skip')),
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS streamlit_modules_tier_idx
  ON public.streamlit_modules (suggested_tier);

CREATE INDEX IF NOT EXISTS streamlit_modules_status_idx
  ON public.streamlit_modules (port_status);

CREATE INDEX IF NOT EXISTS streamlit_modules_classification_idx
  ON public.streamlit_modules (classification);

-- ── rebuild_knowledge_ivfflat_index RPC ──────────────────────────────────────
-- Drops and rebuilds the IVFFlat index with lists=50.
-- Called after embed-streamlit-source.ts completes to reindex for ~3-5K rows.
-- lists=10 was correct for <1,000 rows; lists=50 ≈ sqrt(3000-5000) rows.

CREATE OR REPLACE FUNCTION public.rebuild_knowledge_ivfflat_index()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DROP INDEX IF EXISTS knowledge_embedding_idx;
  CREATE INDEX knowledge_embedding_idx
    ON public.knowledge USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);
END;
$$;

-- Rollback:
--   DROP FUNCTION IF EXISTS public.rebuild_knowledge_ivfflat_index();
--   DROP TABLE IF EXISTS public.streamlit_modules;
