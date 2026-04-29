-- Migration 0050: Enable RLS on Gmail + window_sessions tables
-- Closes ERROR-level findings from Supabase security advisor (2026-04-29):
--   - rls_disabled_in_public on gmail_messages, gmail_statement_arrivals,
--     gmail_known_senders, window_sessions
--   - sensitive_columns_exposed on window_sessions.session_id
--
-- Access model:
--   service_role  -> full access (bypasses RLS via BYPASSRLS attribute; no policy needed)
--   authenticated -> DENY (no user_id column to scope by; tables are global harness state)
--   anon          -> DENY (no public-facing reads)
--
-- All current readers use createServiceClient() (verified 2026-04-29):
--   - app/api/cron/gmail-scan/route.ts
--   - lib/harness/window-tracker.ts
--   - lib/gmail/scan.ts (caller-injected db)
--   - lib/gmail/classifiers/statement-arrivals.ts (caller-injected db)
--
-- Strategy: ENABLE RLS with no policies. PostgREST returns empty arrays to anon/
-- authenticated for SELECT, and rejects writes. service_role continues to bypass
-- RLS. Matches the harness_config / audit_logs pattern.

ALTER TABLE public.gmail_messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_statement_arrivals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_known_senders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.window_sessions          ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.gmail_messages IS
  'RLS enabled 2026-04-29 (migration 0050). No policies -- service_role only.';

COMMENT ON TABLE public.gmail_statement_arrivals IS
  'RLS enabled 2026-04-29 (migration 0050). No policies -- service_role only.';

COMMENT ON TABLE public.gmail_known_senders IS
  'RLS enabled 2026-04-29 (migration 0050). No policies -- service_role only.';

COMMENT ON TABLE public.window_sessions IS
  'RLS enabled 2026-04-29 (migration 0050). No policies -- service_role only. '
  'session_id is a Claude Code window UUID, NOT an auth session token.';
