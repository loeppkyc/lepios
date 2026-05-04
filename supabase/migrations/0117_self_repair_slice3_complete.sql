-- self_repair Slice 3: Sentry webhook trigger source

-- 1. Seed sentry_error watchlist entry
INSERT INTO public.self_repair_watchlist (action_type, enabled, likely_files, notes, added_by)
VALUES (
  'sentry_error',
  true,
  '{}',
  'Sentry issue alert (level=error or fatal, action=created). Culprit path in agent_events.meta->culprit guides drafter. Requires SENTRY_WEBHOOK_SECRET + Sentry internal integration pointing to /api/webhooks/sentry.',
  'coordinator'
)
ON CONFLICT (action_type) DO NOTHING;

-- 2. Bump completion
UPDATE public.harness_components
SET
  completion_pct = 100,
  notes = 'Slice 3 shipped: Sentry webhook receiver (/api/webhooks/sentry), sentry_error watchlist entry. Full trigger-source triad: agent_events polling (Slice 1), GitHub Actions webhook (Slice 2), Sentry issue alerts (Slice 3). Self-repair complete.',
  updated_at = now()
WHERE id = 'harness:self_repair';
