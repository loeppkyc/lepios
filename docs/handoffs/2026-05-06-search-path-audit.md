# Handoff — 2026-05-06 search_path audit

**Status:** Closed. All 13 `function_search_path_mutable` WARN findings cleared. Three PRs merged to main, F-N7 regression guard live, S-N10 logged.

---

## What shipped

| PR                                                | Squash SHA | Migration                                                       | Functions                                  | Risk tier    |
| ------------------------------------------------- | ---------- | --------------------------------------------------------------- | ------------------------------------------ | ------------ |
| [#81](https://github.com/loeppkyc/lepios/pull/81) | `da8bc38`  | `0128_pin_search_path_tier1_triggers.sql`                       | 4 trigger fns                              | Trivial      |
| [#82](https://github.com/loeppkyc/lepios/pull/82) | `988d31e`  | `0129_pin_search_path_tier2_moderate.sql`                       | 8 plpgsql fns                              | Moderate     |
| [#83](https://github.com/loeppkyc/lepios/pull/83) | `c85dfbe`  | `0130_pin_search_path_tier3_match_knowledge.sql` + F-N7 + S-N10 | `match_knowledge` (SQL fn, twin retrieval) | High-traffic |

Functions hardened (all `SET search_path = ''`):

**Tier 1 — trigger fns, NEW.\* + pg_catalog.now() only:**

- `set_updated_at` (used by business_expenses, mileage_log, receipts, recurring_expense_templates)
- `decisions_log_set_updated_at`
- `update_oura_daily_updated_at`
- `update_conversation_on_message`

**Tier 2 — plpgsql fns with user-schema body refs (SECURITY DEFINER preserved):**

- `claim_next_task` (harness pickup)
- `idea_inbox_mirror_to_knowledge` (trigger)
- `decisions_log_mirror_to_knowledge` (trigger)
- `append_scan_labels_batch` (gmail batch)
- `rebuild_knowledge_ivfflat_index` (vector index rebuild)
- `reclaim_stale_tasks` (harness reclaim)
- `knowledge_mark_used` (retrieval bump)
- `knowledge_decay_stale` (age-out)

**Tier 3 — SQL function (twin retrieval):**

- `match_knowledge` — required `OPERATOR(public.<=>)` qualification because the body parses against the function's pinned search_path (not the session's), and the cosine-distance operator lives in pgvector-in-public.

---

## Verification

- **Live Supabase advisor:** 0 `function_search_path_mutable` findings (re-run post-merge).
- **DB-level:** 13/13 functions show `proconfig: ["search_path=\"\""]` in `pg_proc`.
- **Per-tier smoke:**
  - Tier 1: single sentinel-rollback transaction touched all 4 trigger paths; UPDATEs advanced `updated_at`; INSERT into `messages` bumped `conversations.updated_at` + `message_count` 2→3.
  - Tier 2: 7 of 8 fns called inside sentinel-rollback (claim_next_task, idea_inbox + decisions_log mirrors with INSERT, append_scan_labels_batch with no-match, reclaim_stale_tasks, knowledge_mark_used both branches, knowledge_decay_stale with past cutoff). `rebuild_knowledge_ivfflat_index` not live-smoked — would take ACCESS EXCLUSIVE on `public.knowledge`. Static-checked instead (index name + opclass both verified in `public` via `pg_index` / `pg_opclass`).
  - Tier 3: DB-level (anchor row's own embedding as query → 5 hits, top sim 1.0, identical pre/post). End-to-end `POST https://lepios-one.vercel.app/api/twin/ask` → HTTP 200, 10 vector hits, `retrieval_path: "vector"`, escalation tracking working.
- **Suite:** 2574 passed | 75 skipped (was 2573 baseline; +1 = F-N7 architectural test).

---

## Wrinkles found

**1. `LANGUAGE sql` body parses against the function's pinned search_path, not the session's.**
Initial Tier 3 apply attempt failed with `operator does not exist: public.vector <=> public.vector`. The `<=>` operator from pgvector-in-public couldn't resolve with empty `search_path`. Fix: `embedding OPERATOR(public.<=>) query_embedding`. The vector ARGUMENT type does NOT need qualification — argument types resolve at CREATE-time via session search_path and are stored as oids. Captured in S-N10 + the migration's docblock.

**2. Safety hook false-positive on Tier 2 commit.**
Hook flagged the unchanged `DROP INDEX IF EXISTS` inside `rebuild_knowledge_ivfflat_index`'s body. This DROP has been in the function since the function was created — migration only adds `public.` qualification. Function is `SECURITY DEFINER`, callable only by service-role. Bypassed via `SAFETY_BYPASS=1` with the reason logged in commit body (`823f341`, squashed into `988d31e`). False-positive class noted in session-start gotchas; hook fix already filed in follow-ups.

**3. F-N7 chicken-and-egg with PR ordering.**
F-N7 test scans every CREATE FUNCTION across all migrations and asserts `SET search_path` clause exists. On the Tier 3 branch alone (without Tier 1 + Tier 2 migrations present), the test legitimately fails on 12 functions. Solution: cherry-picked T1 + T2 commits onto Tier 3 branch so test passes locally. After T1 + T2 squash-merged, rebased Tier 3 onto updated main; patch-ID equivalence detection silently dropped the duplicates. Tier 3 PR's final diff was clean (only its 3 net-new files).

---

## Decisions

- **Tier by blast radius, not by author convenience.** Trivial → moderate → high-traffic. Validated the pattern on 12 functions before touching the twin retrieval path.
- **Per-tier live smoke, not just static check.** Caught the `OPERATOR(public.<=>)` gap at Tier 3 apply-time, before any production traffic touched a broken function.
- **`pg_catalog.now()` qualification despite implicit pg_catalog search.** Adds no behavior change but matches Supabase's literal recommendation. Cheap and removes ambiguity.
- **F-N7 lives in test docblock only, not in `lib/rules/registry.ts`.** Mirrors F-N6's treatment. The F-N# series is project-specific (paired with `docs/claude-md/{failures,successes}.md`); the registry tracks the F17–F22 architecture/process rule namespace separately.

---

## Pending follow-ups (NOT in this audit)

1. **`extension_in_public` deferred WARN** — move pgvector to a dedicated `extensions` schema. When done, `match_knowledge`'s qualification changes from `OPERATOR(public.<=>)` to `OPERATOR(extensions.<=>)`. Captured in `docs/follow-ups/2026-05-06-supabase-advisor-deferred.md`.
2. **`auth_leaked_password_protection` deferred WARN** — Colin's dashboard click. Authentication → Settings → Password Security → toggle on. ~30s.
3. **Safety hook false-positive on function-body DROPs** — already filed.
4. **Supabase advisor backstop monitor** — poll `get_advisors` in `morning_digest`, surface new ERROR-level findings before the email arrives. Idea-stage; not queued.
5. **`rebuild_knowledge_ivfflat_index` deferred live smoke** — function is rarely (never?) called in production. If you want full smoke coverage, schedule it for a low-traffic window when ACCESS EXCLUSIVE on `public.knowledge` won't disrupt twin queries.

---

## Resume notes

- **Branch state:** local main at `c85dfbe`, clean except pre-existing modifications to `app/(cockpit)/business-review/_components/StatementCoverageGrid.tsx` and `app/api/business-review/statement-coverage/route.ts` (not from this audit).
- **Vercel:** T1 production deploy READY (sha `da8bc38`); T2 + T3 queued behind it but DB function definitions are at the locked-down state regardless of which deploy serves the Next.js app.
- **F-N7 architectural test** at `tests/architecture/search-path-coverage.test.ts` will block any future `CREATE FUNCTION` in `public` from merging without `SET search_path`. ALLOWED_NO_SEARCH_PATH escape hatch is empty.
- **S-N10** appended to `docs/claude-md/successes.md` (newest entry, top of file).

If a future search_path WARN reappears, the F-N7 test should have caught it at PR-time. If it didn't, treat that as an F-N7 escape — file as a new failure-log entry and tighten the regex.
