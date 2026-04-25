-- 0024_match_knowledge_domain_filter.sql
--
-- Adds optional domain filter to match_knowledge().
--
-- Before: searched all ~10K rows across all domains — personal (8480) rows
-- dominated results, burying streamlit_source (1755) corpus in smoke tests.
--
-- After: pass domain='streamlit_source' (or any domain) to scope the search.
-- NULL (default) preserves existing cross-domain behavior — all callers
-- that omit domain continue to work without changes.
--
-- Callers audited 2026-04-25:
--   lib/knowledge/client.ts          → stays NULL (cross-domain general search)
--   app/api/twin/ask/route.ts        → stays NULL (client-side PERSONAL_CATEGORIES filter)
--   scripts/embed-streamlit-source.ts → updated to pass domain='streamlit_source'
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.match_knowledge(vector, int, float, text);
--   (0013 version with 3-arg signature is still in history and can be re-applied)

CREATE OR REPLACE FUNCTION public.match_knowledge(
  query_embedding  vector(768),
  match_count      int              DEFAULT 5,
  min_confidence   double precision DEFAULT 0.0,
  filter_domain    text             DEFAULT NULL
)
RETURNS TABLE(
  id             uuid,
  created_at     timestamptz,
  updated_at     timestamptz,
  category       text,
  domain         text,
  entity         text,
  title          text,
  problem        text,
  solution       text,
  context        text,
  confidence     double precision,
  times_used     int,
  times_helpful  int,
  last_used_at   timestamptz,
  source_events  jsonb,
  tags           jsonb,
  embedding_id   text,
  similarity     double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    created_at,
    updated_at,
    category,
    domain,
    entity,
    title,
    problem,
    solution,
    context,
    confidence::float,
    times_used,
    times_helpful,
    last_used_at,
    source_events,
    tags,
    embedding_id,
    (1 - (embedding <=> query_embedding))::float AS similarity
  FROM public.knowledge
  WHERE embedding IS NOT NULL
    AND confidence >= min_confidence
    AND (filter_domain IS NULL OR domain = filter_domain)
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
