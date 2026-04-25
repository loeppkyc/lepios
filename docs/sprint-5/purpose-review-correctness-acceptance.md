# Acceptance Doc — Purpose Review Correctness Fixes
**Chunk:** `concurrent_purpose_review_correctness`
**Sprint:** 5
**Date:** 2026-04-25
**Status:** awaiting-colin-approval
**task_queue id:** fdf5a51e-28ca-4584-88f2-e922046ee276
**Folds in:** task 9d7f2af7 (add 'colin' to ActorType enum)

---

## 1. Scope

Fix three correctness bugs in `lib/purpose-review/handler.ts` identified
during Phase 4 review of the purpose_review gate (parent task 9778dee9,
commits 3292e75 / 878d107):

1. **F1** — Store `review_message_id` on the revise path so `route.ts` can
   correlate text replies correctly under concurrent tasks.
2. **F2** — Change `actor_type` from `'human'` to `'colin'` in all
   attribution calls; add `'colin'` to the `ActorType` union (folding in
   queued task 9d7f2af7); migrate existing rows in `entity_attribution`.
3. **F3** — Add skip-flow attribution assertion to Test 5.
4. **F2-implicit** — Update Test 4 revise-flow assertion from
   `actor_type: 'human'` to `actor_type: 'colin'` (will fail after F2 fix).

**Acceptance criterion:** All 7 existing purpose-review tests pass with no
TypeScript compile errors; Test 5 asserts attribution was called with
`actor_type: 'colin'`; Test 4 asserts `actor_type: 'colin'`; migration 0028
applies cleanly idempotent (UPDATE affects 0 rows on replay).

---

## 2. Out of Scope

- Storing `review_message_id` on approve/skip paths — those are synchronous
  conclusions, no `awaiting_review` state, no correlation needed.
- Changing `actor_type` for non-purpose-review attribution calls in other
  modules. Scope is handler.ts only; other modules are a separate decision.
- Changing `actor_type` for system/cron actions. Only human-Telegram rows.
- Any changes to route.ts text-reply correlation logic — once handler.ts
  stores review_message_id, route.ts is correct as-is.

---

## 3. Files Expected to Change

| File | Change |
|------|--------|
| `lib/attribution/types.ts` | Add `\| 'colin'` to `ActorType` union (line 5) |
| `lib/purpose-review/handler.ts` | (a) Add `review_message_id: messageId` to revise metadata update; (b) change `actor_type: 'human'` → `actor_type: 'colin'` in all 3 `recordAttribution` calls (approve, skip, text-reply paths) |
| `tests/purpose-review.test.ts` | (a) Update Test 4 assertion: `actor_type: 'human'` → `actor_type: 'colin'`; (b) Add attribution assertion to Test 5 skip flow |
| `supabase/migrations/0028_purpose_review_actor_type.sql` | New migration: UPDATE `entity_attribution` SET `actor_type='colin'` WHERE `actor_id='telegram' AND actor_type='human'` |

---

## 4. Check-Before-Build Findings

- `review_message_id`: read at route.ts:941, never written in handler.ts —
  confirmed missing, needs 1-line add.
- `ActorType` union: `lib/attribution/types.ts:5` — `'colin'` absent,
  TypeScript accepts `'human'` for these calls without error (valid type).
  After adding `'colin'`, both are valid; call sites updated in handler.ts.
- `entity_attribution.actor_type`: plain TEXT column (migration 0020,
  no CHECK constraint). No DB type change needed; data migration only.
- Task 9d7f2af7: status=queued, `metadata.related_file='lib/attribution/types.ts'`.
  Confirmed as the queued enum-addition task. Fold: cancel 9d7f2af7 and
  include the types.ts change here.
- Test 4 (line 296): asserts `actor_type: 'human'` — confirmed will break,
  must be updated in this build.
- Test 5 (lines 310–338): no `recordAttribution` assertion — confirmed gap.

---

## 5. External Deps Tested

None. This chunk touches no external APIs. All changes are:
- TypeScript type file
- Handler logic (Supabase client mocked in tests)
- SQL migration (pure UPDATE)
- Test assertions

---

## 6. Grounding Checkpoint

**DB state query (Colin or builder runs after build):**

```sql
-- Verify no 'human' + 'telegram' rows remain
SELECT COUNT(*) AS remaining_unmigrated
FROM entity_attribution
WHERE actor_id = 'telegram' AND actor_type = 'human';
-- Expected: 0

-- Spot-check: confirm 'colin' rows exist if any purpose_review events ran
SELECT actor_type, actor_id, COUNT(*) AS n
FROM entity_attribution
WHERE action LIKE 'purpose_reviewed%'
GROUP BY actor_type, actor_id;
-- Expected: actor_type='colin', actor_id='telegram'
```

This is a DB-state query (Principle 14 escape hatch) — no physical-world
artifact needed. "Tests pass" alone is NOT sufficient; the migration must
be verified to have applied.

---

## 7. Kill Signals

- Migration 0028 fails due to unexpected rows (actor_type='human' + actor_id
  other than 'telegram'): stop, escalate. Do not widen the WHERE clause
  without Colin review.
- TypeScript compile fails after adding 'colin' to ActorType: escalate.
- Test count changes (tests disappear): escalate.

---

## 8. Cached-Principle Decisions

**Cache-match is disabled for Sprint 4 baseline (Phase 0 override active).**

This chunk is Sprint 5 harness work. The sprint-state `cache_match_enabled: false`
applies to Sprint 4 chunks. Sprint 5 harness corrections follow the same governance:
all acceptance docs escalate to Colin before going to builder.

**Escalating this doc to Colin for approval before builder invocation.**

---

## 9. Open Questions

**None.** F1, F2, F3 were answered by Colin on 2026-04-25T17:00:00Z with full
specificity. No ambiguity remains.

---

## 10. Post-Build: Cancel Task 9d7f2af7

After builder commits this chunk, update task_queue:

```sql
UPDATE task_queue
SET status = 'cancelled',
    error_message = 'Folded into fdf5a51e (purpose-review-correctness-acceptance). ActorType enum added in lib/attribution/types.ts as part of F2 fix.'
WHERE id = '9d7f2af7-3982-437a-958b-59336b014faa';
```

Builder does NOT run this query — coordinator runs it after grounding
checkpoint passes.

---

## 11. Acceptance Criteria Checklist

- [ ] `lib/attribution/types.ts`: `ActorType` includes `'colin'`
- [ ] `lib/purpose-review/handler.ts`: revise path stores `review_message_id: messageId` in metadata
- [ ] `lib/purpose-review/handler.ts`: all `recordAttribution` calls use `actor_type: 'colin'`
- [ ] `supabase/migrations/0028_purpose_review_actor_type.sql`: exists and applies cleanly
- [ ] `tests/purpose-review.test.ts` Test 4: asserts `actor_type: 'colin'`
- [ ] `tests/purpose-review.test.ts` Test 5: asserts `recordAttribution` called with `actor_type: 'colin'` + `action: 'skip'`
- [ ] All 7 purpose-review tests pass
- [ ] TypeScript compiles without errors
- [ ] Grounding checkpoint SQL returns 0 unmigrated rows
- [ ] Task 9d7f2af7 cancelled by coordinator after grounding pass
