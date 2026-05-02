-- 0063_secret_capability_enforce.sql
-- Security layer slice 7: flip secret.read.* for the five real secrets to enforce mode.
-- Spec: docs/harness/SECURITY_LAYER_SPEC.md §Priority order, Slice 7 + AD6 rollout Day 2.
--
-- Two UPDATEs per the spec's enforcement model (lib/security/capability.ts §evaluate):
--   (a) capability_registry.default_enforcement — controls what happens to agents WITHOUT
--       a grant for these caps. Flipping to 'enforce' means unauthorized callers get
--       CapabilityDeniedError instead of a silent allowed_log_only.
--   (b) agent_capabilities.enforcement_mode — updates existing grants so authorized agents
--       are logged as 'allowed' (not 'allowed_log_only') in agent_actions. Cosmetic but
--       meaningful for audit: 'allowed' means "granted and enforced", not "would have denied".
--
-- TELEGRAM_CHAT_ID is intentionally excluded: migration 0045 labels it
-- "non-secret but tracked uniformly" — it's a public chat ID, not a credential.
--
-- AD7: capability_registry and agent_capabilities are SELECT-only for service_role.
-- This migration runs as the postgres role — the only permitted write path.
--
-- Verify post-apply:
--   SELECT capability, default_enforcement FROM capability_registry
--     WHERE capability LIKE 'secret.read.%' ORDER BY capability;
--   -- TELEGRAM_CHAT_ID should still be 'log_only'; all others 'enforce'.
--
--   SELECT agent_id, capability, enforcement_mode FROM agent_capabilities
--     WHERE capability LIKE 'secret.read.%' ORDER BY agent_id, capability;
--   -- All rows should show 'enforce'.
--
--   SELECT completion_pct FROM harness_components WHERE id = 'harness:security_layer';
--   -- Should be 85.

-- (a) Registry defaults — blocks unauthorized agents in enforce mode
UPDATE public.capability_registry
  SET default_enforcement = 'enforce'
  WHERE capability IN (
    'secret.read.SUPABASE_SERVICE_ROLE_KEY',
    'secret.read.CRON_SECRET',
    'secret.read.TELEGRAM_BOT_TOKEN_ALERTS',
    'secret.read.TELEGRAM_BOT_TOKEN_BUILDER',
    'secret.read.TELEGRAM_BOT_TOKEN_DAILY'
  );

-- (b) Per-agent grants — marks authorized reads as 'allowed' (not 'allowed_log_only')
UPDATE public.agent_capabilities
  SET enforcement_mode = 'enforce'
  WHERE capability IN (
    'secret.read.SUPABASE_SERVICE_ROLE_KEY',
    'secret.read.CRON_SECRET',
    'secret.read.TELEGRAM_BOT_TOKEN_ALERTS',
    'secret.read.TELEGRAM_BOT_TOKEN_BUILDER',
    'secret.read.TELEGRAM_BOT_TOKEN_DAILY'
  );

-- (c) Harness rollup: security_layer 70 → 85 (enforcement on, morning_digest surfacing live)
UPDATE public.harness_components
  SET completion_pct = 85,
      updated_at     = NOW(),
      notes          = COALESCE(notes, '') ||
        ' [0063: secret.read enforce flip — unauthorized callers denied, authorized callers audited as allowed]'
  WHERE id = 'harness:security_layer';

-- Rollback (restores log_only; run only with explicit Colin approval):
-- UPDATE public.capability_registry
--   SET default_enforcement = 'log_only'
--   WHERE capability IN (
--     'secret.read.SUPABASE_SERVICE_ROLE_KEY','secret.read.CRON_SECRET',
--     'secret.read.TELEGRAM_BOT_TOKEN_ALERTS','secret.read.TELEGRAM_BOT_TOKEN_BUILDER',
--     'secret.read.TELEGRAM_BOT_TOKEN_DAILY'
--   );
-- UPDATE public.agent_capabilities
--   SET enforcement_mode = 'log_only'
--   WHERE capability IN (
--     'secret.read.SUPABASE_SERVICE_ROLE_KEY','secret.read.CRON_SECRET',
--     'secret.read.TELEGRAM_BOT_TOKEN_ALERTS','secret.read.TELEGRAM_BOT_TOKEN_BUILDER',
--     'secret.read.TELEGRAM_BOT_TOKEN_DAILY'
--   );
-- UPDATE public.harness_components SET completion_pct = 70 WHERE id = 'harness:security_layer';
