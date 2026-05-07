-- 0159_harness_resource_budgets.sql
-- Resource budget tracker — central registry of platform/code/db ceilings.
-- Companion to scripts/check-budgets.mjs (pre-commit hook) and the
-- (future) sync-resource-budgets job that refreshes external counts.
--
-- Why: silent resource contention (Vercel cron-count, env-var ceiling,
-- RLS policy explosion) has caused multiple incidents (F-L11/F-N9 cron
-- limit, F-L7 quota cliff). Each one was discovered after the fact.
-- A single registry that pre-commit hooks read against + morning_digest
-- surfaces against gives Colin one place to ask "am I close to a limit?"
--
-- Status is computed at read time (no GENERATED column):
--   at_limit  if current_count >= max_count
--   warning   if current_count >= max_count * 0.85
--   ok        otherwise
--
-- Verify post-apply:
--   SELECT key, current_count, max_count, source FROM harness_resource_budgets ORDER BY key;
--   -- Expect 3 seed rows: vercel.crons, package.deps_total, vercel.env_vars

CREATE TABLE public.harness_resource_budgets (
  key            TEXT         PRIMARY KEY,
  current_count  INT          NOT NULL DEFAULT 0,
  max_count      INT          NOT NULL CHECK (max_count > 0),
  source         TEXT         NOT NULL,
  category       TEXT         NOT NULL CHECK (category IN ('platform', 'code', 'db', 'harness')),
  last_checked   TIMESTAMPTZ,
  note           TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE public.harness_resource_budgets ENABLE ROW LEVEL SECURITY;
-- Same posture as harness_config: anon + authenticated locked out, service
-- role bypasses RLS for syncs and morning_digest reads.

-- Seed three budgets — the v1 set covered by the pre-commit gate
-- (file-resident) plus one externally-synced placeholder.
INSERT INTO public.harness_resource_budgets
  (key, current_count, max_count, source, category, note)
VALUES
  (
    'vercel.crons',
    0,
    18,
    'file:vercel.json',
    'platform',
    'Vercel Hobby plan ceiling. F-L11/F-N9: 19+ crons silently rejected at validation. See scripts/check-vercel-cron-count.mjs.'
  ),
  (
    'package.deps_total',
    0,
    300,
    'file:package.json',
    'code',
    'Combined dependencies + devDependencies count. Soft ceiling — bloat slows CI + tree-shaking. Tune up if a real need emerges.'
  ),
  (
    'vercel.env_vars',
    0,
    100,
    'external:vercel_api',
    'platform',
    'Vercel project env var count. Synced via sync-resource-budgets job (future) — current_count stays 0 until that ships.'
  );
