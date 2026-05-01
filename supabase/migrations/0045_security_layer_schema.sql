-- 0045_security_layer_schema.sql
-- Security layer: agent_actions audit log + capability registry + harness_config extension.
-- Spec: docs/harness/SECURITY_LAYER_SPEC.md (APPROVED 2026-04-28).
-- Component: harness:security_layer (T3, weight 7). Bumps completion 30 → 70.
--
-- Sections:
--   1. agent_actions          (M2) — append-only audit log + AD7 GRANT lockdown
--   2. capability_registry    (M4) — canonical cap strings + AD7 lockdown + seed
--   3. agent_capabilities     (M4) — per-agent grants + AD7 lockdown + seed
--   4. harness_config         (M3) — column extension + AD7 column-level GRANT
--   5. harness_components     — bump security_layer completion 30 → 70
--
-- AD7 enforcement boundary: Postgres GRANT level, deeper than RLS.
--   - service_role bypasses RLS, but does NOT bypass GRANT-level REVOKE.
--   - All four protected tables have REVOKE ALL ... FROM service_role applied,
--     then minimum-necessary GRANTs added back.
--   - postgres role (which runs migrations) retains full access. The migration
--     itself proves postgres can write — no acceptance test needed for that path.
--
-- Pre-checks (run manually before applying):
--   SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='harness_components'; -- expect 1
--   SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='harness_config';     -- expect 1
--
-- Dependency note: this migration does NOT depend on 0044 (memory layer / decisions_log).
-- The decisions_log INSERT recording this spec's decision is deferred to a follow-on
-- migration once 0044 lands.
--
-- Verify post-apply:
--   SELECT COUNT(*) FROM capability_registry;        -- expect 34
--   SELECT COUNT(*) FROM agent_capabilities;         -- expect 41 (16 coordinator + 25 builder, all explicit)
--   SELECT completion_pct FROM harness_components WHERE id='harness:security_layer'; -- expect 70

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. agent_actions — append-only audit log (M2 + AD7)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.agent_actions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Who / What / Scope
  agent_id        TEXT         NOT NULL,
  capability      TEXT         NOT NULL,
  target          TEXT,

  -- Categorization
  action_type     TEXT         NOT NULL
                  CHECK (action_type IN (
                    'cap_check',
                    'secret_read',
                    'destructive_op',
                    'sandbox_check',
                    'override'
                  )),

  -- Outcome
  result          TEXT         NOT NULL
                  CHECK (result IN (
                    'allowed',
                    'allowed_log_only',
                    'allowed_warn',
                    'denied',
                    'error'
                  )),
  reason          TEXT         NOT NULL,
  enforcement_mode TEXT        NOT NULL
                  CHECK (enforcement_mode IN ('log_only','warn','enforce')),

  -- Context
  context         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  parent_action_id UUID        REFERENCES public.agent_actions(id) ON DELETE NO ACTION,

  -- Generated FTS — operators can grep narratively
  fts             tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(agent_id,'') || ' ' ||
      coalesce(capability,'') || ' ' ||
      coalesce(target,'') || ' ' ||
      coalesce(reason,'') || ' ' ||
      coalesce(context::text,'')
    )
  ) STORED
);

CREATE INDEX agent_actions_recent_idx     ON public.agent_actions (occurred_at DESC);
CREATE INDEX agent_actions_agent_idx      ON public.agent_actions (agent_id, occurred_at DESC);
CREATE INDEX agent_actions_capability_idx ON public.agent_actions (capability, occurred_at DESC);
CREATE INDEX agent_actions_denied_idx     ON public.agent_actions (occurred_at DESC) WHERE result = 'denied';
CREATE INDEX agent_actions_secret_idx     ON public.agent_actions (occurred_at DESC) WHERE action_type = 'secret_read';
CREATE INDEX agent_actions_fts_idx        ON public.agent_actions USING GIN (fts);

-- RLS: defense-in-depth. SELECT + INSERT for authenticated; no UPDATE/DELETE policies.
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_actions_insert" ON public.agent_actions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "agent_actions_select" ON public.agent_actions
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- AD7: GRANT-level append-only contract. Service_role gets NO exception.
REVOKE ALL ON public.agent_actions FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT, INSERT ON public.agent_actions TO authenticated, service_role;
-- No GRANT UPDATE. No GRANT DELETE. Postgres (migrations) keeps full access by default.

COMMENT ON TABLE public.agent_actions IS
  'Append-only audit log for security-relevant events: capability checks, secret reads, '
  'destructive ops, sandbox checks, manual overrides. AD7: service_role can SELECT + INSERT '
  'only — no UPDATE, no DELETE. Modifications require a postgres-role migration.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. capability_registry — canonical capability strings (M4 + AD7)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.capability_registry (
  capability          TEXT         PRIMARY KEY,
  domain              TEXT         NOT NULL
                      CHECK (domain IN ('fs','net','db','shell','git','secret','sandbox')),
  description         TEXT         NOT NULL,
  default_enforcement TEXT         NOT NULL DEFAULT 'log_only'
                      CHECK (default_enforcement IN ('log_only','warn','enforce')),
  destructive         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE public.capability_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "capability_registry_select" ON public.capability_registry
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- AD7: registry is migration-only. Runtime can read but never write.
REVOKE ALL ON public.capability_registry FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT ON public.capability_registry TO authenticated, service_role;

COMMENT ON TABLE public.capability_registry IS
  'Canonical capability strings the system knows about. AD7: read-only for service_role; '
  'writes (new capabilities) require a postgres-role migration.';

-- Seed the registry. ~34 rows covering fs/net/db/shell/git/secret/sandbox domains.
INSERT INTO public.capability_registry (capability, domain, description, default_enforcement, destructive) VALUES
  -- db (10)
  ('db.read.*',                              'db',     'Read any table in public schema',                                'log_only', FALSE),
  ('db.read.knowledge',                      'db',     'SELECT on knowledge table',                                       'log_only', FALSE),
  ('db.read.agent_events',                   'db',     'SELECT on agent_events table',                                    'log_only', FALSE),
  ('db.read.task_queue',                     'db',     'SELECT on task_queue table',                                      'log_only', FALSE),
  ('db.write.agent_events',                  'db',     'INSERT/UPDATE on agent_events',                                   'log_only', FALSE),
  ('db.write.task_queue',                    'db',     'INSERT/UPDATE on task_queue',                                     'log_only', FALSE),
  ('db.write.outbound_notifications',        'db',     'INSERT on outbound_notifications',                                'log_only', FALSE),
  ('db.write.session_handoffs',              'db',     'INSERT/UPDATE on session_handoffs',                               'log_only', FALSE),
  ('db.write.agent_actions',                 'db',     'INSERT on agent_actions (informational; GRANT layer is the real boundary)', 'log_only', FALSE),
  ('db.migrate',                             'db',     'Apply schema migration via mcp__Supabase__apply_migration',       'log_only', TRUE),

  -- fs (3)
  ('fs.read',                                'fs',     'Read any file within repo root',                                  'log_only', FALSE),
  ('fs.write',                               'fs',     'Write/create any file within repo root (target_pattern narrows)', 'log_only', FALSE),
  ('fs.delete',                              'fs',     'Delete any file within repo root',                                'log_only', TRUE),

  -- net (6)
  ('net.outbound.*',                         'net',    'Wildcard outbound HTTP — broad grant, generally avoided',         'log_only', FALSE),
  ('net.outbound.telegram',                  'net',    'Telegram Bot API outbound',                                       'log_only', FALSE),
  ('net.outbound.vercel.deploy',             'net',    'Vercel deploy/promote API',                                       'log_only', TRUE),
  ('net.outbound.vercel.read',               'net',    'Vercel read-only API (deployments list, logs)',                   'log_only', FALSE),
  ('net.outbound.supabase',                  'net',    'Supabase REST/RPC outbound',                                      'log_only', FALSE),
  ('net.outbound.anthropic',                 'net',    'Anthropic API (Claude completions)',                              'log_only', FALSE),

  -- shell (1)
  ('shell.run',                              'shell',  'Run a shell command (allowlist enforced separately by push_bash_automation #13)', 'log_only', FALSE),

  -- git (4)
  ('git.commit',                             'git',    'Create a git commit',                                             'log_only', FALSE),
  ('git.push',                               'git',    'Push to remote (non-force)',                                      'log_only', FALSE),
  ('git.force_push',                         'git',    'Force-push (rewrites remote history)',                            'log_only', TRUE),
  ('git.branch',                             'git',    'Create/switch branch',                                            'log_only', FALSE),

  -- secret (7)
  ('secret.read.*',                          'secret', 'Read any secret from harness_config — broad, avoid',              'log_only', FALSE),
  ('secret.read.SUPABASE_SERVICE_ROLE_KEY',  'secret', 'Read Supabase service role key',                                  'log_only', FALSE),
  ('secret.read.CRON_SECRET',                'secret', 'Read CRON_SECRET (heartbeat auth)',                               'log_only', FALSE),
  ('secret.read.TELEGRAM_BOT_TOKEN_ALERTS',  'secret', 'Read Telegram alerts bot token',                                  'log_only', FALSE),
  ('secret.read.TELEGRAM_BOT_TOKEN_BUILDER', 'secret', 'Read Telegram builder/trigger bot token',                         'log_only', FALSE),
  ('secret.read.TELEGRAM_BOT_TOKEN_DAILY',   'secret', 'Read Telegram daily bot token',                                   'log_only', FALSE),
  ('secret.read.TELEGRAM_CHAT_ID',           'secret', 'Read Colin Telegram chat id (non-secret but tracked uniformly)',  'log_only', FALSE),

  -- sandbox (3)
  ('sandbox.create',                         'sandbox','Create a new sandbox (worktree / Docker / preview deploy)',       'log_only', FALSE),
  ('sandbox.execute',                        'sandbox','Execute code inside an existing sandbox',                          'log_only', FALSE),
  ('sandbox.escape',                         'sandbox','Bring sandbox results out — escalates per AD2',                    'log_only', TRUE);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. agent_capabilities — per-agent grants (M4 + AD7)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.agent_capabilities (
  agent_id          TEXT         NOT NULL,
  capability        TEXT         NOT NULL REFERENCES public.capability_registry(capability) ON DELETE RESTRICT,
  enforcement_mode  TEXT         NOT NULL
                    CHECK (enforcement_mode IN ('log_only','warn','enforce')),
  target_pattern    TEXT,                                          -- POSIX regex; NULL = no target restriction
  granted_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  granted_by        TEXT         NOT NULL DEFAULT 'colin',
  reason            TEXT,
  PRIMARY KEY (agent_id, capability)
);

CREATE INDEX agent_capabilities_agent_idx ON public.agent_capabilities (agent_id);

ALTER TABLE public.agent_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_capabilities_select" ON public.agent_capabilities
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- AD7: grants are migration-only. Critical: an agent with db.write on this table could
-- self-grant any capability. The REVOKE here closes that attack vector at the DB layer.
REVOKE ALL ON public.agent_capabilities FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT ON public.agent_capabilities TO authenticated, service_role;

COMMENT ON TABLE public.agent_capabilities IS
  'Per-agent capability grants. AD7: read-only for service_role. New grants require a '
  'postgres-role migration with PR review and CI gate. Self-grant attack vector closed '
  'structurally at the GRANT level.';

-- Seed grants for coordinator (16 grants).
INSERT INTO public.agent_capabilities (agent_id, capability, enforcement_mode, target_pattern, reason) VALUES
  ('coordinator', 'db.read.*',                       'log_only', NULL, 'broad reads needed for sprint planning + acceptance audits'),
  ('coordinator', 'db.write.agent_events',           'log_only', NULL, 'log heartbeats, escalations, branch_guard_triggered'),
  ('coordinator', 'db.write.task_queue',             'log_only', NULL, 'claim/release tasks, queue follow-ons'),
  ('coordinator', 'db.write.outbound_notifications', 'log_only', NULL, 'enqueue Telegram messages'),
  ('coordinator', 'db.write.session_handoffs',       'log_only', NULL, 'persist phase handoffs'),
  ('coordinator', 'fs.read',                         'log_only', NULL, 'read any file for Phase 1a Streamlit study + grounding'),
  ('coordinator', 'fs.write',                        'log_only', '^docs/(sprint-[a-zA-Z0-9-]+|harness|decisions|handoffs)/', 'write acceptance docs, study docs, decision logs only'),
  ('coordinator', 'net.outbound.telegram',           'log_only', NULL, 'send escalations and approval prompts'),
  ('coordinator', 'net.outbound.vercel.read',        'log_only', NULL, 'inspect deployments to confirm builder ships landed'),
  ('coordinator', 'net.outbound.supabase',           'log_only', NULL, 'read harness_config + run SQL via MCP'),
  ('coordinator', 'net.outbound.anthropic',          'log_only', NULL, 'invoke Twin Q&A via /api/twin/ask'),
  ('coordinator', 'secret.read.CRON_SECRET',         'log_only', NULL, 'heartbeat auth'),
  ('coordinator', 'secret.read.TELEGRAM_CHAT_ID',    'log_only', NULL, 'notification routing'),
  ('coordinator', 'shell.run',                       'log_only', NULL, 'run git status, npm test, etc.; allowlist gated by push_bash_automation'),
  ('coordinator', 'git.commit',                      'log_only', NULL, 'commit doc edits (acceptance docs, study docs)'),
  ('coordinator', 'git.branch',                      'log_only', NULL, 'create harness/task-{id} branches per coordinator NN');

-- Seed grants for builder (16 coordinator-equivalents + 11 builder-only = 27 builder rows total,
-- but builder shares some caps with coordinator; we explicitly list all builder grants for clarity).
INSERT INTO public.agent_capabilities (agent_id, capability, enforcement_mode, target_pattern, reason) VALUES
  -- Reads + writes shared with coordinator
  ('builder', 'db.read.*',                           'log_only', NULL, 'read schema for Check-Before-Build + grep-for-existing-patterns'),
  ('builder', 'db.write.agent_events',               'log_only', NULL, 'log build steps, test results, deploy markers'),
  ('builder', 'db.write.task_queue',                 'log_only', NULL, 'update task status (in_progress, awaiting_grounding, etc.)'),
  ('builder', 'db.write.outbound_notifications',     'log_only', NULL, 'enqueue Telegram messages on deploy / failure'),
  ('builder', 'db.write.session_handoffs',           'log_only', NULL, 'write handoff JSON per chunk'),
  ('builder', 'db.write.agent_actions',              'log_only', NULL, 'informational; GRANT layer is the real INSERT permission'),

  -- Migrations + filesystem (broader than coordinator)
  ('builder', 'db.migrate',                          'log_only', NULL, 'apply schema migrations via mcp__Supabase__apply_migration'),
  ('builder', 'fs.read',                             'log_only', NULL, 'full repo read access'),
  ('builder', 'fs.write',                            'log_only', NULL, 'full repo write — bounded only by acceptance doc files-changed list'),
  ('builder', 'fs.delete',                           'log_only', NULL, 'rare; only when acceptance doc explicitly authorizes file removal'),

  -- Network (deploy added)
  ('builder', 'net.outbound.telegram',               'log_only', NULL, 'send build/deploy progress'),
  ('builder', 'net.outbound.vercel.deploy',          'log_only', NULL, 'trigger production deploy after preview approval'),
  ('builder', 'net.outbound.vercel.read',            'log_only', NULL, 'check deployment status'),
  ('builder', 'net.outbound.supabase',               'log_only', NULL, 'execute SQL via MCP'),
  ('builder', 'net.outbound.anthropic',              'log_only', NULL, 'rare; only via Twin if needed for clarification'),

  -- Shell + git (push added; force_push intentionally absent)
  ('builder', 'shell.run',                           'log_only', NULL, 'run npm test, git, vercel CLI — allowlist gated by push_bash_automation'),
  ('builder', 'git.commit',                          'log_only', NULL, 'commit code + tests'),
  ('builder', 'git.push',                            'log_only', NULL, 'push to harness/task-{id} branch — never force'),
  ('builder', 'git.branch',                          'log_only', NULL, 'switch branches as needed'),

  -- Secrets (full operational set)
  ('builder', 'secret.read.SUPABASE_SERVICE_ROLE_KEY','log_only', NULL, 'createServiceClient at module init'),
  ('builder', 'secret.read.CRON_SECRET',             'log_only', NULL, 'heartbeat auth + cron-protected route calls'),
  ('builder', 'secret.read.TELEGRAM_CHAT_ID',        'log_only', NULL, 'notification routing'),
  ('builder', 'secret.read.TELEGRAM_BOT_TOKEN_ALERTS','log_only', NULL, 'send health/incident alerts'),
  ('builder', 'secret.read.TELEGRAM_BOT_TOKEN_BUILDER','log_only', NULL, 'send build/deploy notifications'),
  ('builder', 'secret.read.TELEGRAM_BOT_TOKEN_DAILY', 'log_only', NULL, 'send morning_digest');

-- Note: scout, reviewer, deployer are NOT seeded. Their grants land when their .md files do.
-- Coordinator NN: when adding a new agent, the migration that ships the agent file MUST also
-- ship its agent_capabilities INSERTs. Frontmatter ↔ DB parity test (acceptance E) catches drift.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. harness_config — column extension + AD7 column-level GRANT (M3)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.harness_config
  ADD COLUMN IF NOT EXISTS description       TEXT,
  ADD COLUMN IF NOT EXISTS last_accessed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS access_count      INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.harness_config.description       IS 'Human-readable purpose of this key. Backfilled lazily as keys are touched.';
COMMENT ON COLUMN public.harness_config.last_accessed_at  IS 'Updated by lib/security/secrets.get() on each read. Service_role-writable via column-level GRANT (AD7).';
COMMENT ON COLUMN public.harness_config.access_count      IS 'Monotonic counter, bumped by lib/security/secrets.get() on each read.';

-- AD7: lockdown harness_config writes. Runtime can read everything; only the tracking
-- columns are writable from service_role. The actual `value` column (the secret content)
-- requires a postgres-role migration to mutate. Rotation = new migration, not runtime UPDATE.
REVOKE ALL ON public.harness_config FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT ON public.harness_config TO service_role;
GRANT UPDATE (last_accessed_at, access_count) ON public.harness_config TO service_role;
-- INSERT, full UPDATE, DELETE: postgres role only.
-- Authenticated and anon: zero access — preserves the lockdown from migration 0029.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Bump security_layer completion_pct 30 → 70
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.harness_components
SET
  completion_pct = 70,
  notes = COALESCE(notes,'') || ' [0045: agent_actions audit log + capability registry + harness_config column extension + AD7 GRANT-level self-protection]',
  updated_at = NOW()
WHERE id = 'harness:security_layer';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (commented — destructive; require explicit Colin approval)
-- ─────────────────────────────────────────────────────────────────────────────
-- Note: dropping agent_actions destroys audit history. Roll back only when explicitly
-- authorized; the audit trail itself does not survive rollback.
--
-- UPDATE public.harness_components SET completion_pct = 30 WHERE id = 'harness:security_layer';
--
-- ALTER TABLE public.harness_config DROP COLUMN IF EXISTS access_count;
-- ALTER TABLE public.harness_config DROP COLUMN IF EXISTS last_accessed_at;
-- ALTER TABLE public.harness_config DROP COLUMN IF EXISTS description;
-- (Restore the original 0029 grants if needed; defaults are sufficient for roll-forward.)
--
-- DROP TABLE IF EXISTS public.agent_capabilities;
-- DROP TABLE IF EXISTS public.capability_registry;
-- DROP TABLE IF EXISTS public.agent_actions;
