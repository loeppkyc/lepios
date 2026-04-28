-- 0044_memory_layer_decisions_log.sql
-- Memory Layer chunk #1: decisions_log table + memory-layer-scoped partial
-- unique index on knowledge.entity + mirror trigger.
--
-- Spec deviation (REDLINE 2026-04-28, Option A):
--   The parent spec (MEMORY_LAYER_SPEC.md §M3) called for a TABLE-WIDE
--   `knowledge.entity UNIQUE` constraint. Pre-flight against prod found ~270
--   duplicate non-null entity values from the personal-archive corpus
--   (e.g., "Janice Jones" 541 dups, "Colin Loeppky" 2026, "megan" 1179).
--   Adding a table-wide UNIQUE would fail or require destructive dedupe of
--   thousands of personal-archive rows — that's a separate chunk with its
--   own acceptance doc and a defined win-rule.
--
--   This migration uses a PARTIAL unique index scoped to the
--   `decisions_log:%` entity prefix instead. The mirror trigger's
--   ON CONFLICT inference matches that predicate. Effect: memory-layer
--   rows have unique-by-entity guarantees; existing personal-archive
--   dups are untouched. A follow-on chunk (task_queue: knowledge_dedupe)
--   will dedupe the personal-archive corpus and upgrade to table-wide
--   UNIQUE if the data shape supports it.
--
-- Acceptance doc: docs/harness/decisions-log-acceptance.md
-- Parent spec:    docs/harness/MEMORY_LAYER_SPEC.md §M3 (with redline note)

-- ── 1. Partial unique index on knowledge.entity (memory-layer scope) ─────────
-- Scoped to entity prefix used by this chunk only. The chunk #2 (idea_inbox)
-- migration will add a sibling partial index for the 'idea_inbox:%' prefix.

CREATE UNIQUE INDEX knowledge_decisions_log_entity_unique
  ON public.knowledge (entity)
  WHERE entity LIKE 'decisions_log:%';

-- ── 2. decisions_log table ───────────────────────────────────────────────────

CREATE TABLE public.decisions_log (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  decided_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- What
  topic              TEXT      NOT NULL,
  context            TEXT,
  options_considered JSONB     NOT NULL DEFAULT '[]'::jsonb,
  chosen_path        TEXT      NOT NULL,
  reason             TEXT,

  -- Classification
  category        TEXT         NOT NULL DEFAULT 'architecture'
                  CHECK (category IN (
                    'architecture','scope','data-model','tooling',
                    'process','principle','correction'
                  )),
  tags            JSONB        NOT NULL DEFAULT '[]'::jsonb,

  -- Provenance: decided_by = actor; source = capture pipeline.
  -- Both locked from day one for downstream attribution analytics.
  decided_by      TEXT         NOT NULL DEFAULT 'colin'
                  CHECK (decided_by IN ('colin','coordinator','agent','consensus')),
  source          TEXT         NOT NULL
                  CHECK (source IN (
                    'redline_session',
                    'morning_digest_response',
                    'incident_response',
                    'post_mortem'
                  )),
  source_ref      TEXT,
  related_files   JSONB        NOT NULL DEFAULT '[]'::jsonb,

  -- Supersession chain (we changed our minds about X)
  supersedes_id   UUID         REFERENCES public.decisions_log(id) ON DELETE SET NULL,
  superseded_at   TIMESTAMPTZ,

  -- Generated FTS
  fts             tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(topic,'') || ' ' ||
      coalesce(context,'') || ' ' ||
      coalesce(chosen_path,'') || ' ' ||
      coalesce(reason,'')
    )
  ) STORED
);

CREATE INDEX decisions_log_active_idx
  ON public.decisions_log (decided_at DESC)
  WHERE superseded_at IS NULL;

CREATE INDEX decisions_log_category_idx
  ON public.decisions_log (category, decided_at DESC);

CREATE INDEX decisions_log_fts_idx
  ON public.decisions_log USING GIN (fts);

ALTER TABLE public.decisions_log ENABLE ROW LEVEL SECURITY;

-- SPRINT5-GATE: tighten to profiles.id when multi-user auth lands (see 0011/0015).
CREATE POLICY "decisions_log_authenticated" ON public.decisions_log
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── 3. Mirror trigger: decisions_log → knowledge ─────────────────────────────
-- Each decisions_log INSERT/UPDATE upserts into `knowledge` so the existing
-- twin retrieval substrate (pgvector + FTS via app/api/twin/ask/route.ts)
-- finds the row with no API change. embedding_id stays NULL until the next
-- ingest job runs; FTS path catches keyword-exact queries in the meantime.
--
-- ON CONFLICT inference: the index predicate `entity LIKE 'decisions_log:%'`
-- must be repeated here so Postgres matches the partial unique index. All
-- entity values written by this trigger are 'decisions_log:'||uuid so the
-- predicate is always true for trigger-mediated rows.
--
-- When superseded_at flips non-null we halve the mirrored confidence so
-- superseded decisions still surface in audit but rank below current ones.

CREATE OR REPLACE FUNCTION public.decisions_log_mirror_to_knowledge()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_confidence REAL;
  v_context    TEXT;
BEGIN
  v_confidence := CASE WHEN NEW.superseded_at IS NULL THEN 0.85 ELSE 0.40 END;

  v_context := coalesce(NEW.reason, '') ||
               ' [category=' || NEW.category ||
               ', decided_by=' || NEW.decided_by ||
               ', source=' || NEW.source ||
               CASE WHEN NEW.superseded_at IS NOT NULL
                    THEN ', superseded_at=' || NEW.superseded_at::text
                    ELSE '' END ||
               ']';

  INSERT INTO public.knowledge
    (entity, category, domain, title, problem, solution, context, confidence, tags)
  VALUES (
    'decisions_log:' || NEW.id::text,
    'decision',
    'memory',
    NEW.topic,
    NEW.context,
    NEW.chosen_path,
    v_context,
    v_confidence,
    NEW.tags
  )
  ON CONFLICT (entity) WHERE entity LIKE 'decisions_log:%'
  DO UPDATE SET
    title       = EXCLUDED.title,
    problem     = EXCLUDED.problem,
    solution    = EXCLUDED.solution,
    context     = EXCLUDED.context,
    confidence  = EXCLUDED.confidence,
    tags        = EXCLUDED.tags,
    updated_at  = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER decisions_log_to_knowledge
  AFTER INSERT OR UPDATE ON public.decisions_log
  FOR EACH ROW EXECUTE FUNCTION public.decisions_log_mirror_to_knowledge();

-- ── Verify ───────────────────────────────────────────────────────────────────
-- After apply, run:
--   SELECT COUNT(*) FROM decisions_log;                                              -- 0
--   SELECT indexname FROM pg_indexes WHERE indexname = 'knowledge_decisions_log_entity_unique';  -- 1 row
--   SELECT tgname FROM pg_trigger WHERE tgname = 'decisions_log_to_knowledge';        -- 1 row

-- Rollback:
--   DROP TRIGGER IF EXISTS decisions_log_to_knowledge ON public.decisions_log;
--   DROP FUNCTION IF EXISTS public.decisions_log_mirror_to_knowledge();
--   DROP TABLE IF EXISTS public.decisions_log;
--   DROP INDEX IF EXISTS public.knowledge_decisions_log_entity_unique;
