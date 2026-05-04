-- 0075_session_digests.sql
-- Memory Layer chunk #5: session_digests table.
-- Spec: docs/harness/MEMORY_LAYER_SPEC.md §M4
--
-- Verify post-apply:
--   SELECT COUNT(*) FROM session_digests;  -- 0 (empty until first GET /api/memory/session-digest)

CREATE TABLE public.session_digests (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Session context
  branch        TEXT,
  topic         TEXT,
  requested_by  TEXT,

  -- Output
  markdown      TEXT         NOT NULL,
  sections      JSONB        NOT NULL DEFAULT '{}'::jsonb,

  -- Metrics
  bytes         INT          NOT NULL,
  build_ms      INT
);

CREATE INDEX session_digests_recent_idx ON public.session_digests (generated_at DESC);

ALTER TABLE public.session_digests ENABLE ROW LEVEL SECURITY;

-- SPRINT5-GATE: tighten to profiles.id when multi-user auth lands (see 0011/0015).
CREATE POLICY "session_digests_authenticated" ON public.session_digests
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- harness:digital_twin bump 71 → 78
-- Blended re-score after session_digest ships:
--   corpus+retrieval (40%, 85%) = 0.34
--   ingest pipeline  (15%, 60%) = 0.09
--   idea_inbox       (15%, 65%) = 0.0975
--   decisions_log    (15%, 90%) = 0.135
--   session_digest   (15%, 80%) = 0.12   ← was 30%
--   blended ≈ 78%

UPDATE public.harness_components
SET completion_pct = 78,
    notes          = 'session_digest shipped (chunk #5): table + buildSessionDigest() + GET /api/memory/session-digest + chat route injection on new conversation. /startup integration still pending.',
    updated_at     = NOW()
WHERE id = 'harness:digital_twin';

-- harness:chat_ui bump 85 → 93
-- Session digest injected at conversation start (isNew gate in /api/chat).

UPDATE public.harness_components
SET completion_pct = 93,
    notes          = 'Slice 5+digest shipped: 7 tools + session digest auto-injected on new conversation.',
    updated_at     = NOW()
WHERE id = 'harness:chat_ui';
