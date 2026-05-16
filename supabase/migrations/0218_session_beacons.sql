-- Session beacons — one row per active Claude Code window.
-- Written on every tool call via PostToolUse hook in .claude/settings.json.
-- Lets any window query "who else is active right now?" without relying on
-- window-start.mjs opt-in.

CREATE TABLE public.session_beacons (
  branch          TEXT        PRIMARY KEY,
  pid             INT,
  hostname        TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT now(),
  tool_count      INT         NOT NULL DEFAULT 0,
  last_tool       TEXT,
  meta            JSONB
);

CREATE INDEX ON public.session_beacons (last_heartbeat);

ALTER TABLE public.session_beacons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session_beacons_authenticated" ON public.session_beacons
  FOR SELECT USING (auth.uid() IS NOT NULL);

GRANT INSERT, UPDATE, DELETE ON public.session_beacons TO service_role;
