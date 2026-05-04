-- 0103_specialized_agents_complete.sql
-- Specialized agents: reviewer + planner + deployer
-- Ships .claude/agents/reviewer.md, planner.md, deployer.md
-- Bumps harness:specialized_agents 55 → 100%
--
-- Verify post-apply:
--   SELECT agent_id, COUNT(*) FROM agent_capabilities
--   WHERE agent_id IN ('reviewer','planner','deployer') GROUP BY agent_id;
--   -- expects: reviewer 3 rows, planner 3 rows, deployer 9 rows

-- ── New capability: git.read (missing from registry) ─────────────────────────
INSERT INTO public.capability_registry (capability, domain, description, default_enforcement, destructive)
VALUES ('git.read', 'git', 'Read git state — diff, log, status (non-destructive)', 'log_only', false)
ON CONFLICT (capability) DO NOTHING;

-- ── Reviewer capabilities ──────────────────────────────────────────────────────
-- Pre-commit hook + /review command: reads files, calls Anthropic, reads git state

INSERT INTO public.agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES
  ('reviewer', 'fs.read',                'log_only', 'colin', 'reviewer — read files and migration history for checklist items 8-9'),
  ('reviewer', 'net.outbound.anthropic', 'log_only', 'colin', 'reviewer — call Sonnet on staged diff'),
  ('reviewer', 'git.read',              'log_only', 'colin', 'reviewer — git diff --cached for staged changes');

-- ── Planner capabilities ───────────────────────────────────────────────────────
-- Research-and-structure agent: reads codebase + schema, produces implementation plan

INSERT INTO public.agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES
  ('planner', 'fs.read',              'log_only', 'colin', 'planner — read source files, migrations, docs for grounded planning'),
  ('planner', 'db.read.*',            'log_only', 'colin', 'planner — query information_schema and harness_components'),
  ('planner', 'net.outbound.supabase','log_only', 'colin', 'planner — verify table/column names before citing them in plan');

-- ── Deployer capabilities ──────────────────────────────────────────────────────
-- Post-build pipeline: apply migrations, verify Vercel deploy, smoke test, telegram

INSERT INTO public.agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES
  ('deployer', 'db.read.*',                    'log_only', 'colin', 'deployer — check pending migrations via schema_migrations'),
  ('deployer', 'db.migrate',                   'log_only', 'colin', 'deployer — apply pending migrations after builder commits'),
  ('deployer', 'db.write.agent_events',        'log_only', 'colin', 'deployer — log deploy.complete and deploy.failed events'),
  ('deployer', 'net.outbound.vercel.deploy',   'log_only', 'colin', 'deployer — trigger and poll Vercel deployments'),
  ('deployer', 'net.outbound.vercel.read',     'log_only', 'colin', 'deployer — read deployment status and build logs'),
  ('deployer', 'net.outbound.telegram',        'log_only', 'colin', 'deployer — notify Colin on deploy success/failure'),
  ('deployer', 'net.outbound.supabase',        'log_only', 'colin', 'deployer — apply migrations via Supabase MCP'),
  ('deployer', 'shell.run',                   'log_only', 'colin', 'deployer — run npm test before deploy'),
  ('deployer', 'secret.read.CRON_SECRET',     'enforce',  'colin', 'deployer — auth for harness endpoints during smoke tests');

-- ── Rollup bump: specialized_agents 55 → 100% ─────────────────────────────────
-- coordinator + builder (55%) + reviewer + planner + deployer = 100%
-- All 5 agent spec files now exist in .claude/agents/

UPDATE public.harness_components
SET completion_pct = 100,
    notes          = 'All 5 agent specs shipped: coordinator, builder, reviewer, planner, deployer.',
    updated_at     = NOW()
WHERE id = 'harness:specialized_agents';
