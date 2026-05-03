-- 0069_chat_ui_capability_seed.sql
-- chat_ui Slice 1: add 'tool' domain to capability_registry, seed chat_ui
-- capability + grant, bump chat_ui completion 0 → 45.
--
-- Spec: docs/harness/CHAT_UI_SPEC.md §AD4, §Completion accounting, acceptance A + H.
--
-- Verify post-apply:
--   SELECT * FROM capability_registry WHERE capability='tool.chat_ui.read.harness_rollup';
--   SELECT * FROM agent_capabilities WHERE agent_id='chat_ui';
--   SELECT completion_pct FROM harness_components WHERE id='harness:chat_ui'; -- expect 45

-- Extend domain constraint: capability_registry.domain adds 'tool' for LLM-callable tools.
ALTER TABLE capability_registry
  DROP CONSTRAINT IF EXISTS capability_registry_domain_check;
ALTER TABLE capability_registry
  ADD CONSTRAINT capability_registry_domain_check
    CHECK (domain IN ('fs','net','db','shell','git','secret','sandbox','tool'));

-- Seed the capability in the registry.
INSERT INTO capability_registry (capability, domain, description, default_enforcement, destructive)
VALUES (
  'tool.chat_ui.read.harness_rollup',
  'tool',
  'chat_ui — getHarnessRollup tool: read-only harness completion query',
  'log_only',
  false
);

-- Grant to the chat_ui agent (AD4: agentId = ''chat_ui'', system identity, not ''colin'').
INSERT INTO agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES (
  'chat_ui',
  'tool.chat_ui.read.harness_rollup',
  'log_only',
  'colin',
  'chat_ui slice 1 — first wired tool'
);

-- Bump chat_ui: 0 → 45.
-- Shell (26%) already shipped via merged orphan-recovery branch; tool bridge (slice 1)
-- adds the remaining 19 points to reach the honest 45% target.
UPDATE harness_components
  SET completion_pct = 45, updated_at = NOW()
  WHERE id = 'harness:chat_ui';
