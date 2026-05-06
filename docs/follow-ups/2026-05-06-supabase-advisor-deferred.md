# Supabase advisor — 3 WARN classes deferred from 2026-05-06 hardening

**Filed:** 2026-05-06
**Trigger:** Supabase advisor email — security incident response. Migrations 0126 + 0127 closed all 9 ERRORs and 10 SECURITY-DEFINER WARNs. The 3 classes below were deferred because they're either risky-without-audit or require dashboard interaction.

## 1. function_search_path_mutable (13 functions)

**WARN-level.** Postgres functions without an explicit `search_path` setting can be hijacked by a malicious user creating a same-named object in another schema that ends up in the search_path resolution.

**Why deferred:** the fix is `ALTER FUNCTION ... SET search_path = ''`. With `''`, all references inside the function body must be schema-qualified (e.g. `public.knowledge` not `knowledge`). If any of the 13 function bodies reference unqualified names, they break silently when called.

**Functions affected:**

- `claim_next_task(text)`
- `match_knowledge` (twin retrieval — high-traffic, breakage = twin offline)
- `idea_inbox_mirror_to_knowledge`
- `decisions_log_set_updated_at`
- `append_scan_labels_batch`
- `set_updated_at`
- `decisions_log_mirror_to_knowledge`
- `rebuild_knowledge_ivfflat_index`
- `update_conversation_on_message`
- `reclaim_stale_tasks`
- `update_oura_daily_updated_at`
- `knowledge_mark_used`
- `knowledge_decay_stale`

**Fix process (per function):**

1. Read function body from `pg_proc.prosrc` or the originating migration.
2. Verify every table/function reference is schema-qualified (`public.X`, `pg_catalog.Y`, etc.).
3. If unqualified references exist, qualify them.
4. `ALTER FUNCTION public.X(args) SET search_path = '';`
5. Re-run advisor; smoke-test the function.

**Rough effort:** ~30 min total if all bodies are clean; +15 min per function that needs qualification.

## 2. extension_in_public — vector extension in public schema

**WARN-level.** pgvector is installed in `public`. Best practice is a dedicated `extensions` schema.

**Why deferred:** the fix is `ALTER EXTENSION vector SET SCHEMA extensions`. Every reference in code + migrations to `vector` (the type) and the operators (`<=>`, `<->`, `<#>`) must continue to resolve. With the extension moved, reference resolution depends on `search_path` containing `extensions`, OR every reference being qualified.

The codebase has many embedding-related queries that could break. Twin retrieval, knowledge backfill, and the ivfflat index all depend on this. Worth doing but requires a tested rollout.

**Fix process:**

1. Create `extensions` schema if not present.
2. Verify Supabase auth roles have USAGE on `extensions`.
3. Add `extensions` to default `search_path` (or qualify everything).
4. `ALTER EXTENSION vector SET SCHEMA extensions;`
5. Run twin smoke test (ask + retrieve via vector similarity).
6. Run knowledge backfill smoke test.
7. Re-run advisor.

**Rough effort:** ~1 hour with care. Plan a dedicated session.

## 3. auth_leaked_password_protection — Supabase Auth dashboard toggle

**WARN-level.** Supabase Auth can check passwords against the HaveIBeenPwned database to reject known-leaked credentials. Currently disabled.

**Why deferred:** not a SQL change. Supabase dashboard toggle: Authentication → Settings → Password Security → "Enable leaked password protection." ~30 seconds, no code change needed.

**Fix:** Colin clicks the toggle.

---

## Defense already in place

- **Migration 0126:** RLS on 8 ERROR-level tables + view + REVOKE on 5 SECURITY DEFINER functions
- **Migration 0127:** REVOKE FROM PUBLIC closes the inheritance loop on the same 5 functions
- **`tests/architecture/rls-coverage.test.ts` (F-N6):** new architectural test asserts every CREATE TABLE in `public` schema has a corresponding ENABLE ROW LEVEL SECURITY in the migration corpus. Fails CI if a future table ships without RLS — prevents regression of the 2026-05-06 incident class.

## Backstop monitor (not yet built)

A morning_digest line that polls `mcp__claude_ai_Supabase__get_advisors` and surfaces any new ERROR-level finding would close the "incident detected by Supabase email at 4 AM, not by us" gap. Defer until the more critical work clears.
