-- 0170_dropbox_capability.sql
-- Register Dropbox + npm + pypi capabilities in capability_registry.
-- Seeds DROPBOX_REFRESH_TOKEN placeholder in harness_config.
-- Companion: lib/dropbox/client.ts (net.outbound.dropbox + net.outbound.dropbox.content)
--            lib/oss-radar/sources/npm.ts (net.outbound.npm)
--            lib/oss-radar/sources/pypi.ts (net.outbound.pypi)

-- Capability registry entries (ON CONFLICT DO NOTHING — safe to re-run)
INSERT INTO capability_registry (capability, default_enforcement)
VALUES
  ('net.outbound.dropbox',         'enforce'),
  ('net.outbound.dropbox.content', 'enforce'),
  ('net.outbound.npm',             'enforce'),
  ('net.outbound.pypi',            'enforce')
ON CONFLICT (capability) DO NOTHING;

-- Dropbox refresh token placeholder — populate via Vercel env or harness_config update
INSERT INTO harness_config (key, value)
VALUES ('DROPBOX_REFRESH_TOKEN', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO harness_config (key, value)
VALUES ('DROPBOX_APP_KEY', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO harness_config (key, value)
VALUES ('DROPBOX_APP_SECRET', '')
ON CONFLICT (key) DO NOTHING;
