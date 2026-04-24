-- 0018_add_auto_proceed_patterns.sql
-- Improvement Engine: auto-proceed pattern cache.
-- Stores patterns (category + action_signature) that Colin has approved
-- enough times (>= 3) to allow the engine to auto-proceed without Telegram
-- sign-off.
--
-- A pattern row is created the first time Colin approves a proposal of that
-- category + action_signature. approval_count increments on each subsequent
-- approval. enabled flips to true only when approval_count >= 3.
--
-- See: docs/sprint-5/20-percent-better-engine-acceptance.md §Component 7

CREATE TABLE IF NOT EXISTS public.auto_proceed_patterns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Category of the improvement proposal (matches ImprovementProposal.category)
  category         TEXT        NOT NULL,

  -- Normalized first 80 chars of concrete_action (fingerprint discriminator)
  action_signature TEXT        NOT NULL,

  -- How many times Colin has approved a proposal matching this pattern
  approval_count   INT         NOT NULL DEFAULT 0,

  -- Timestamp of the most recent approval
  last_approved_at TIMESTAMPTZ,

  -- Set to true automatically when approval_count reaches 3
  -- Engine only auto-proceeds when this is true
  enabled          BOOLEAN     NOT NULL DEFAULT false,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.auto_proceed_patterns IS
  'Improvement Engine auto-proceed cache. When a proposal pattern accumulates '
  '>= 3 Colin approvals and enabled=true, the engine routes it to auto_proceeded '
  'status without a Telegram notification. See Component 7 in acceptance doc.';

-- Unique on (category, action_signature) — one pattern row per distinct type
CREATE UNIQUE INDEX IF NOT EXISTS auto_proceed_patterns_sig_idx
  ON public.auto_proceed_patterns (category, action_signature);

-- RLS: service role bypasses automatically.
-- Authenticated users get full access — single-user app.
ALTER TABLE public.auto_proceed_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auto_proceed_patterns_authenticated" ON public.auto_proceed_patterns
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Rollback:
--   DROP TABLE IF EXISTS public.auto_proceed_patterns;

-- ── SCHEMA CONSTRAINT NOTE (BLOCKER — requires separate migration) ────────────
--
-- The improvement engine inserts into task_queue with:
--   source = 'improvement_engine'   (CHECK currently allows only: manual|handoff-file|colin-telegram|cron)
--   status = 'auto_proceeded'       (CHECK currently allows only: queued|claimed|running|completed|failed|cancelled)
--
-- Both will fail the CHECK constraint in the live DB.
-- A coordinator must queue a Colin-approved migration to ALTER those constraints:
--
--   ALTER TABLE public.task_queue
--     DROP CONSTRAINT task_queue_source_check,
--     ADD  CONSTRAINT task_queue_source_check
--       CHECK (source IN ('manual','handoff-file','colin-telegram','cron','improvement_engine'));
--
--   ALTER TABLE public.task_queue
--     DROP CONSTRAINT task_queue_status_check,
--     ADD  CONSTRAINT task_queue_status_check
--       CHECK (status IN ('queued','claimed','running','completed','failed','cancelled','auto_proceeded'));
--
-- This file does NOT apply those changes — they require explicit Colin approval
-- per ARCHITECTURE.md §3 rule 3.
