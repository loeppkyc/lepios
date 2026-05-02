-- 0062_capability_registry_self_repair.sql
-- Extend capability_registry with missing caps needed for self_repair + arms_legs S2.
--
-- (1) Add 'tool' to domain CHECK — self_repair caps don't fit fs/net/db/shell/git/secret/sandbox.
-- (2) Seed missing net.outbound.github + net.outbound.openai caps.
-- (3) Seed sandbox.run (simpler alias alongside sandbox.create/execute).
-- (4) Seed tool.self_repair.* caps (3 rows) per SELF_REPAIR_SPEC §AD6.
--
-- AD7: capability_registry is SELECT-only for service_role (enforced in 0045).
-- This migration runs as postgres role — the only write path to these tables by design.
--
-- Verify post-apply:
--   SELECT COUNT(*) FROM capability_registry; -- expect 40 (34 + 6 new)
--   SELECT capability FROM capability_registry WHERE domain = 'tool' ORDER BY capability;

-- (1) Extend domain CHECK to include 'tool'
ALTER TABLE public.capability_registry
  DROP CONSTRAINT capability_registry_domain_check;

ALTER TABLE public.capability_registry
  ADD CONSTRAINT capability_registry_domain_check
  CHECK (domain IN ('fs','net','db','shell','git','secret','sandbox','tool'));

-- (2–4) Insert missing capabilities
INSERT INTO public.capability_registry (capability, domain, description, default_enforcement, destructive) VALUES
  ('net.outbound.github',                   'net',  'GitHub REST API outbound (PRs, refs, commits)',                          'log_only', FALSE),
  ('net.outbound.openai',                   'net',  'OpenAI API outbound (embeddings or completions)',                        'log_only', FALSE),
  ('sandbox.run',                           'sandbox', 'Execute a command inside an existing sandbox worktree',               'log_only', FALSE),
  ('tool.self_repair.read.agent_events',    'tool', 'self_repair: SELECT on agent_events to detect failure patterns',        'log_only', FALSE),
  ('tool.self_repair.draft_fix',            'tool', 'self_repair: invoke Claude Sonnet to draft a unified diff fix',         'log_only', FALSE),
  ('tool.self_repair.open_pr',              'tool', 'self_repair: open a GitHub PR containing the drafted fix',              'log_only', TRUE);

-- Rollback (destructive — drops 6 rows and the constraint change; require explicit approval):
-- DELETE FROM public.capability_registry WHERE capability IN (
--   'net.outbound.github','net.outbound.openai','sandbox.run',
--   'tool.self_repair.read.agent_events','tool.self_repair.draft_fix','tool.self_repair.open_pr'
-- );
-- ALTER TABLE public.capability_registry DROP CONSTRAINT capability_registry_domain_check;
-- ALTER TABLE public.capability_registry ADD CONSTRAINT capability_registry_domain_check
--   CHECK (domain IN ('fs','net','db','shell','git','secret','sandbox'));
