-- 0130_pin_search_path_tier3_match_knowledge.sql
--
-- Tier 3 of the search_path audit (Supabase advisor 2026-05-06,
-- function_search_path_mutable WARN class). Closes the final finding;
-- combined with 0128 (Tier 1) + 0129 (Tier 2), all 13 functions are now
-- pinned.
--
-- match_knowledge is the high-traffic twin retrieval function — vector
-- similarity over public.knowledge. It is the ONE function in the audit
-- with LANGUAGE sql (not plpgsql).
--
-- Body change vs. existing definition:
--   BEFORE: embedding <=> query_embedding
--   AFTER:  embedding OPERATOR(public.<=>) query_embedding
--
-- The <=> operator (cosine distance) is defined by the pgvector extension,
-- which lives in the public schema. With SET search_path = '' on the
-- function, the body parser cannot resolve <=> through implicit search;
-- it must be qualified via the OPERATOR(schema.op) syntax. Verified
-- empirically: first apply attempt failed with "operator does not exist:
-- public.vector <=> public.vector" without the qualification.
--
-- The vector ARGUMENT type does NOT need qualification — argument types
-- are resolved at CREATE time using the session search_path, not the
-- function's pinned search_path, and stored as type oids.
--
-- A future migration moving the vector extension to a dedicated
-- `extensions` schema (deferred WARN extension_in_public) will require
-- this qualification to change to OPERATOR(extensions.<=>).
--
-- High-traffic guard: this function powers /api/twin/ask. Live smoke
-- (>= 1 hit on a known-good query) is required post-apply; any 0-hit
-- result triggers immediate rollback to the prior definition.
--
-- Idempotent via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.match_knowledge(
  query_embedding vector,
  match_count integer DEFAULT 5,
  min_confidence double precision DEFAULT 0.0,
  filter_domain text DEFAULT NULL::text
)
RETURNS TABLE(
  id uuid,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  category text,
  domain text,
  entity text,
  title text,
  problem text,
  solution text,
  context text,
  confidence double precision,
  times_used integer,
  times_helpful integer,
  last_used_at timestamp with time zone,
  source_events jsonb,
  tags jsonb,
  embedding_id text,
  similarity double precision
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
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
    (1 - (embedding OPERATOR(public.<=>) query_embedding))::float AS similarity
  FROM public.knowledge
  WHERE embedding IS NOT NULL
    AND confidence >= min_confidence
    AND (filter_domain IS NULL OR domain = filter_domain)
  ORDER BY embedding OPERATOR(public.<=>) query_embedding
  LIMIT match_count;
$function$;
