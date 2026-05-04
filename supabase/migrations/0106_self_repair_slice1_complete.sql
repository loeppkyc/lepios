-- 0106_self_repair_slice1_complete.sql
-- Bumps self_repair from 46% → 55% after completing slice 1 acceptance criteria:
-- AC-D: circuit-open defer (self_repair.circuit_open_defer event logged, runs row not created)
-- AC-K2: auto-suspend after 3 consecutive closed-without-merge PRs in detectNextFailure()
-- AC-I: morning digest line already wired in lib/orchestrator/digest.ts (no code change needed)
-- Remaining 45%: slice 2 (broader watchlist), Sentry integration, GitHub webhook, confidence scoring

UPDATE public.harness_components
SET    completion_pct = 55,
       notes          = 'Slice 1 complete: detect→draft→verify→PR + circuit defer (AC-D) + K2 auto-suspend'
WHERE  id = 'harness:self_repair';
