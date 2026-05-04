-- 0073_idea_inbox.sql
-- Memory Layer chunk #2: idea_inbox table + partial unique index on knowledge.entity
-- + mirror trigger + 4 seed rows from memory/feature_backlog.md
-- + harness:digital_twin rollup bump 62→71.
--
-- Spec: docs/harness/MEMORY_LAYER_SPEC.md §M2
-- Follows the partial-index redline from chunk #1 (0044): sibling index scoped
-- to entity prefix 'idea_inbox:%' so existing knowledge dups are untouched.
--
-- Verify post-apply:
--   SELECT COUNT(*) FROM idea_inbox;                                       -- expect 4 (seeds)
--   SELECT indexname FROM pg_indexes WHERE indexname = 'knowledge_idea_inbox_entity_unique'; -- 1
--   SELECT tgname FROM pg_trigger WHERE tgname = 'idea_inbox_to_knowledge'; -- 1
--   SELECT completion_pct FROM harness_components WHERE id='harness:digital_twin'; -- 71

-- ── 1. Partial unique index on knowledge.entity (idea_inbox scope) ────────────
-- Sibling of knowledge_decisions_log_entity_unique from 0044.

CREATE UNIQUE INDEX knowledge_idea_inbox_entity_unique
  ON public.knowledge (entity)
  WHERE entity LIKE 'idea_inbox:%';

-- ── 2. idea_inbox table ───────────────────────────────────────────────────────

CREATE TABLE public.idea_inbox (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Free-text body
  title         TEXT         NOT NULL,
  body          TEXT,
  summary       TEXT,                                       -- ≤200 chars, used in digest

  -- Provenance — locked enum from day one (spec redline, same as decisions_log).
  source        TEXT         NOT NULL
                CHECK (source IN (
                  'manual_telegram',
                  'manual_api',
                  'manual_cli_backlog',
                  'scout_agent',
                  'session_decision_overflow'
                )),
  source_ref    TEXT,

  -- Lifecycle
  status        TEXT         NOT NULL DEFAULT 'parked'
                CHECK (status IN ('parked','active','shipped','dismissed')),
  score         NUMERIC(4,2) NOT NULL DEFAULT 0.50
                CHECK (score >= 0 AND score <= 1),

  -- Tags + linkage
  tags          JSONB        NOT NULL DEFAULT '[]'::jsonb,
  related_task_id UUID       REFERENCES public.task_queue(id) ON DELETE SET NULL,

  -- Lifecycle timestamps
  promoted_at   TIMESTAMPTZ,
  shipped_at    TIMESTAMPTZ,
  dismissed_at  TIMESTAMPTZ,

  -- Generated FTS
  fts           tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title,'') || ' ' ||
      coalesce(summary,'') || ' ' ||
      coalesce(body,'')
    )
  ) STORED
);

CREATE INDEX idea_inbox_status_score_idx ON public.idea_inbox (status, score DESC, created_at DESC);
CREATE INDEX idea_inbox_source_idx       ON public.idea_inbox (source, created_at DESC);
CREATE INDEX idea_inbox_fts_idx          ON public.idea_inbox USING GIN (fts);

ALTER TABLE public.idea_inbox ENABLE ROW LEVEL SECURITY;

-- SPRINT5-GATE: tighten to profiles.id when multi-user auth lands (see 0011/0015).
CREATE POLICY "idea_inbox_authenticated" ON public.idea_inbox
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ── 3. Mirror trigger: idea_inbox → knowledge ─────────────────────────────────
-- AFTER INSERT/UPDATE: upsert mirrored row into knowledge with category='idea'.
-- ON CONFLICT predicate matches the partial unique index above.

CREATE OR REPLACE FUNCTION public.idea_inbox_mirror_to_knowledge()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.knowledge
    (entity, category, domain, title, problem, solution, context, confidence, tags)
  VALUES (
    'idea_inbox:' || NEW.id::text,
    'idea',
    'memory',
    NEW.title,
    NULL,
    NEW.summary,
    coalesce(NEW.body,'') || ' [status=' || NEW.status || ', source=' || NEW.source || ']',
    NEW.score::real,
    NEW.tags
  )
  ON CONFLICT (entity) WHERE entity LIKE 'idea_inbox:%'
  DO UPDATE SET
    title       = EXCLUDED.title,
    solution    = EXCLUDED.solution,
    context     = EXCLUDED.context,
    confidence  = EXCLUDED.confidence,
    tags        = EXCLUDED.tags,
    updated_at  = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER idea_inbox_to_knowledge
  AFTER INSERT OR UPDATE ON public.idea_inbox
  FOR EACH ROW EXECUTE FUNCTION public.idea_inbox_mirror_to_knowledge();

-- ── 4. Seed: 4 ideas from memory/feature_backlog.md ──────────────────────────

INSERT INTO public.idea_inbox (title, summary, source, status, score, tags)
VALUES
  (
    'Digital Twin Q&A Interface',
    'ChromaDB + conversation history + colin-principles query layer so coordinator resolves ambiguity without escalating to real Colin.',
    'manual_cli_backlog',
    'active',
    0.90,
    '["twin","autonomy","coordinator"]'::jsonb
  ),
  (
    '20% Better Feedback Loop Engine',
    'Coordinator runs 20% Better checklist against every ported feature in Phase 1c — correctness, performance, UX, extensibility, data model, observability.',
    'manual_cli_backlog',
    'active',
    0.85,
    '["feedback","autonomy","coordinator"]'::jsonb
  ),
  (
    'Daily Gmail Scanner',
    'Scan inbox for invoices, receipts, reconciliation emails, statement arrival notifications. Foundation for Chunk D v2 close_day detection and auto-categorization.',
    'manual_cli_backlog',
    'parked',
    0.75,
    '["gmail","integrations","statement-coverage"]'::jsonb
  ),
  (
    'Statement Coverage Chunk D v2',
    'Rebuild with full Streamlit-parity close_day logic — was a statement actually covering the period, not just file-presence.',
    'manual_cli_backlog',
    'parked',
    0.70,
    '["statement-coverage","business-review"]'::jsonb
  );

-- ── 5. harness:digital_twin rollup bump 62 → 71 ──────────────────────────────
-- Blended re-score after idea_inbox ships (table + endpoint + chat_ui tool + seed):
--   corpus+retrieval (40% sub-weight, 85%) = 0.34
--   ingest pipeline  (15%, 60%)           = 0.09
--   idea_inbox       (15%, 65%)           = 0.0975  ← was 0%
--   decisions_log    (15%, 90%)           = 0.135
--   session_digest   (15%, 30%)           = 0.045
--   blended ≈ 71%

UPDATE public.harness_components
SET completion_pct = 71,
    notes          = 'idea_inbox shipped (chunk #2): table + POST /api/memory/idea + mirror trigger + 4 seeds + listIdeas/submitIdea chat_ui tools. session_digest + /startup integration still pending.',
    updated_at     = NOW()
WHERE id = 'harness:digital_twin';
