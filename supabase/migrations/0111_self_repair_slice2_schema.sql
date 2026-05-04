-- 0111_self_repair_slice2_schema.sql
-- Self-Repair Slice 2: likely_files column + deploy_failed + lint_failed watchlist seeds

-- 1. Add likely_files column to self_repair_watchlist
ALTER TABLE public.self_repair_watchlist
  ADD COLUMN IF NOT EXISTS likely_files TEXT[] NOT NULL DEFAULT '{}';

-- 2. Seed deploy_failed watchlist entry
INSERT INTO public.self_repair_watchlist (action_type, enabled, likely_files, notes, added_by)
VALUES (
  'deploy_failed',
  true,
  '{}',
  'GitHub Actions workflow_run failure. Drafter reads build log from event context. LLM drafts fix.',
  'coordinator'
)
ON CONFLICT (action_type) DO NOTHING;

-- 3. Seed lint_failed watchlist entry
INSERT INTO public.self_repair_watchlist (action_type, enabled, likely_files, notes, added_by)
VALUES (
  'lint_failed',
  true,
  ARRAY['**/*.ts', '**/*.tsx', '**/*.js'],
  'Prettier/ESLint failure. Drafter special-case: runs npm run format && npm run lint:fix. No LLM.',
  'coordinator'
)
ON CONFLICT (action_type) DO NOTHING;

-- 4. Bump self_repair completion
UPDATE public.harness_components
SET
  completion_pct = 70,
  notes = 'Slice 2 shipped: watchlist broadened to 3 action types (coordinator_await_timeout, deploy_failed, lint_failed). GitHub Actions webhook live. Lint drafter special-case. Slice 3: Sentry SDK trigger source.',
  updated_at = now()
WHERE id = 'harness:self_repair';
