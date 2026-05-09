# Harness Approval Listener — Acceptance Doc

**Task:** `57ef5c6a-447f-40a9-aebd-9491a2753ace`
**Task type:** `harness_approval_listener`
**Coordinator task:** `57ef5c6a-447f-40a9-aebd-9491a2753ace`
**Date:** 2026-05-09
**Cache-match:** DISABLED — harness gap task, greenfield, no sprint cache-match override applies

---

## Scope

Extend the Telegram webhook's task-approval handler so that when a task transitions to
`status='approved'`, a `builder_needed` notification is immediately inserted into
`outbound_notifications` (delivering to Telegram via drain) **or** the builder routine
is fired directly when `BUILDER_ROUTINE_ID` is configured in `harness_config`.

**Acceptance criterion:** When `task_queue` is updated to `status='approved'` via the
Telegram approve button or text reply, a `builder_needed` Telegram notification appears
within the next drain cycle (≤5 min) containing the `task_id` and a paste-ready
`Run task <task_id>` instruction. No manual SQL intervention required.

---

## Out of scope

- Modifying `claim_next_task` RPC (not needed for this minimal fix; approved tasks are
  handled by the notification path, not the coordinator re-invocation path)
- Implementing `BUILDER_ROUTINE_ID` direct-fire (requires BUILDER_ROUTINE_ID to be
  configured — wired in the code but guarded behind harness_config check)
- Handling `approved_via: 'manual_db'` cases (Colin explicitly chose manual — out of band)
- Polling cron for approved tasks (would require a new Vercel cron slot; Hobby plan has
  one hourly slot already used by task-pickup — deferred)

---

## Phase 1a findings

### Confirmed gap

The webhook (`app/api/telegram/webhook/route.ts`, lines 939–993) already:
1. Sets `task_queue.status = 'approved'` on Colin's approve button press ✓
2. Calls `triggerPickup()` after approval ✓

But `triggerPickup()` → pickup cron → `claim_next_task` RPC which is `WHERE status = 'queued'`
only (`supabase/migrations/0016_add_pickup_fns.sql`, confirmed). Result: 'approved' tasks
sit indefinitely.

Evidence this gap is still live: task `3dcf9706` (subdir-detection scanner) was approved
2026-05-09 via `approved_via: 'manual_db'` because no automatic listener exists.

### Option analysis

| Option | Feasibility | Why |
|--------|-------------|-----|
| (a) pg_notify → Edge Function | Not now | Requires `BUILDER_ROUTINE_ID` in harness_config (absent) |
| (b) New polling cron | Blocked | Vercel Hobby plan uses its one hourly slot for task-pickup (F-L11 precedent) |
| (b) Extend existing pickup for approved | Future | Viable when BUILDER_ROUTINE_ID configured; no Hobby slot issue |
| (c) Webhook extend + notify | **Recommended** | Works now, no migration, no new cron slot, forward-compatible |

### Runtime config at study time

| Key | Value |
|-----|-------|
| `HARNESS_REMOTE_INVOCATION_ENABLED` | `true` |
| `BUILDER_ROUTINE_ID` | not set |
| `TASK_PICKUP_ENABLED` | set via env var (not in harness_config) |

---

## Files expected to change

| File | Change |
|------|--------|
| `app/api/telegram/webhook/route.ts` | Add `handleApprovedTask(taskId, taskDescription)` function + call it in both approve paths (button callback line ~965, text reply line ~1129) |
| `tests/harness/approval-listener.test.ts` | New — F21 acceptance tests |

No migration. No schema change. No new cron route.

---

## Implementation spec

### New function `handleApprovedTask()`

Add to `app/api/telegram/webhook/route.ts`:

```typescript
async function handleApprovedTask(taskId: string, taskDescription: string): Promise<void> {
  const db = createServiceClient()

  // Check for BUILDER_ROUTINE_ID in harness_config (forward-compat path)
  const { data: routineRow } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'BUILDER_ROUTINE_ID')
    .maybeSingle()
    .catch(() => ({ data: null }))

  const routineId = (routineRow as { value?: string } | null)?.value ?? null

  if (routineId) {
    // Future path: fire builder routine directly.
    // Requires BUILDER_ROUTINE_ID in harness_config.
    // Implementation deferred — log warning for now.
    await logEvent({
      task_type: 'approval_listener_builder_routine_pending',
      status: 'warning',
      output_summary: `BUILDER_ROUTINE_ID set but direct-fire not implemented: ${taskId.slice(0, 8)}`,
      meta: { task_id: taskId, routine_id: routineId },
    })
    return
  }

  // Fallback path: insert builder_needed notification to Telegram
  const shortId = taskId.slice(0, 8)
  const preview = taskDescription.length > 60 ? taskDescription.slice(0, 60) + '…' : taskDescription
  const text = [
    `[builder_needed] Task ${shortId} approved`,
    preview,
    '',
    `To hand off to builder — paste in a builder window:`,
    `Run task ${taskId}`,
  ].join('\n')

  await db
    .from('outbound_notifications')
    .insert({
      channel: 'telegram',
      chat_id: process.env.TELEGRAM_CHAT_ID ?? null,
      payload: { text, parse_mode: 'HTML' },
      requires_response: false,
    })
    .catch(() => {
      // Non-fatal — notification missed, builder pickup must be manual
    })
}
```

### Call sites — add `void handleApprovedTask(...)` in two places

**Button callback approve path** (after the `.update({ status: 'approved', ... })` call,
around line 965 of `webhook/route.ts`):

```typescript
if (cbAction === 'approve') {
  await db.from('task_queue').update({ status: 'approved', ... }).eq('id', taskId)
  void handleApprovedTask(taskId, String((pendingTask as { task?: string }).task ?? '')).catch(() => {})
  void triggerPickup()
}
```

**Text reply approve path** (after the `.update({ status: 'approved', ... })` call,
around line 1120 of `webhook/route.ts`):

```typescript
await db.from('task_queue').update({ status: 'approved', ... }).eq('id', taskId)
void handleApprovedTask(taskId, '').catch(() => {})
void triggerPickup()
```

> Note: `task` field is not fetched in the text-reply path — pass empty string; the
> notification text degrades gracefully (`preview` is empty but `taskId` is present).
> Builder can read the task description from task_queue.

---

## Check-Before-Build findings

| Check | Result |
|-------|--------|
| Existing `fireBuilder` / `BUILDER_ROUTINE_ID` references | None found in lib/, app/, supabase/ |
| Existing `builder_needed` references | None found |
| `triggerPickup()` already called on approve | Yes — lines ~965, ~1129 of webhook/route.ts |
| `outbound_notifications` insert pattern | Established — see coordinator.md §Sending Telegram notifications |
| Migration needed | No |
| New cron needed | No |

---

## F17 — Behavioral ingestion justification

This closes the coordinator→builder handoff gap. Every future autonomous build cycle
passes through this path. Agent event `approval_listener_builder_needed` logged per
activation — surfaceable as "how many tasks needed manual builder pickup this month?"
Drives the `coordinator→builder autonomous ratio` metric (eventual F18 benchmark).

---

## F18 — Measurement + benchmark

| Metric | How to query | Benchmark |
|--------|-------------|-----------|
| Builder_needed notifications fired | `SELECT COUNT(*) FROM outbound_notifications WHERE payload->>'text' ILIKE '%builder_needed%'` | Should trend to 0 as BUILDER_ROUTINE_ID is configured |
| Time-to-builder-pickup after approval | `approved_at` in task metadata vs `claimed_at` in builder task | Target: <15 min |
| Approvals via Telegram vs manual_db | `SELECT metadata->>'approved_via', COUNT(*) FROM task_queue WHERE status IN ('approved','completed') GROUP BY 1` | Telegram share should increase over time |

---

## Grounding checkpoint

DB-state query (no physical-world artifact required — all digital flow):

```sql
-- After the next task is approved via Telegram button:
SELECT id, created_at, payload->>'text' as text_preview
FROM outbound_notifications
WHERE payload->>'text' ILIKE '%builder_needed%'
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 3;
```

Expect: ≥ 1 row with `text_preview` containing `Run task <uuid>`.

Also verify agent_events (F18):
```sql
SELECT action, status, meta FROM agent_events
WHERE action IN ('approval_listener_builder_needed', 'approval_listener_builder_routine_pending')
ORDER BY occurred_at DESC LIMIT 5;
```

---

## Kill signals

- Colin says the builder is always fired manually — stop, close as won't-fix
- `BUILDER_ROUTINE_ID` configured before this is built — upgrade to direct-fire path
  instead; the notification fallback is still useful as a "fired builder" confirmation

---

## META-C evaluation

**Cache-match DISABLED** — this is a greenfield harness gap task with no sprint
cache-match frame. Every decision escalates to Colin.

This doc is submitted to Colin for explicit approval before going to builder.

---

## Open questions

None. All three options evaluated; Option C is the clear fit. The only decision Colin
must make: approve this approach, or defer until BUILDER_ROUTINE_ID is configured
(in which case this becomes the direct-fire implementation instead).

---

## Builder pre-flight notes

1. **Read the full webhook handler** (`app/api/telegram/webhook/route.ts`) before editing —
   it is 1,334 lines with multiple dispatch layers. Identify the exact line numbers for
   both approve paths before inserting the `handleApprovedTask()` call.

2. **F21 — tests before code**: Write `tests/harness/approval-listener.test.ts` first.
   The test must verify:
   - `handleApprovedTask()` inserts an `outbound_notifications` row when no BUILDER_ROUTINE_ID
   - `handleApprovedTask()` logs a warning and does NOT insert a row when BUILDER_ROUTINE_ID is set
   - The notification text contains the task_id and 'Run task' instruction

3. **No migration**: Confirm `supabase/migrations/` has no new file after this chunk ships.
   The acceptance criterion is met entirely in TypeScript.

4. **F20**: No TSX files touched — F20 grep requirement does not apply.
