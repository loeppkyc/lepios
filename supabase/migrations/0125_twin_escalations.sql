-- Twin escalations: every askTwin escalate=true writes a row here.
-- Slice 2 of the escalation -> corpus loop. Slice 1 (PR #78) is the
-- /api/twin/teach endpoint; this slice tracks the open queue and links
-- answers back to the originating question.

CREATE TABLE public.twin_escalations (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  question        TEXT         NOT NULL,
  escalate_reason TEXT         NOT NULL CHECK (
    escalate_reason IN ('insufficient_context', 'personal_escalation', 'below_threshold')
  ),
  source_event_id UUID         REFERENCES public.agent_events(id) ON DELETE SET NULL,
  status          TEXT         NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'answered', 'dismissed')
  ),
  knowledge_id    UUID         REFERENCES public.knowledge(id) ON DELETE SET NULL,
  answer          TEXT,
  answered_at     TIMESTAMPTZ
);

CREATE INDEX twin_escalations_status_idx     ON public.twin_escalations (status);
CREATE INDEX twin_escalations_created_at_idx ON public.twin_escalations (created_at DESC);

ALTER TABLE public.twin_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "twin_escalations_authenticated" ON public.twin_escalations
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Rollback handled forward-only: a separate DROP migration would be added if needed.
-- (Inline rollback comment omitted — safety hook flags commented destructive SQL.
--  See docs/follow-ups/2026-05-05-safety-hook-comment-false-positive.md)
