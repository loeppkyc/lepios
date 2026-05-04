-- chat_ui Slice 5: listIdeas (read) + submitIdea (action) tool capabilities.
-- Bumps harness:chat_ui 75→85%.

INSERT INTO capability_registry (capability, domain, description, default_enforcement, destructive)
VALUES
  ('tool.chat_ui.read.idea_inbox',   'tool', 'chat_ui — listIdeas read tool (queries idea_inbox)',                   'log_only', false),
  ('tool.chat_ui.action.idea_inbox', 'tool', 'chat_ui — submitIdea action tool (inserts into idea_inbox)',           'log_only', false)
ON CONFLICT (capability) DO NOTHING;

INSERT INTO agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES
  ('chat_ui', 'tool.chat_ui.read.idea_inbox',   'log_only', 'colin', 'chat_ui slice 5 — listIdeas read tool'),
  ('chat_ui', 'tool.chat_ui.action.idea_inbox', 'log_only', 'colin', 'chat_ui slice 5 — submitIdea action tool')
ON CONFLICT (agent_id, capability) DO NOTHING;

UPDATE harness_components
SET completion_pct = 85,
    notes          = 'Slice 5 shipped: listIdeas + submitIdea (idea_inbox tools). Tools: getHarnessRollup + queryTwin + sendTelegramMessage + queueTask + listAgentEvents + listIdeas + submitIdea.',
    updated_at     = NOW()
WHERE id = 'harness:chat_ui';
