# F-N28-fix-A Acceptance Doc — Coordinator: Remove Drain Calls, Exit-on-Notify

**Task ID:** 165faf9c-80fc-403b-a138-92023530e5cd  
**Fix label:** F-N28-fix-A  
**Kind:** harness_fix  
**Date:** 2026-05-09  
**Status:** AWAITING COLIN APPROVAL  

---

## Root Cause

`CRON_SECRET` is not exported into the coordinator sandbox's bash environment — there is no `.env.local` in the cloud coordinator sandbox. The drain call (`curl ... /api/harness/notifications-drain -H "Authorization: Bearer ${_CS}"`) silently returns 403. Because the drain never succeeds, the 30-minute poll loop completes with no response, and the coordinator exits having logged no notification delivery. The Telegram message was never sent.

The H1 fix (PR #34) improved the drain credentials path by sourcing CRON_SECRET from `/tmp/coordinator-secret` (populated via Supabase REST at session start). That change works for local coordinator sessions where the env is partially available, but it doesn't address the underlying architectural flaw: **the coordinator should not be responsible for triggering the drain**. The drain is the cron's job.

---

## Scope

Remove all `notifications-drain` curl calls from coordinator.md. Replace the 30-minute poll loop with an exit-then-resume pattern: coordinator inserts notification, records the row_id in task metadata, exits. On re-invocation the coordinator reads the response from the metadata and proceeds.

**One acceptance criterion:** After this ships, run any coordinator session that sends a requires_response notification. The coordinator exits after inserting the notification row without calling the drain. Telegram delivers the message on the next drain cron cycle. When Colin responds, the coordinator is re-invoked and resumes at the correct phase.

---

## Out of Scope

- Changes to the drain cron schedule (already runs daily 1 AM UTC)
- H1-B (pg_net + pg_cron autonomous drain) — still deferred
- F-N28-fix-B (pending approvals banner) — separate task `de3e9459`

---

## Files Expected to Change

| File | Change |
|------|--------|
| `.claude/agents/coordinator.md` | Remove Step 3 (drain trigger) from "Sending Telegram notifications"; replace Step 4 poll loop with exit-on-notify pattern; add startup check for `pending_notification_response` in task metadata |
| `app/api/harness/coordinator-resume/route.ts` | **New file.** Called by the telegram webhook handler when a coordinator notification response arrives. Finds the task by pending_notification_id, writes response to metadata, transitions task from `awaiting-approval` → `queued` (priority 1). |
| `app/api/telegram-webhook/route.ts` (or existing webhook handler) | On `response_received`: call coordinator-resume with the notification row_id and parsed response |

`lib/coordinator/notify-and-await.ts` is explicitly **out of scope** — coordinator behavior is expressed in coordinator.md bash blocks, not TypeScript modules.

---

## Check-Before-Build Findings

| Item | Finding |
|------|---------|
| `/api/harness/coordinator-resume` | Does not exist — builder creates fresh |
| Telegram webhook handler location | Confirm before writing: search for `telegram-webhook` or `bot-webhook` in `app/api/` |
| coordinator.md "Sending Telegram notifications" | Confirmed: Steps 3 and 4 are the drain trigger and poll loop — builder targets these |
| task_queue has metadata JSONB | Confirmed — can store arbitrary keys including `pending_notification_id` and `pending_notification_response` |
| outbound_notifications schema | Has `status`, `response` columns — response column holds the parsed callback |

---

## Implementation Design

### New Coordinator Startup Check (add before Phase 0 in coordinator.md)

```bash
# Check for pending notification response from prior exit
PENDING_NOTIF_RESP=$(curl -s \
  "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/task_queue?id=eq.${TASK_ID}&select=metadata" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d[0].get('metadata',{}).get('pending_notification_response','')))" 2>/dev/null)

if [ "$PENDING_NOTIF_RESP" != '""' ] && [ -n "$PENDING_NOTIF_RESP" ]; then
  # Clear the response from metadata and proceed
  ACTION=$(echo "$PENDING_NOTIF_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('action',''))" 2>/dev/null)
  # Action is 'approve' or 'reject'
  # Clear pending keys from metadata
  curl -s -X PATCH "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/task_queue?id=eq.${TASK_ID}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"metadata\": $(... remove pending_notification_id and pending_notification_response ...)}" \
    > /dev/null
fi
```

(Builder implements the exact JSONB strip; the pattern is the contract.)

### Replace Step 3 and Step 4 (poll loop) with Exit Pattern

After Step 2 (insert into outbound_notifications and get ROW_ID):

```bash
# Record notification row_id in task metadata and exit
curl -s -X PATCH "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/task_queue?id=eq.${TASK_ID}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"metadata\": jsonb_set(metadata, '{pending_notification_id}', '\"${ROW_ID}\"')}" \
  > /dev/null

# Transition task to awaiting-approval
curl -s -X PATCH "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/task_queue?id=eq.${TASK_ID}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "awaiting-approval"}' > /dev/null

# Log drain_deferred_to_cron
# INSERT INTO agent_events ... action='drain_deferred_to_cron' ...
echo "Notification queued (row ${ROW_ID}). Drain deferred to cron. Exiting."
exit 0
```

### New `/api/harness/coordinator-resume/route.ts`

```typescript
// POST { notification_id: string }
// Auth: requireCronSecret
// Called by telegram webhook when outbound_notifications.status = 'response_received'
// Finds task by pending_notification_id, copies response to pending_notification_response, transitions to 'queued' (priority 1)
```

---

## Acceptance Criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| AC1 | `grep -r "notifications-drain" .claude/agents/coordinator.md` returns zero results | Builder runs this after edit; reviewer enforces |
| AC2 | After inserting notification row, coordinator writes `pending_notification_id` to task metadata via Supabase REST and exits | Run coordinator task; query `SELECT metadata FROM task_queue WHERE id = '<task_id>'` — expect `pending_notification_id` key present |
| AC3 | On re-invocation, coordinator reads `pending_notification_response` from metadata and acts on it | Manually set `pending_notification_response = {"action":"approve"}` in task metadata; re-fire coordinator; confirm it proceeds with approval |
| AC4 | Coordinator does not call `/api/harness/notifications-drain` for any reason | `grep -r "notifications-drain" .claude/agents/coordinator.md` — zero results (same as AC1) |
| AC5 | agent_events row with `action='drain_deferred_to_cron'` on every coordinator exit with pending notification | Query `SELECT * FROM agent_events WHERE action='drain_deferred_to_cron' ORDER BY occurred_at DESC LIMIT 3` after a coordinator run |

---

## Grounding Checkpoint

**Colin verifies (after builder ships):**

1. Run any coordinator task that requires approval (e.g. queue a test acceptance doc).
2. Confirm coordinator exits without polling: task transitions to `awaiting-approval` within 30 seconds of notification insert.
3. `SELECT metadata FROM task_queue WHERE id = '<task_id>'` — expect `pending_notification_id` key.
4. `SELECT action FROM agent_events WHERE action = 'drain_deferred_to_cron' ORDER BY occurred_at DESC LIMIT 1` — expect a row.
5. When Telegram message arrives (on next drain cron) and Colin responds: `SELECT metadata FROM task_queue WHERE id = '<task_id>'` — expect `pending_notification_response` key.
6. Verify coordinator re-invocation picks up response and proceeds to correct phase.

---

## Kill Signals

- If the telegram webhook handler can't be modified to call coordinator-resume (e.g. it's locked or external), this pattern is blocked — escalate.
- If NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unavailable in coordinator bash (same env issue as drain), the exit-notification path also fails — if this is the case, the root fix is in session environment setup, not coordinator.md patterns.

---

## Cached-Principle Decisions

None — escalating to Colin unconditionally. This is a material behavioral change to coordinator.md (a seam-adjacent file) and establishes a new coordinator lifecycle pattern.

---

## Open Questions for Colin

1. **coordinator-resume caller**: Should the telegram webhook handler call coordinator-resume directly on `response_received`, or should the pickup cron detect `awaiting-approval` tasks with `status=response_received` on their pending notification? Direct webhook call is faster; pickup cron call is simpler. Recommend: pickup cron check (runs hourly, acceptable latency for approval flows).

2. **JSONB strip for pending_notification keys**: Confirm: when coordinator resumes and processes the response, it should clear `pending_notification_id` and `pending_notification_response` from task metadata. This avoids stale keys on re-invocation if the same task is re-used. If tasks are always cloned (new UUID) on retry, this is moot.

3. **Priority on re-queue**: coordinator-resume transitions task to `queued` with priority=1 (jumps queue). Acceptable? Alternative: insert a NEW task_queue row with the response in metadata (cleaner audit trail).
