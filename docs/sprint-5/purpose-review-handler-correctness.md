# Coordinator Correctness Review — lib/purpose-review/handler.ts
**Date:** 2026-04-25
**Reviewer task_id:** fdf5a51e-28ca-4584-88f2-e922046ee276
**Subject file:** lib/purpose-review/handler.ts
**Acceptance doc:** docs/sprint-5/purpose-review-acceptance.md

---

## Verdict

**2 concrete issues + 1 test gap.** F1 is a code bug requiring a builder fix.
F2 is a Colin decision on ActorType enum. F3 is a test improvement recommendation.

---

## F1 — Bug: `review_message_id` not stored on `revise` action (BLOCKER)

**Severity:** Bug — incorrect behaviour under concurrent tasks
**Evidence:** handler.ts:119-125, route.ts:940-944

### What the handler does

When Colin taps ✏️ (revise), the handler updates task_queue with:
```typescript
metadata: { ...meta, purpose_review: 'pending_notes' }
// review_message_id: messageId  ← MISSING
```

### What route.ts expects

route.ts:940-944 reads `taskMeta.review_message_id` to correlate the follow-up text reply:

```typescript
const storedMsgId = taskMeta.review_message_id as number | undefined
const isMatch = storedMsgId == null || replyToMsgId === storedMsgId
```

When `storedMsgId == null` (which is always the case today), the route accepts **any**
text message as the revision note when any task is in `awaiting_review`. This works
only if at most one task is ever in `awaiting_review` at a time.

### Impact

Under concurrent port chunk processing (the reason this task is named
`blocks: concurrent_purpose_review_correctness`), a second task entering
`awaiting_review` would incorrectly capture text replies intended for the first.

### Fix

In `handlePurposeReviewCallback`, revise branch (handler.ts:119-125), add
`review_message_id: messageId` to the metadata spread:

```typescript
metadata: { ...meta, purpose_review: 'pending_notes', review_message_id: messageId }
```

One-line change; no schema migration required (stored in existing JSONB metadata).

---

## F2 — Doc-code discrepancy: `actor_type` value (COLIN DECISION)

**Severity:** Spec discrepancy — handler is correct per live type definition
**Evidence:** lib/attribution/types.ts:5, handler.ts:104/173/246,
tests/purpose-review.test.ts:295-300, purpose-review-acceptance.md §10

### The discrepancy

| Source | actor_type value |
|--------|-----------------|
| acceptance-doc §10 | `'colin'` |
| lib/attribution/types.ts (ActorType) | `'human'` (valid); `'colin'` NOT in union |
| handler.ts (all 3 recordAttribution calls) | `'human'` |
| tests/purpose-review.test.ts Test 4 | expects `'human'` |

### Handler is correct

The handler uses `'human'`, which is in the `ActorType` union. `'colin'` is not a
valid ActorType. The acceptance doc spec is stale.

### Colin decision required

Two options:

**(a) Accept `'human'`** — Telegram-sourced actions from Colin = actor_type `'human'`,
actor_id `'telegram'`. Update acceptance doc §10 to match. No code change needed.

**(b) Add `'colin'` to ActorType** — Update `lib/attribution/types.ts` to add `'colin'`
to the union. Update handler.ts (3 calls) and tests to use `'colin'`. Acceptance doc
already reflects this. More expressive attribution (separates Colin from other human
actors), but requires migration check on `entity_attribution.actor_type` column
constraint if one exists.

**Recommendation:** Option (a) unless Colin wants richer actor granularity. `'human'`
with `actor_id: 'telegram'` already disambiguates Colin from cron/coordinator actors.

---

## F3 — Test gap: skip flow attribution unverified (RECOMMENDATION)

**Severity:** Minor — test gap only, no production risk
**Evidence:** tests/purpose-review.test.ts Test 5 (lines 310-338)

Test 5 verifies the update and agent_events insert for the skip action but does NOT
assert that `recordAttribution` was called. The handler does call it (line 173), but
removing or corrupting that call would not fail any test.

**Recommendation:** Add to Test 5:
```typescript
expect(recordAttribution).toHaveBeenCalledWith(
  expect.objectContaining({ actor_type: 'human', actor_id: 'telegram' }),
  expect.objectContaining({ type: 'task_queue', id: VALID_UUID }),
  'purpose_reviewed',
  expect.objectContaining({ action: 'skip' })
)
```

---

## Grounding Manifest

| Claim | File:line |
|-------|-----------|
| review_message_id not in metadata on revise | handler.ts:119-125 |
| route.ts reads review_message_id for correlation | route.ts:940-944 |
| ActorType union does not include 'colin' | lib/attribution/types.ts:5 |
| handler uses 'human' | handler.ts:104, 173, 246 |
| Test 4 expects 'human' | tests/purpose-review.test.ts:295-300 |
| Test 5 does not assert recordAttribution | tests/purpose-review.test.ts:310-338 |
