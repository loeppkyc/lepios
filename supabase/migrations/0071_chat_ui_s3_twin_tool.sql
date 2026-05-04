-- chat_ui Slice 3: queryTwin tool capability + agent grant + rollup bump.

INSERT INTO capability_registry (capability, domain, description, default_enforcement, destructive)
VALUES ('tool.chat_ui.read.twin', 'tool', 'chat_ui — queryTwin tool (read Colin personal knowledge corpus)', 'log_only', false)
ON CONFLICT (capability) DO NOTHING;

INSERT INTO agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES ('chat_ui', 'tool.chat_ui.read.twin', 'log_only', 'colin', 'chat_ui slice 3 — Twin Q&A tool')
ON CONFLICT (agent_id, capability) DO NOTHING;

UPDATE harness_components
SET completion_pct = 60,
    notes = 'Slice 3 shipped: queryTwin tool added. Tools: getHarnessRollup + queryTwin.',
    updated_at = NOW()
WHERE id = 'harness:chat_ui';
