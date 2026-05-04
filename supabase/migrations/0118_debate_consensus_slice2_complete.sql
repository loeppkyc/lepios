-- debate_consensus Slice 2: wired into deploy_gate + self_repair auto-suspend

UPDATE public.harness_components
SET
  completion_pct = 100,
  notes = 'Slice 2 shipped: runConsensus() wired into sendMigrationGateMessage (advisory consensus in Telegram review message) and checkAndAutoSuspend (split consensus blocks auto-suspend, escalates to Colin). debate_consensus complete.',
  updated_at = now()
WHERE id = 'harness:debate_consensus';
