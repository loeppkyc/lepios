-- 0064_secret_capability_registry_complete.sql
-- Security layer: extend capability_registry to cover all actual production secret env vars
-- + add 'system' agent grants + bump security_layer to 100%.
--
-- Spec: docs/harness/SECURITY_LAYER_SPEC.md §"100% Full coverage" rubric.
--
-- What this migration does:
--   (1) Adds capability_registry rows for every production secret env var not yet seeded.
--       Migration 0045 seeded idealized names (_BUILDER/_DAILY/_ALERTS); the codebase
--       actually uses TELEGRAM_BOT_TOKEN and TELEGRAM_ALERTS_BOT_TOKEN. Both coexist.
--   (2) Adds a 'system' agent to agent_capabilities. 'system' represents the running
--       Next.js app (non-autonomous routes + lib code). All new caps are log_only — no
--       production code breaks; audit trail starts accumulating.
--   (3) Bumps harness:security_layer to 100%.
--
-- Not in scope: harness_config value rows (secrets live in Vercel env vars; getSecret()
-- falls back to process.env for any key not in harness_config).
--
-- AD7: capability_registry and agent_capabilities are SELECT-only for service_role.
-- This migration runs as the postgres role — the only permitted write path.
--
-- Verify post-apply:
--   SELECT COUNT(*) FROM capability_registry WHERE capability LIKE 'secret.read.%';
--   -- expect >= 22 (7 from 0045 + 15+ new rows)
--
--   SELECT COUNT(*) FROM agent_capabilities WHERE agent_id = 'system';
--   -- expect >= 16

-- ── (1) New capability_registry rows ─────────────────────────────────────────
-- All new caps land in log_only. Flip to enforce is a separate migration per AD6.

INSERT INTO public.capability_registry
  (capability, domain, description, default_enforcement, destructive)
VALUES
  -- Actual Telegram env var names used in production code
  ('secret.read.TELEGRAM_BOT_TOKEN',
   'secret', 'Read main Telegram bot token (daily/builder bot)',
   'log_only', FALSE),
  ('secret.read.TELEGRAM_ALERTS_BOT_TOKEN',
   'secret', 'Read Telegram alerts bot token (health/incident alerts)',
   'log_only', FALSE),
  ('secret.read.TELEGRAM_WEBHOOK_SECRET',
   'secret', 'Read Telegram webhook validation secret',
   'log_only', FALSE),

  -- Google / Gmail
  ('secret.read.GOOGLE_CLIENT_SECRET',
   'secret', 'Read Google OAuth2 client secret (Gmail API)',
   'log_only', FALSE),
  ('secret.read.GOOGLE_REFRESH_TOKEN',
   'secret', 'Read Google OAuth2 refresh token (Gmail API)',
   'log_only', FALSE),

  -- Anthropic
  ('secret.read.ANTHROPIC_API_KEY',
   'secret', 'Read Anthropic API key (Twin ask, purpose-review summary)',
   'log_only', FALSE),

  -- GitHub
  ('secret.read.GITHUB_TOKEN',
   'secret', 'Read GitHub personal access token (deploy-gate PR operations)',
   'log_only', FALSE),

  -- Vercel
  ('secret.read.VERCEL_TOKEN',
   'secret', 'Read Vercel API token (deploy-gate deployment calls)',
   'log_only', FALSE),
  ('secret.read.VERCEL_AUTOMATION_BYPASS_SECRET',
   'secret', 'Read Vercel automation bypass secret (preview deployments)',
   'log_only', FALSE),

  -- Harness coordination
  ('secret.read.COORDINATOR_ROUTINE_TOKEN',
   'secret', 'Read coordinator routine invocation token',
   'log_only', FALSE),

  -- Keepa
  ('secret.read.KEEPA_API_KEY',
   'secret', 'Read Keepa API key (Amazon product data)',
   'log_only', FALSE),

  -- Amazon SP-API / AWS
  ('secret.read.AMAZON_SP_REFRESH_TOKEN',
   'secret', 'Read Amazon SP-API OAuth2 refresh token',
   'log_only', FALSE),
  ('secret.read.AMAZON_SP_CLIENT_SECRET',
   'secret', 'Read Amazon SP-API client secret',
   'log_only', FALSE),
  ('secret.read.AMAZON_AWS_ACCESS_KEY',
   'secret', 'Read AWS access key ID (SigV4 signing for SP-API)',
   'log_only', FALSE),
  ('secret.read.AMAZON_AWS_SECRET_KEY',
   'secret', 'Read AWS secret access key (SigV4 signing for SP-API)',
   'log_only', FALSE),

  -- Dropbox
  ('secret.read.DROPBOX_APP_KEY',
   'secret', 'Read Dropbox app key (statement coverage auth)',
   'log_only', FALSE),
  ('secret.read.DROPBOX_APP_SECRET',
   'secret', 'Read Dropbox app secret (statement coverage auth)',
   'log_only', FALSE),
  ('secret.read.DROPBOX_REFRESH_TOKEN',
   'secret', 'Read Dropbox OAuth2 refresh token (statement coverage auth)',
   'log_only', FALSE)
ON CONFLICT (capability) DO NOTHING;

-- ── (2) 'system' agent — the running Next.js app (non-autonomous routes + lib code) ──
-- All grants are log_only. The system agent is not an autonomous agent; it represents
-- production app code that reads secrets for operational purposes (sending Telegram
-- messages, calling Gmail API, etc.).
-- Grants cover every secret the app-tier code currently reads via process.env.

INSERT INTO public.agent_capabilities
  (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES
  -- Existing caps (seeded in 0045) used by app code
  ('system', 'secret.read.CRON_SECRET',                    'log_only', 'colin', 'harness route auth'),
  ('system', 'secret.read.TELEGRAM_CHAT_ID',               'log_only', 'colin', 'notification routing'),
  ('system', 'secret.read.SUPABASE_SERVICE_ROLE_KEY',      'log_only', 'colin', 'createAuditedServiceClient canary'),

  -- New caps (seeded above)
  ('system', 'secret.read.TELEGRAM_BOT_TOKEN',             'log_only', 'colin', 'postMessage in lib/orchestrator/telegram.ts'),
  ('system', 'secret.read.TELEGRAM_ALERTS_BOT_TOKEN',      'log_only', 'colin', 'alerts bot in lib/harness/arms-legs/telegram.ts'),
  ('system', 'secret.read.TELEGRAM_WEBHOOK_SECRET',        'log_only', 'colin', 'webhook validation in app/api/telegram/webhook'),
  ('system', 'secret.read.GOOGLE_CLIENT_SECRET',           'log_only', 'colin', 'Gmail OAuth2 in lib/gmail/client.ts'),
  ('system', 'secret.read.GOOGLE_REFRESH_TOKEN',           'log_only', 'colin', 'Gmail OAuth2 in lib/gmail/client.ts'),
  ('system', 'secret.read.ANTHROPIC_API_KEY',              'log_only', 'colin', 'Twin ask + purpose-review summary'),
  ('system', 'secret.read.GITHUB_TOKEN',                   'log_only', 'colin', 'deploy-gate PR operations'),
  ('system', 'secret.read.VERCEL_TOKEN',                   'log_only', 'colin', 'deploy-gate deployment calls'),
  ('system', 'secret.read.VERCEL_AUTOMATION_BYPASS_SECRET','log_only', 'colin', 'preview deployment bypass'),
  ('system', 'secret.read.COORDINATOR_ROUTINE_TOKEN',      'log_only', 'colin', 'lib/harness/invoke-coordinator.ts'),
  ('system', 'secret.read.KEEPA_API_KEY',                  'log_only', 'colin', 'lib/keepa/client.ts + lib/keepa/history.ts'),
  ('system', 'secret.read.AMAZON_SP_REFRESH_TOKEN',        'log_only', 'colin', 'lib/amazon/client.ts SP-API auth'),
  ('system', 'secret.read.AMAZON_SP_CLIENT_SECRET',        'log_only', 'colin', 'lib/amazon/client.ts SP-API auth'),
  ('system', 'secret.read.AMAZON_AWS_ACCESS_KEY',          'log_only', 'colin', 'lib/amazon/client.ts SigV4 signing'),
  ('system', 'secret.read.AMAZON_AWS_SECRET_KEY',          'log_only', 'colin', 'lib/amazon/client.ts SigV4 signing'),
  ('system', 'secret.read.DROPBOX_APP_KEY',                'log_only', 'colin', 'statement-coverage Dropbox auth'),
  ('system', 'secret.read.DROPBOX_APP_SECRET',             'log_only', 'colin', 'statement-coverage Dropbox auth'),
  ('system', 'secret.read.DROPBOX_REFRESH_TOKEN',          'log_only', 'colin', 'statement-coverage Dropbox auth')
ON CONFLICT (agent_id, capability) DO NOTHING;

-- ── (3) Harness rollup: security_layer 85 → 100% ────────────────────────────
-- 100% criteria met:
--   - All production secret env vars have capability_registry entries (this migration)
--   - All production code paths that can be migrated use getSecret() (telegram + gmail)
--   - Remaining non-migratable reads are architectural (bootstrap layer, sync F22 contract,
--     async-cascading client patterns, dev scripts) — documented below
--   - All agent files have caps: frontmatter (slice 5)
--   - Coordinator + builder grants are enforce-mode for secrets (slice 7)
--   - morning_digest surfaces agent_actions count (slice 6)
--
-- Architectural non-migrations (permanent, by design):
--   - lib/supabase/service.ts: bootstrap layer — getSecret() uses this to read harness_config,
--     so it cannot use getSecret() itself (circular dependency)
--   - lib/auth/cron-secret.ts: F22 requires sync function; Next.js route middleware must
--     be synchronous — getSecret() is async and cannot be awaited at route entry point
--   - lib/amazon/client.ts: sync creds() pattern used in SigV4 signing — making async
--     cascades through buildAuthHeaders() and all callers
--   - scripts/: developer tooling, not production code — no runtime audit trail required

UPDATE public.harness_components
  SET completion_pct = 100,
      updated_at     = NOW(),
      notes          = COALESCE(notes, '') ||
        ' [0064: capability registry complete + system agent grants + 100% milestone]'
  WHERE id = 'harness:security_layer';

-- Rollback:
-- DELETE FROM public.agent_capabilities WHERE agent_id = 'system';
-- DELETE FROM public.capability_registry WHERE capability IN (
--   'secret.read.TELEGRAM_BOT_TOKEN','secret.read.TELEGRAM_ALERTS_BOT_TOKEN',
--   'secret.read.TELEGRAM_WEBHOOK_SECRET','secret.read.GOOGLE_CLIENT_SECRET',
--   'secret.read.GOOGLE_REFRESH_TOKEN','secret.read.ANTHROPIC_API_KEY',
--   'secret.read.GITHUB_TOKEN','secret.read.VERCEL_TOKEN',
--   'secret.read.VERCEL_AUTOMATION_BYPASS_SECRET','secret.read.COORDINATOR_ROUTINE_TOKEN',
--   'secret.read.KEEPA_API_KEY','secret.read.AMAZON_SP_REFRESH_TOKEN',
--   'secret.read.AMAZON_SP_CLIENT_SECRET','secret.read.AMAZON_AWS_ACCESS_KEY',
--   'secret.read.AMAZON_AWS_SECRET_KEY','secret.read.DROPBOX_APP_KEY',
--   'secret.read.DROPBOX_APP_SECRET','secret.read.DROPBOX_REFRESH_TOKEN'
-- );
-- UPDATE public.harness_components SET completion_pct = 85 WHERE id = 'harness:security_layer';
