# Acceptance Doc — Grounding Reply Fix

**Task ID:** 27f70e12-d3e8-4de0-80db-1f30d587be5e  
**Chunk ID:** grounding-reply-fix  
**Sprint:** 5 (harness hardening)  
**Written by:** Coordinator 2026-05-11  

---

## Scope

Fix the awaiting-grounding reply handler so that when Colin approves a grounding
checkpoint via Telegram button or text, the coordinator is re-invoked to proceed
to Phase 5 (grounding-pass handling).

**Acceptance criterion:** Colin approves a grounding checkpoint notification →
task transitions to `queued` (priority 1) → pickup fires coordinator → coordinator
resumes at grounding-pass phase. Confirmed by agent_events row `action='coordinator_resumed'`
and task_queue status transitioning through `queued → running → completed`.

---

## Out of Scope

- The broader `approved` status for acceptance-doc approvals (unchanged — acceptance
  doc approvals correctly transition to `approved` for builder pickup)
- Recovery of the 3 tasks currently stuck (separate grounding checkpoint below)
- Coordinator.md Phase 4 Step 5 vs Phase 5 routing inconsistency (doc debt, not code)
- `grounding_pass` legacy action in old notifications (superseded by `approve`)

---

## Root Cause (confirmed)

**Three code sections** each transition `awaiting_grounding` tasks to `approved`
on a Colin approval. `approved` is NOT in the task-pickup cron's claim filter
(`queued` only). Coordinator is never re-invoked. Tasks sit in `approved` permanently.

**Evidence (live DB 2026-05-11):**
- 3 tasks have `response_received` notifications but remain in `awaiting_grounding`:
  - `91adca3c` (T-003 Receipts) — Colin approved 2026-05-10 03:50:36
  - `a3de7bed` (F18 ceiling) — Colin approved 2026-05-10 03:04:49
  - `4aa53419` (ingest-health-notes) — Colin responded 2026-05-09 14:07:52

**Section 1 — Webhook Dispatch I inline handler** (`app/api/telegram/webhook/route.ts` ~L953):
```typescript
// BUG: transitions awaiting_grounding → approved (pickup cron ignores approved)
.update({ status: 'approved', ... })
```

**Section 2 — Webhook text "approve" handler** (~L1128):
```typescript
// BUG: same transition for text-based approval
.update({ status: 'approved', ... })
```

**Section 3 — coordinator-resume** (`app/api/harness/coordinator-resume/route.ts` L43):
```typescript
// BUG: only looks for awaiting_approval tasks, misses awaiting_grounding
.eq('status', 'awaiting_approval')
```

---

## Fix

### File 1: `app/api/telegram/webhook/route.ts`

**Dispatch I inline handler (~L954):**

1. Add `status` to `.select('id, metadata')` → `.select('id, metadata, status')`

2. Split `cbAction === 'approve'` branch by task status:
   - If `status === 'awaiting_grounding'`: transition to `queued` (priority 1) +
     write `pending_notification_response: responsePayload` to metadata
   - If `status === 'acceptance_doc_ready'`: keep existing `approved` transition

```typescript
// BEFORE:
if (cbAction === 'approve') {
  await db.from('task_queue').update({
    status: 'approved',
    metadata: { ...existingMeta, approved_via: 'telegram_button', ... },
  }).eq('id', taskId)
  void triggerPickup()
}

// AFTER:
if (cbAction === 'approve') {
  const taskStatus = (pendingTask as { id: string; status?: string }).status
  if (taskStatus === 'awaiting_grounding') {
    // Grounding checkpoint pass — re-queue coordinator for Phase 5
    await db.from('task_queue').update({
      status: 'queued',
      priority: 1,
      metadata: {
        ...existingMeta,
        pending_notification_response: responsePayload,
        grounding_approved_via: 'telegram_button',
        grounding_approved_at: new Date().toISOString(),
        grounding_approved_by: fromUser ? String(fromUser.id) : null,
      },
    }).eq('id', taskId)
  } else {
    // Acceptance doc approval — builder pickup
    await db.from('task_queue').update({
      status: 'approved',
      metadata: {
        ...existingMeta,
        approved_via: 'telegram_button',
        approved_at: new Date().toISOString(),
        approved_by: fromUser ? String(fromUser.id) : null,
      },
    }).eq('id', taskId)
  }
  void triggerPickup()
}
```

**Text "approve" handler (~L1115):**

1. Add `status` to `.select('id, metadata')` → `.select('id, metadata, status')`

2. Same split in the `isApprove` branch (mirror above pattern)

### File 2: `app/api/harness/coordinator-resume/route.ts`

Expand status filter (L43) to also find `awaiting_grounding` tasks by `pending_notification_id`:

```typescript
// BEFORE:
.eq('status', 'awaiting_approval')

// AFTER:
.in('status', ['awaiting_approval', 'awaiting_grounding'])
```

This is belt-and-suspenders: covers tasks where coordinator correctly stored
`pending_notification_id` in metadata but set status to `awaiting_grounding`
instead of `awaiting_approval`.

---

## Files Expected to Change

- `app/api/telegram/webhook/route.ts` — 2 sections (~L953–L978 and ~L1115–L1145)
- `app/api/harness/coordinator-resume/route.ts` — 1 line (L43)
- `tests/api/telegram-webhook.test.ts` — add 2 test cases
- `tests/harness/coordinator-drain-auth.test.ts` or new
  `tests/harness/coordinator-resume.test.ts` — add test for `awaiting_grounding` case

No schema change. No migration needed.

---

## Check-Before-Build Findings

- `app/api/telegram/webhook/route.ts` confirmed exists (1392 lines, read 2026-05-11)
- `app/api/harness/coordinator-resume/route.ts` confirmed exists (101 lines, read 2026-05-11)
- `responsePayload` variable IS in scope at Dispatch I inline handler (defined line ~908)
- Existing test file: `tests/api/telegram-webhook.test.ts` confirmed exists

---

## Grounding Checkpoint

After deploy, Colin runs:

1. **Verify fix forward:**
   ```
   SELECT id, task, status FROM task_queue
   WHERE status = 'queued'
   ORDER BY created_at DESC LIMIT 5
   ```
   (3 stuck tasks should appear here after recovery step below)

2. **Recovery for 3 stuck tasks** (run immediately after deploy):
   ```sql
   -- Re-queue tasks that received responses while bug was live
   UPDATE task_queue
   SET status = 'queued',
       priority = 1,
       metadata = metadata || jsonb_build_object(
         'pending_notification_response',
         '{"type":"callback","action":"approve","via":"bug-fix-recovery","recovered_at":"2026-05-11"}',
         'grounding_recovery', true
       )
   WHERE id IN (
     '91adca3c-06a5-4b69-8d9e-dd4e51b2a224',
     'a3de7bed-2bce-4832-a1a1-28b87f104d62',
     '4aa53419-8b04-45a8-8117-af08fc45052d'
   )
   AND status = 'awaiting_grounding';
   ```
   Expected: 3 rows updated. Coordinator pickup fires within ≤1h (hourly cron).

3. **Smoke test button path (live):**  
   Set a test task to `awaiting_grounding`, send a notification, tap Approve.
   Verify: `task_queue.status = 'queued'` (not `approved`), `agent_events` row
   `action='coordinator_resumed'`.

4. Confirm `agent_events` shows `coordinator_resumed` for re-invoked tasks.

---

## Kill Signals

- Build introduces a TypeScript error on `status` field access — stop, fix type cast
- Text handler or Dispatch I handler breaks for `acceptance_doc_ready` tasks — revert

---

## Cached-Principle Decisions

None requiring Colin decision. This is a straightforward bug fix: wrong enum value
in transition logic (`approved` → `queued`). All decisions are implementation choices
with no domain-semantic impact.

---

## Open Questions

None. Root cause is confirmed with evidence from 3 live stuck tasks.

---

## Cache-Match Block

```
2026-05-11T14:30:00Z sprint=5 chunk=grounding-reply-fix
doc=docs/sprint-5/grounding-reply-fix-acceptance.md
cited_principles: [H1-H5 harness fix pattern, reversibility, META-C]
trigger_match_evidence: |
  Pattern: "fix wrong status enum value in task transition handler"
  Evidence of prior match: H1 (drain 403), H2 (heartbeat status filter .eq→.in),
  H3 (pickup unclaim on 429), H5 (branch pre-config) — all used same pattern:
  identify exact line, change one conditional, write test, ship.
  Current situation: Dispatch I inline handler and text handler use
  `status: 'approved'` where `status: 'queued'` is needed for awaiting_grounding.
  coordinator-resume uses `.eq('status','awaiting_approval')` where `.in(...)` needed.
  Trigger match: "harness route has wrong status value in condition, causing silent
  no-op when coordinator should be re-invoked" — exact match for H2 pattern
  (heartbeat used .eq('claimed') where .in(['claimed','running']) needed).
reversibility_check: |
  Change 1: webhook approve-branch status string 'approved' → 'queued' — reversible
  by reverting the commit. No migration, no data loss.
  Change 2: coordinator-resume .eq → .in — reversible by reverting. No migration.
  Change 3: select adds 'status' field — reversible by removing. Non-breaking.
  All changes reversible-free.
confidence: high
outcome: cache-match-approved — proceeding to escalate to Colin with fix scope
```

---

## Cost This Run

Coordinator session: ~30k tokens (research + doc). Chunk: grounding-reply-fix.
