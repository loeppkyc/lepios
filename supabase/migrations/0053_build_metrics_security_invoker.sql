-- Migration 0053: same-day follow-up to 0052_build_metrics.
--
-- Without security_invoker, Postgres views run with the owner's (postgres)
-- privileges and bypass RLS on the underlying table. The 0052 acceptance test
-- caught this: anon SELECT on build_metrics_summary returned aggregate rows
-- even though anon SELECT on build_metrics itself returned [].
--
-- Setting security_invoker = true makes the view enforce the caller's RLS,
-- which closes the leak. The directive is also baked into 0052_build_metrics.sql
-- so a fresh DB created from migrations gets it from the start; this migration
-- exists to update DBs that already applied the original 0052.

alter view public.build_metrics_summary set (security_invoker = true);
