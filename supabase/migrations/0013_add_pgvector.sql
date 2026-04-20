-- 0013_add_pgvector.sql
--
-- Adds pgvector extension and 768-dimension embedding column to the knowledge table.
-- 768 dimensions matches nomic-embed-text (default Ollama embed model for LepiOS).
-- embedding_id column (TEXT) was already added as a forward placeholder in 0011;
-- this migration adds the actual vector storage alongside it.
--
-- Adds match_knowledge() RPC for cosine-similarity search via pgvector.
-- Called by lib/knowledge/client.ts findKnowledge() when Ollama is reachable.
--
-- Self-host ready: pgvector is a standard Postgres extension, no Supabase-specific features.

-- ── Extension ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Embedding column ─────────────────────────────────────────────────────────

ALTER TABLE public.knowledge
  ADD COLUMN IF NOT EXISTS embedding vector(768);

-- IVFFlat approximate nearest-neighbor index.
-- lists = 10 appropriate for < 1 000 rows; scale to sqrt(rows) as corpus grows.
-- vector_cosine_ops: cosine distance (1 - cosine_similarity).
CREATE INDEX IF NOT EXISTS knowledge_embedding_idx
  ON public.knowledge
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- ── match_knowledge RPC ──────────────────────────────────────────────────────
-- Returns knowledge rows ordered by cosine similarity to query_embedding.
-- similarity = 1 - (embedding <=> query_embedding), so 1.0 = identical.
-- Used by lib/knowledge/client.ts findKnowledge() hybrid scoring path.

CREATE OR REPLACE FUNCTION public.match_knowledge(
  query_embedding vector(768),
  match_count     int     DEFAULT 5,
  min_confidence  float   DEFAULT 0.0
)
RETURNS TABLE (
  id              uuid,
  created_at      timestamptz,
  updated_at      timestamptz,
  category        text,
  domain          text,
  entity          text,
  title           text,
  problem         text,
  solution        text,
  context         text,
  confidence      float,
  times_used      int,
  times_helpful   int,
  last_used_at    timestamptz,
  source_events   jsonb,
  tags            jsonb,
  embedding_id    text,
  similarity      float
)
LANGUAGE sql STABLE
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
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Rollback:
--   DROP FUNCTION IF EXISTS public.match_knowledge(vector, int, float);
--   DROP INDEX IF EXISTS knowledge_embedding_idx;
--   ALTER TABLE public.knowledge DROP COLUMN IF EXISTS embedding;
--   DROP EXTENSION IF EXISTS vector;
