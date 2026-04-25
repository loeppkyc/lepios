-- 0025_drop_match_knowledge_3arg.sql
--
-- Drops the original 3-arg match_knowledge overload introduced in 0013.
--
-- Problem: PostgREST does not reliably resolve function overloads. With both
-- the 3-arg (vector, int, float) and 4-arg (vector, int, float, text) versions
-- present, the REST endpoint was making nondeterministic choices — observed as
-- Q3 returning 0 rows despite circuit_breaker.py chunks existing in corpus.
--
-- Safe to drop: the 4-arg version (0024) has filter_domain TEXT DEFAULT NULL,
-- so callers that omit the 4th arg (lib/knowledge/client.ts, twin/ask route)
-- are unaffected — Postgres resolves to the 4-arg overload and NULL default
-- produces identical search behavior to the old 3-arg version.
--
-- Rollback:
--   Re-apply 0013_add_pgvector.sql CREATE OR REPLACE block (3-arg signature).

DROP FUNCTION IF EXISTS public.match_knowledge(vector(768), integer, double precision);
