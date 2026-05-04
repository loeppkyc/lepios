-- chat_ui Slice 4: action tools (sendTelegramMessage, queueTask) + listAgentEvents read tool.
-- Adds 3 capabilities, grants to chat_ui, bumps harness:chat_ui 60→75%.

INSERT INTO capability_registry (capability, domain, description, default_enforcement, destructive)
VALUES
  ('tool.chat_ui.action.telegram',      'tool', 'chat_ui — sendTelegramMessage action tool (queues outbound notification)', 'log_only', false),
  ('tool.chat_ui.action.queue_task',    'tool', 'chat_ui — queueTask action tool (inserts into task_queue)',                'log_only', false),
  ('tool.chat_ui.read.agent_events',    'tool', 'chat_ui — listAgentEvents read tool (queries agent_events audit log)',    'log_only', false)
ON CONFLICT (capability) DO NOTHING;

INSERT INTO agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES
  ('chat_ui', 'tool.chat_ui.action.telegram',   'log_only', 'colin', 'chat_ui slice 4 — sendTelegramMessage action tool'),
  ('chat_ui', 'tool.chat_ui.action.queue_task', 'log_only', 'colin', 'chat_ui slice 4 — queueTask action tool'),
  ('chat_ui', 'tool.chat_ui.read.agent_events', 'log_only', 'colin', 'chat_ui slice 4 — listAgentEvents read tool')
ON CONFLICT (agent_id, capability) DO NOTHING;

UPDATE harness_components
SET completion_pct = 75,
    notes          = 'Slice 4 shipped: sendTelegramMessage + queueTask (dryRun approval gate) + listAgentEvents. Tools: getHarnessRollup + queryTwin + sendTelegramMessage + queueTask + listAgentEvents.',
    updated_at     = NOW()
WHERE id = 'harness:chat_ui';
