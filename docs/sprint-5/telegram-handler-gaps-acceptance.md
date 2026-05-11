# Acceptance Doc — Telegram Handler Gaps
**chunk:** `telegram-handler-gaps`
**task_id:** `4011807f-62b5-4048-95b1-f10408148c8e`
**filed:** 2026-05-11
**coordinator:** auto (harness task — Colin-fired via Telegram command)

---

## Audit Summary

Full audit of all Telegram handler code against all task_queue status values.

**Complete coverage (no action needed):**
- `queued` (improvement_proposal) → approve/dismiss buttons ✅
- `claimed` (purpose_review gate) → approve/revise/skip buttons ✅
- `awaiting_review` → free-text notes reply ✅
- `awaiting_grounding` → approve/reject text + single-letter option ✅
- `awaiting_approval` → coordinator-resume route (via outbound_notifications) ✅
- `safety.review.requested` (agent_events) → approve/block/defer buttons ✅

**Gaps identified:**

| # | Status | Gap | Severity |
|---|--------|-----|----------|
| A | `review_timeout` | No recovery handler; alert instructs `/review {id} approve\|skip` but webhook has no such handler | **Critical** — tasks permanently stuck |
| B | `acceptance_doc_ready` | Referenced in webhook lines 958 + 1118 but NOT in schema CHECK constraint — dead code | **Schema debt** — unreachable code branches |

---

## Part A — `review_timeout` Recovery Handler

### Scope
Add `/review {taskId} approve|skip|revise <notes>` command handler to the Telegram webhook. Allow Colin to unblock a task stuck in `review_timeout`.

### Acceptance criterion
Colin can type `/review <taskId_prefix> approve` (or `skip` or `revise <notes>`) in Telegram and the task transitions correctly. The `/review` handler runs before the no-match log.

### Out of scope
- Bulk `/review all approve` — deferred
- Any changes to how `review_timeout` is set (timeout.ts behavior unchanged)

### Files expected to change
- `app/api/telegram/webhook/route.ts` — add `/review` command handler
- `lib/harness/coordinator-commands.ts` — add `handleReviewCommand()` or handle inline in webhook
- `tests/api/telegram-webhook.test.ts` — add tests for review_timeout recovery

### Check-Before-Build findings
- `timeout.ts` line 18–21: alert text already instructs `/review {taskId} approve|skip` — handler must match this exact format
- `lib/purpose-review/handler.ts` has `handlePurposeReviewCallback()` and `handlePurposeReviewTextReply()` — review command transitions should mirror `handlePurposeReviewCallback()` logic
- No existing `/review` command in `coordinator-commands.ts`

### State transitions (required)
```
review_timeout + /review {id} approve  → claimed  (metadata.purpose_review='approved')
review_timeout + /review {id} skip     → cancelled (metadata.cancelled_via='review_command')
review_timeout + /review {id} revise <notes> → claimed (metadata.purpose_notes=notes, purpose_review='approved')
```

### Partial match — `taskId` lookup
- `{taskId}` is the first 8 chars of the UUID (matching timeout.ts alert format)
- Use `.ilike('id', '${prefix}%')` with `.eq('status', 'review_timeout')` — same pattern as existing correlation_id lookups

### Confirmation message back to Colin
- approve/revise: `"Unblocked task {prefix} — study will resume on next pickup."`
- skip: `"Cancelled task {prefix}."`
- not found: `"No review_timeout task found matching {prefix}."`

### Grounding checkpoint
Run `node -e "require('./lib/purpose-review/timeout').checkPurposeReviewTimeouts()"` manually to time out a test task, then send `/review {prefix} approve` in Telegram — confirm task transitions to `claimed` and pickup triggers.

---

## Part B — `acceptance_doc_ready` Schema Gap

### Open question for Colin (choose one — required before build)

The webhook at lines 958 and 1118 filters on `.in('status', ['awaiting_grounding', 'acceptance_doc_ready'])`. But `acceptance_doc_ready` is not in the schema CHECK constraint (migration 0180). These are dead code branches.

**Option A — Add to schema** *(coordinator recommendation)*
Add `acceptance_doc_ready` to the task_queue status CHECK constraint (migration 0200).
Then document in coordinator.md: coordinator can set `status = 'acceptance_doc_ready'` + send a direct Telegram message when an acceptance doc needs approval, without using the outbound_notifications queue. The webhook already handles it.
- Pro: simpler coordinator approval flow for acceptance docs; no outbound_notifications row needed; coordinator can show the full doc path inline in the message
- Con: creates two approval flows (outbound_notifications + coordinator-resume vs direct-Telegram + acceptance_doc_ready)
- Reversible: yes — can drop with compensating migration if unused

**Option B — Remove dead code** *(simplification)*
Remove `acceptance_doc_ready` from both `.in()` filters in the webhook. Keep using `awaiting_approval` + `outbound_notifications` for all coordinator approvals.
- Pro: one approval flow, no schema change
- Con: loses the expressiveness of a purpose-specific status for acceptance doc reviews
- Reversible: yes — code-only change

**Builder waits for Colin's choice before proceeding.**

### If Colin chooses Option A — files expected to change
- `supabase/migrations/0200_acceptance_doc_ready_status.sql` — add `acceptance_doc_ready` to CHECK constraint
- `.claude/migration-claims.json` — claim 0200
- `docs/sprint-state.md` — update
- Coordinator.md update proposed (Colin applies; coordinator writes proposal)

### If Colin chooses Option B — files expected to change
- `app/api/telegram/webhook/route.ts` — lines 958 and 1118: remove `'acceptance_doc_ready'` from both `.in()` filters
- `tests/api/telegram-webhook.test.ts` — remove/update any acceptance_doc_ready test cases

---

## Kill signals
- If the `/review` command regex conflicts with existing coordinator commands — escalate before build
- If `review_timeout` tasks have non-standard metadata shapes (no `module_path`) — adapt lookup

## Cached-principle decisions
- None — escalating to Colin per META-C: no exact cached principle match for "add missing webhook handler for task status X". Schema migration + new webhook code path.

## Open questions
1. **Part B decision required**: Option A (add to schema) or Option B (remove dead code)?
2. Should `/review` support `revise` with multi-word notes, or just `approve` / `skip` as per current alert text?
