-- Migration 0033: window_sessions table
-- Tracks active Claude Code windows for coordinator visibility.
-- Stale threshold: last_heartbeat_at older than 5 min = inactive.

CREATE TABLE window_sessions (
  session_id   TEXT        PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_task TEXT,
  status       TEXT        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'ended')),
  metadata     JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX window_sessions_last_heartbeat_idx ON window_sessions (last_heartbeat);
CREATE INDEX window_sessions_status_idx ON window_sessions (status);

COMMENT ON TABLE window_sessions IS
  'Per-window status rows written by coordinator via POST /api/harness/window-session. '
  'Consumed by GET /api/status. Stale = last_heartbeat older than 5 min.';
