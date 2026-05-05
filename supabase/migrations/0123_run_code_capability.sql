-- 0123_run_code_capability.sql
-- D6: register run_code tool capability for chat_ui agent.
-- Domain 'tool' already allowed per 0069 constraint.
--
-- Verify post-apply:
--   SELECT * FROM capability_registry WHERE capability='tool.chat_ui.action.run_code';
--   SELECT * FROM agent_capabilities WHERE agent_id='chat_ui' AND capability='tool.chat_ui.action.run_code';

INSERT INTO capability_registry (capability, domain, description, default_enforcement, destructive)
VALUES (
  'tool.chat_ui.action.run_code',
  'tool',
  'chat_ui — runCode tool: execute JavaScript in sandboxed V8 context (vm module, no fs/net)',
  'log_only',
  false
)
ON CONFLICT (capability) DO NOTHING;

INSERT INTO agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES (
  'chat_ui',
  'tool.chat_ui.action.run_code',
  'log_only',
  'colin',
  'D6 — sandboxed JS execution via vm.createContext(), no fs/net/require'
)
ON CONFLICT (agent_id, capability) DO NOTHING;
