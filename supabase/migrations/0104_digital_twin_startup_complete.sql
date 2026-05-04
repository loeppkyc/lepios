-- 0104_digital_twin_startup_complete.sql
-- Digital Twin chunk #6: /startup skill integration.
-- Wires buildSessionDigest() into the global /startup skill so every LepiOS
-- session opens with active ideas, recent decisions, events, and open tasks
-- injected into the briefing context.
--
-- Implementation: ~/.claude/commands/startup.md (step 6, shipped in this PR).
-- No new routes or tables — uses existing GET /api/memory/session-digest endpoint.
--
-- Verify post-apply:
--   SELECT completion_pct, notes FROM harness_components WHERE id = 'harness:digital_twin';
--   -- expects: completion_pct = 100

UPDATE public.harness_components
SET completion_pct = 100,
    notes          = 'All 6 chunks shipped: knowledge store, handoffs, safety agent, scoring dashboard, session_digest (table + API + chat injection), /startup integration.',
    updated_at     = NOW()
WHERE id = 'harness:digital_twin';
