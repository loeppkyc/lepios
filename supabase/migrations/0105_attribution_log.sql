-- 0105_attribution_log.sql
-- Per-commit and per-PR agent attribution log.
-- Bumps harness:attribution 55 → 100%.
--
-- Verify post-apply:
--   SELECT COUNT(*) FROM attribution_log;  -- 0 (empty until first agent commit)
--   SELECT completion_pct FROM harness_components WHERE id = 'harness:attribution';
--   -- expects: 100

CREATE TABLE public.attribution_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    TEXT        NOT NULL,
  task_id     TEXT,
  run_id      TEXT,
  action      TEXT        NOT NULL CHECK (action IN ('commit', 'pr_open')),
  commit_sha  TEXT,
  pr_number   INTEGER,
  pr_url      TEXT,
  branch      TEXT        NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attribution_agent  ON public.attribution_log (agent_id, occurred_at DESC);
CREATE INDEX idx_attribution_branch ON public.attribution_log (branch, occurred_at DESC);
CREATE INDEX idx_attribution_recent ON public.attribution_log (occurred_at DESC);

ALTER TABLE public.attribution_log ENABLE ROW LEVEL SECURITY;

-- Service role: INSERT + SELECT. No UPDATE, no DELETE — append-only audit log.
GRANT INSERT, SELECT ON public.attribution_log TO service_role;

CREATE POLICY "attribution_log_authenticated" ON public.attribution_log
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ── Rollup bump: attribution 55 → 100% ────────────────────────────────────────
-- Branch naming (55%) + attribution_log table + POST /api/harness/record-attribution
-- + builder.md / self_repair pr-opener wired to call on each commit/PR = 100%.

UPDATE public.harness_components
SET completion_pct = 100,
    notes          = 'Branch naming + attribution_log table + POST /api/harness/record-attribution. Builder calls on commit; self_repair calls on PR open.',
    updated_at     = NOW()
WHERE id = 'harness:attribution';
