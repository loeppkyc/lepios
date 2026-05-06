-- 0131_move_pgvector_to_extensions.sql
--
-- Closes Supabase advisor WARN: extension_in_public for `vector`. Moves the
-- pgvector extension out of the `public` schema into the dedicated
-- `extensions` schema (where pg_stat_statements, pgcrypto, and uuid-ossp
-- already live). Aligns with Supabase guidance:
--   https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public
--
-- ──────────────────────────────────────────────────────────────────────────
-- What ALTER EXTENSION ... SET SCHEMA does (and what it does NOT do):
-- ──────────────────────────────────────────────────────────────────────────
-- • Moves all extension-owned objects (the `vector` type, the `<=>`/`<->`/
--   `<#>` distance operators, the `vector_cosine_ops` / `vector_l2_ops` /
--   `vector_ip_ops` opclasses, ivfflat/hnsw access methods, etc.) from
--   `public` to `extensions`.
-- • Does NOT modify column definitions on user tables. `public.knowledge.
--   embedding` references the `vector` type by oid; the oid is unchanged
--   by the schema move, so the column remains valid.
-- • Does NOT modify existing indexes. `public.knowledge_embedding_idx`
--   references `vector_cosine_ops` by oid via pg_index.indclass; the
--   index continues to function without rebuild.
-- • DOES break function bodies that reference pgvector objects by their
--   public-qualified names — those are stored as TEXT in pg_proc.prosrc
--   and re-resolved on each call. Two functions in this database do so:
--     1. public.match_knowledge          — `OPERATOR(public.<=>)` x2
--     2. public.rebuild_knowledge_ivfflat_index — `public.vector_cosine_ops`
--   Both must be re-CREATEd in the same transaction as the ALTER EXTENSION
--   so the move + body updates land atomically.
--
-- ──────────────────────────────────────────────────────────────────────────
-- Why this lands as one migration (not three):
-- ──────────────────────────────────────────────────────────────────────────
-- ALTER EXTENSION must precede the function body updates, because the new
-- bodies reference `extensions.<=>` and `extensions.vector_cosine_ops` —
-- those names are only resolvable AFTER the move. apply_migration runs in
-- a single transaction, so partial failure rolls the whole thing back.
--
-- ──────────────────────────────────────────────────────────────────────────
-- High-traffic guard:
-- ──────────────────────────────────────────────────────────────────────────
-- match_knowledge powers /api/twin/ask. Live smoke (>= 1 vector hit on a
-- known-good query) is required post-apply. Any 0-hit result triggers
-- immediate revert: ALTER EXTENSION vector SET SCHEMA public + restore
-- prior function bodies (commit 2ccc9a4 has the public-qualified versions).

-- 1. Move pgvector to extensions schema.
ALTER EXTENSION vector SET SCHEMA extensions;

-- 2. Re-create match_knowledge with extensions-qualified operator.
--
-- Body change vs. migration 0130:
--   BEFORE: embedding OPERATOR(public.<=>) query_embedding
--   AFTER:  embedding OPERATOR(extensions.<=>) query_embedding
--
-- The `vector` argument type does NOT need qualification — argument types
-- resolve at CREATE-time using the session search_path (which includes
-- `extensions` by default on Supabase) and are stored as oids. Verified
-- empirically in migration 0130's apply notes.
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
    (1 - (embedding OPERATOR(extensions.<=>) query_embedding))::float AS similarity
  FROM public.knowledge
  WHERE embedding IS NOT NULL
    AND confidence >= min_confidence
    AND (filter_domain IS NULL OR domain = filter_domain)
  ORDER BY embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$function$;

-- 3. Re-create rebuild_knowledge_ivfflat_index with extensions-qualified opclass.
--
-- Body change vs. migration 0129:
--   BEFORE: USING ivfflat (embedding public.vector_cosine_ops)
--   AFTER:  USING ivfflat (embedding extensions.vector_cosine_ops)
--
-- SECURITY DEFINER + SET search_path = '' preserved from 0129.
CREATE OR REPLACE FUNCTION public.rebuild_knowledge_ivfflat_index()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  DROP INDEX IF EXISTS public.knowledge_embedding_idx;
  CREATE INDEX knowledge_embedding_idx
    ON public.knowledge USING ivfflat (embedding extensions.vector_cosine_ops)
    WITH (lists = 50);
END;
$function$;
