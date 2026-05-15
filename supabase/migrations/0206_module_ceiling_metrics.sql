-- F18 Ceiling Metric Layer — module_ceiling_metrics
-- chunk: f18-ceiling
-- task_id: e1d3c848-ce4f-4d9d-a4f2-1f8eb6585d5c
-- acceptance_doc: docs/sprint-5/f18-ceiling-acceptance.md
-- approved: 2026-05-10T03:04:49Z (Colin via Telegram)

CREATE TABLE public.module_ceiling_metrics (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  module                 TEXT         NOT NULL,
  metric_name            TEXT         NOT NULL,
  metric_unit            TEXT,
  current_value          NUMERIC,
  benchmark_value        NUMERIC,
  ceiling_value          NUMERIC,
  ceiling_cause          TEXT         NOT NULL,
  ceiling_cause_category TEXT         NOT NULL CHECK (ceiling_cause_category IN ('money', 'hardware', 'time')),
  ceiling_lift_cost      TEXT,
  ceiling_lift_gain_pct  NUMERIC,
  benchmark_source       TEXT         CHECK (benchmark_source IN ('colin-target', 'industry', 'known-good')),
  last_updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  notes                  TEXT,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE public.module_ceiling_metrics ENABLE ROW LEVEL SECURITY;
-- Service role bypasses RLS; anon/authenticated locked out.

-- F24: required grant for service_role write access
GRANT INSERT, UPDATE, DELETE ON public.module_ceiling_metrics TO service_role;

-- Seed: 3 examples (vercel-cron / ollama-embed / twin)
INSERT INTO public.module_ceiling_metrics
  (module, metric_name, metric_unit, current_value, benchmark_value, ceiling_value,
   ceiling_cause, ceiling_cause_category, ceiling_lift_cost, ceiling_lift_gain_pct,
   benchmark_source, notes)
VALUES
  (
    'vercel-cron',
    'Task pickup frequency',
    'runs/day',
    24,
    24,
    24,
    'Vercel Hobby plan: max 1 hourly cron (24 runs/day). Pro plan allows sub-hourly.',
    'money',
    '~$20/month Vercel Pro → continuous cron possible (every 5 min = 288/day)',
    1100,
    'colin-target',
    'Currently at ceiling but benchmark is met. Lift needed only if queue grows beyond 24 tasks/day.'
  ),
  (
    'ollama-embed',
    'Corpus embedding throughput',
    'docs/min',
    10,
    50,
    15,
    'RAM constraint on current hardware limits Ollama parallel inference batch size.',
    'hardware',
    'GPU/RAM upgrade OR switch to cloud embedding API (OpenAI ada-002 ~$0.10/1M tokens)',
    500,
    'colin-target',
    'Weekly re-embed of ~500 docs: at 10 docs/min takes 50 min; at ceiling 15 docs/min = 33 min; at benchmark 50 docs/min = 10 min.'
  ),
  (
    'twin',
    'Self-answer rate',
    '% answered without Colin escalation',
    NULL,
    50,
    75,
    'Corpus density — design-intent questions lack ingested context (sprint acceptance docs, CLAUDE.md entries, architecture decisions).',
    'time',
    'Passive — grows as project generates more ingestible content. Accelerated by ingest-claude-md runs.',
    50,
    'colin-target',
    'current_value NULL until live measurement wired. Ceiling estimate 75% based on gap analysis; time-fixable as corpus matures.'
  );
