# Purpose Review Correctness — Phase 1 Study
**Chunk:** `concurrent_purpose_review_correctness`
**Date:** 2026-04-25
**Status:** complete — feeds purpose-review-correctness-acceptance.md
**Parent task:** 9778dee9-275e-4b95-a556-7122c6db571a (purpose_review gate, shipped commit 3292e75)
**This task:** fdf5a51e-28ca-4584-88f2-e922046ee276

---

## Phase 1a — Streamlit Study

**Skipped.** This chunk has zero Streamlit predecessor. It is a correctness fix for
`lib/purpose-review/handler.ts`, a LepiOS-native module with no Streamlit analog.

---

## Phase 1b — Colin Q&A (direct; twin bypassed)

Three correctness issues were identified in the Phase 4 builder review of the
purpose_review gate (parent task 9778dee9). Colin answered directly on
2026-04-25T17:00:00Z. Twin bypassed — all questions were concrete
implementation decisions (personal), not corpus-answerable facts.

### F1: review_message_id missing on revise path

**Question:** `handlePurposeReviewCallback` stores `purpose_review: 'pending_notes'`
on the revise path but does NOT store `messageId` as `review_message_id` in metadata.
`route.ts:941` reads `taskMeta.review_message_id` to correlate text replies. When
`storedMsgId == null` (line 944), the fallback accepts ANY text message —
breaking under concurrent `awaiting_review` tasks.

**Colin's answer:** Apply 1-line builder fix: store `review_message_id` on revise path,
same shape as approve/skip paths.

**Resolution:** In `handlePurposeReviewCallback` revise branch, add
`review_message_id: messageId` to the metadata update object.

---

### F2: actor_type 'human' used instead of 'colin'

**Question:** All `recordAttribution` calls in `handler.ts` use
`{ actor_type: 'human', actor_id: 'telegram' }`. The `ActorType` union in
`lib/attribution/types.ts` does not include `'colin'` — it must be added.
Task 9d7f2af7 (status: queued) was created for this exact change.

**Colin's answer:** Use `colin` as `actor_type`. Add `colin` to `ActorType` enum —
fold enum addition into this build (task 9d7f2af7). Migrate existing rows where
`actor_id='telegram' AND actor_type='human'` to `actor_type='colin'`.

**Resolution:**
1. `lib/attribution/types.ts`: add `| 'colin'` to `ActorType`
2. `lib/purpose-review/handler.ts`: change `actor_type: 'human'` → `actor_type: 'colin'`
   in all four `recordAttribution` calls (approve, skip, text-reply paths; revise path
   has no current attribution call but will be consistent post-fix)
3. Migration 0028: UPDATE `entity_attribution` SET actor_type='colin' WHERE
   actor_id='telegram' AND actor_type='human'
4. Cancel task 9d7f2af7 (folded here)

---

### F3: Skip-flow attribution test missing

**Question:** Test 5 (`purpose-review: skip flow`) verifies `updateMock` and
`insertMock` are called, but does NOT assert that `recordAttribution` was called.
The skip path in `handler.ts` does call `void recordAttribution(...)` — this is
untested.

**Colin's answer:** Add missing skip-flow attribution test. Standard coverage.

**Resolution:** In `tests/purpose-review.test.ts` Test 5, add:
```typescript
expect(recordAttribution).toHaveBeenCalledWith(
  expect.objectContaining({ actor_type: 'colin', actor_id: 'telegram' }),
  expect.objectContaining({ type: 'task_queue', id: VALID_UUID }),
  'purpose_reviewed',
  expect.objectContaining({ action: 'skip' })
)
```

---

## Phase 1c — 20% Better Loop

**Note:** This is a correctness fix chunk, not a Streamlit port. The 20% Better
framework applies in adapted form: "Are there improvements beyond the three
Colin-approved fixes?"

| Category | Scan | Finding | Action |
|----------|------|---------|--------|
| Correctness | Any bugs beyond F1-F3? | Yes: Test 4 (revise flow text reply) asserts `actor_type: 'human'` on line 296. After F2 changes `handler.ts` to use `'colin'`, Test 4 will fail. This is an implicit side-effect of F2. | Include in build: update Test 4 assertion from `actor_type: 'human'` to `actor_type: 'colin'`. |
| Performance | DB query optimality | All single-row lookups by UUID primary key. | None. |
| Extensibility | Store `review_message_id` on approve/skip too? | No. Approve and skip conclude synchronously — no `awaiting_review` state, no text-reply correlation needed. Tight scope: revise path only. | None. |
| Data model | Migration scope — does `actor_id='telegram' AND actor_type='human'` catch non-Colin rows? | In current codebase, only Colin uses the Telegram webhook. Safe assumption documented in migration comment. | Document in migration. |
| Observability | Test coverage after fixes | 7 existing tests + 1 new assertion + 1 updated assertion = full path coverage. | None beyond F1-F3 + implicit test fix. |

**Conclusion:** No additional semantic improvements surface. The four changes (F1 + F2
+ F3 + implicit Test 4 update) are the right and complete scope.

---

## Grounding Manifest

| Claim | Evidence | File:line |
|-------|----------|-----------|
| review_message_id read in route.ts | route.ts:941 | app/api/telegram/webhook/route.ts:941 |
| Fallback accepts null storedMsgId | route.ts:944 | app/api/telegram/webhook/route.ts:944 |
| actor_type TEXT (no CHECK constraint) | migration 0020 | supabase/migrations/0020_add_entity_attribution.sql:6 |
| ActorType union lacks 'colin' | types.ts:5 | lib/attribution/types.ts:5 |
| Test 4 asserts actor_type: 'human' | test file:296 | tests/purpose-review.test.ts:296 |
| Test 5 has no attribution assertion | test file:310–338 | tests/purpose-review.test.ts:310–338 |
| Task 9d7f2af7 status queued | task_queue query | Supabase task_queue |
| Colin answered F1-F3 at 2026-04-25T17:00:00Z | task metadata | task_queue fdf5a51e |
