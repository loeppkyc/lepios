-- 0032_harness_components.sql
-- Harness rollup auto-compute foundation.
-- One row per harness component; rollup = SUM(weight_pct * completion_pct / 100).
--
-- To update a component's completion %: one row update, no code change:
--   UPDATE harness_components
--     SET completion_pct = 75, updated_at = NOW()
--     WHERE id = 'harness:twin_ollama';
--
-- To add a component: INSERT a row; it is included in the next digest automatically.
--
-- Invariant: SUM(weight_pct) should equal 100.
-- Verify with: SELECT SUM(weight_pct) FROM harness_components;

CREATE TABLE public.harness_components (
  id              TEXT PRIMARY KEY,
  display_name    TEXT        NOT NULL,
  weight_pct      NUMERIC(5,2) NOT NULL
                  CHECK (weight_pct >= 0 AND weight_pct <= 100),
  completion_pct  NUMERIC(5,2) NOT NULL DEFAULT 0
                  CHECK (completion_pct >= 0 AND completion_pct <= 100),
  notes           TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.harness_components IS
  'Harness rollup model. One row per component; weight_pct must sum to 100. '
  'Update completion_pct via SQL as milestones ship — no code change required. '
  'See lib/harness/rollup.ts for computation logic.';

-- RLS: service role bypasses automatically.
-- Authenticated users get full access — single-user app for v0.
ALTER TABLE public.harness_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "harness_components_authenticated" ON public.harness_components
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Seed: 18 normalized components from CLAUDE.md §9 + scope doc.
-- Weights sum to 100. Verified: 18+9+9+9+7+6+5+3+2+5+4+4+4+2+2+6+3+2 = 100.
INSERT INTO public.harness_components
  (id, display_name, weight_pct, completion_pct, notes)
VALUES
  ('harness:coordinator_core',      'Coordinator core',                             18, 100, NULL),
  ('harness:remote_invocation',     'Remote invocation',                             9, 100, NULL),
  ('harness:deploy_gate',           'Deploy gate',                                   9, 100, NULL),
  ('harness:task_pickup',           'Task pickup',                                   9, 100, NULL),
  ('harness:stall_detection',       'Stall detection (T1-T5)',                       7, 100, NULL),
  ('harness:notification_drain',    'Notification drain + dedup',                    6, 100, NULL),
  ('harness:coordinator_env',       'Coordinator env loading',                       5, 100, NULL),
  ('harness:branch_naming',         'Branch naming enforcement',                     3, 100, NULL),
  ('harness:f18_surfacing',         'F18 surfacing (branch guard)',                  2, 100, NULL),
  ('harness:improvement_loop',      '20% Better process layer',                      5, 100, NULL),
  ('harness:twin_corpus',           'Twin Q&A — corpus + category fix',              4, 100, NULL),
  ('harness:twin_fts',              'Twin Q&A — FTS fallback',                       4, 100, NULL),
  ('harness:twin_ollama',           'Twin Q&A — Ollama tunnel',                      4,   0, 'Gated on OLLAMA_TUNNEL_URL wiring (Step 6.5)'),
  ('harness:telegram_timeouts',     'Telegram — timeouts wired',                     2, 100, NULL),
  ('harness:telegram_drain_hourly', 'Telegram — hourly drain (deferred)',            2,   0, 'Deferred — Vercel Hobby plan rejects hourly crons'),
  ('harness:telegram_remaining',    'Telegram — remaining (correlation, callback truncation, etc.)', 6, 0, 'Correlation, callback truncation, inline keyboard'),
  ('harness:smoke_test_framework',  'Smoke test framework',                          3,  30, 'Post-deploy smoke tests scoped, not yet shipped'),
  ('harness:prestaged_tasks',       'Pre-staged tasks (3 tasks)',                    2,  33, '1 of 3 pre-staged acceptance doc tasks in progress');

-- Rollback:
--   DROP TABLE IF EXISTS public.harness_components;
