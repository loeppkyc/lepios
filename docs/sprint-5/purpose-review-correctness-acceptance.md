# Acceptance Doc — Purpose Review Correctness Fixes

**Feature:** `concurrent_purpose_review_correctness` — correctness patch on the shipped purpose-review gate
**Date:** 2026-04-25
**Status:** approved-by-colin (Telegram, 2026-04-25T19:34:44Z, colin_telegram_19:31)
**Parent task:** 9778dee9-275e-4b95-a556-7122c6db571a (purpose-review gate, chunk)
**This task:** fdf5a51e-28ca-4584-88f2-e922046ee276
**Folds in:** task 9d7f2af7 (add colin to ActorType enum — same migration, same files)

---

## 1. Scope

Fix three correctness gaps surfaced in the purpose-review handoff (9778dee9), all explicitly
decided by Colin in phase_1b Q&A (answered_at 2026-04-25T17:00:00Z):

- **F1** — Store `review_message_id` on the revise path so the text-reply correlator can
  match by message_id instead of falling back to "most recent awaiting_review task."
- **F2** — Add `'colin'` to `ActorType` union; change all three `recordAttribution` calls
  in the purpose-review handler from `actor_type: 'human'` to `actor_type: 'colin'`;
  migrate existing `entity_attribution` rows.
- **F3** — Add skip-flow attribution assertion to Test 5 (currently missing).
- **F2-implicit** — Update Test 4 assertion from `actor_type: 'human'` to `actor_type: 'colin'`
  to match the F2 behaviour change.

**Acceptance criterion:** All four items implemented; 0 `entity_attribution` rows remain with
`actor_type='human' AND actor_id='telegram'` after migration; all tests green.

---

## 2. Out of scope

- Multi-round revise flow (deferred to v2 per TODO in handler.ts)
- Changing the text-reply correlator's fallback logic beyond storing `review_message_id`
- Any other attribution actor_type additions (only 'colin' now)

---

## 3. Files expected to change

| File                                                        | Change                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `lib/attribution/types.ts`                                  | Add `\| 'colin'` to `ActorType` union (F2)                                          |
| `lib/purpose-review/handler.ts`                             | F1: add `review_message_id: messageId` on revise path; F2: 3× `actor_type: 'colin'` |
| `supabase/migrations/0028_attribution_actor_type_colin.sql` | Migrate entity_attribution rows (F2)                                                |
| `tests/purpose-review.test.ts`                              | F3: add skip attribution assertion; F2-implicit: fix Test 4 actor_type              |

No new files. No route changes. No UI changes.

---

## 4. Check-Before-Build findings

- `lib/attribution/types.ts` exists; `ActorType` is a union type on line 5. Confirmed current
  value does not include `'colin'`. **Beef up.**
- `lib/purpose-review/handler.ts` exists; all three `recordAttribution` calls use
  `actor_type: 'human'`. Confirmed. **Beef up.**
- `supabase/migrations/0027_work_budget.sql` is the latest migration — next is 0028. Confirmed.
- `tests/purpose-review.test.ts` — Test 5 (skip flow, line 310) has no `recordAttribution`
  assertion. Test 4 (revise flow, line 296) has `actor_type: 'human'`. Both confirmed via grep.

No prior art to replace or remove.

---

## 5. External deps tested

None. All changes are internal TypeScript + SQL. No new API calls.

---

## 6. Precise implementation notes

### F1 — review_message_id on revise path

In `handlePurposeReviewCallback`, `action === 'revise'` branch, change:

```typescript
metadata: { ...meta, purpose_review: 'pending_notes' },
```

to:

```typescript
metadata: { ...meta, purpose_review: 'pending_notes', review_message_id: messageId },
```

This is a 1-field addition to the existing spread. No other changes in that branch.

### F2 — ActorType + attribution fix

**`lib/attribution/types.ts` line 5:**

```typescript
// before
export type ActorType = 'improvement_engine' | 'coordinator' | 'task_pickup_cron' | 'cron' | 'human'
// after
export type ActorType =
  | 'improvement_engine'
  | 'coordinator'
  | 'task_pickup_cron'
  | 'cron'
  | 'human'
  | 'colin'
```

**`lib/purpose-review/handler.ts` — three call sites** (approve path, skip path, text-reply path):

```typescript
// before (all three)
{ actor_type: 'human', actor_id: 'telegram' }
// after (all three)
{ actor_type: 'colin', actor_id: 'telegram' }
```

**`supabase/migrations/0028_attribution_actor_type_colin.sql`:**

```sql
-- Reclassify purpose_review attribution rows: actor was Colin via Telegram,
-- not a generic 'human'. Matches the ActorType 'colin' value added in this sprint.
UPDATE entity_attribution
SET actor_type = 'colin'
WHERE actor_type = 'human'
  AND actor_id = 'telegram';
```

Note: `entity_attribution.actor_type` is a plain TEXT column (not an enum), so no
constraint alteration is needed. The migration is data-only, not DDL.

### F3 — Skip-flow attribution assertion (Test 5)

Add after the existing `expect(eventCall).toBeDefined()` assertion in Test 5:

```typescript
// recordAttribution called with actor_type='colin' and action='skip'
const recordAttr = recordAttribution as ReturnType<typeof vi.fn>
const attrCall = recordAttr.mock.calls.find((c: unknown[]) => {
  const ctx = c[0] as { actor_type: string }
  const details = c[3] as { action: string }
  return ctx.actor_type === 'colin' && details.action === 'skip'
})
expect(attrCall).toBeDefined()
```

`recordAttribution` is already mocked at line 9 of the test file. No new mocking needed.

### F2-implicit — Test 4 actor_type assertion

In Test 4 (revise flow, line ~296):

```typescript
// before
expect.objectContaining({ actor_type: 'human', actor_id: 'telegram' }),
// after
expect.objectContaining({ actor_type: 'colin', actor_id: 'telegram' }),
```

---

## 7. Grounding checkpoint

**Post-build SQL (run in Supabase dashboard or MCP execute_sql on xpanlbcjueimeofgsara):**

```sql
SELECT COUNT(*) AS unmigrated
FROM entity_attribution
WHERE actor_type = 'human'
  AND actor_id = 'telegram';
```

Expected result: `unmigrated = 0`. If > 0, migration 0028 did not run — apply it manually.

**Tests:** `npm test` must report 0 failing. Builder reports the exact count.

---

## 8. Kill signals

- TypeScript compilation error from `actor_type: 'colin'` not assignable to `ActorType` →
  F2 types change missed.
- `unmigrated > 0` after deploy → migration 0028 not applied to production.
- Test 4 still passing before F2-implicit fix → wrong assertion was there, not actually testing
  the right value. Builder must confirm the test fails without the code change, passes with it.

---

## 9. Cached-principle decisions

Cache-match is **disabled** sprint-wide (sprint-state.md: `cache_match_enabled: false`,
`cache_match_reason: "Sprint 4 baseline"`). All decisions escalated to Colin.

Colin approved this acceptance doc explicitly via Telegram on 2026-04-25T19:34:44Z.

---

## 10. Open questions

None. All three unknowns from the parent handoff (9778dee9) were answered by Colin in
phase_1b Q&A (2026-04-25T17:00:00Z).

---

## 11. Post-grounding action

After Colin confirms `unmigrated = 0` and tests green:

- Coordinator cancels task 9d7f2af7 (AddColinToActorType) — folded into this build.
- Mark this chunk complete in sprint-state.md.
