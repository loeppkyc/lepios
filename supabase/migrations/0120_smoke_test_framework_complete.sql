-- smoke_test_framework Slice 1: morning_digest line

UPDATE public.harness_components
SET
  completion_pct = 100,
  notes = 'Slice 1 shipped: buildDeploySmokeStatsLine() in lib/harness/smoke-tests/digest.ts, wired into morning_digest after selfRepairDigestLine. Queries production_smoke_complete events in last 24h. smoke_test_framework complete.',
  updated_at = now()
WHERE id = 'harness:smoke_test_framework';
