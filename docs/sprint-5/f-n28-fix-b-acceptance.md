# F-N28-fix-B Acceptance Doc — Pending Approvals Banner on /autonomous

**Task ID:** de3e9459-c1b5-407a-945b-dd73d9d92a67  
**Fix label:** F-N28-fix-B  
**Kind:** cockpit_feature  
**Date:** 2026-05-09  
**Status:** AWAITING COLIN APPROVAL  

---

## Root Cause

When the coordinator inserts a `requires_response=true` notification into `outbound_notifications`, there is no visible signal on the cockpit that a pending approval is waiting. The notification may sit undelivered (drain 403, F-N28-fix-A) or delivered but unnoticed. Colin's only option is to manually query `outbound_notifications` in Supabase. This creates approval rot — acceptance docs waiting silently for days while coordinator work stalls.

---

## Scope

Add a `PendingApprovalsBanner` to the `/autonomous` dashboard page. The banner queries a new `/api/harness/pending-approvals` endpoint (polling every 60s). When one or more `requires_response=true` notifications have been `pending` for >5 minutes, the banner surfaces them with text, age, and a "Force Resend" button.

**One acceptance criterion:** Manually set an `outbound_notifications` row to `status=pending`, `requires_response=true`, `created_at=NOW()-interval '10 minutes'`. Open `/autonomous`. The banner appears within 60 seconds showing the notification text and age. Click Force Resend — drain is triggered, banner refreshes.

---

## Out of Scope

- Fixing drain 403 itself — F-N28-fix-A handles that
- Notification history or audit log — separate feature
- Mobile push notifications — separate channel

---

## Files Expected to Change

| File | Change |
|------|--------|
| `app/api/harness/pending-approvals/route.ts` | **New file.** GET endpoint, requireCronSecret auth (or public? — see Open Questions). Returns rows from `outbound_notifications` where `requires_response=true AND status='pending' AND created_at < NOW()-interval '5 minutes'`. |
| `app/(dashboard)/autonomous/_components/PendingApprovalsBanner.tsx` | **New file.** Client component. Polls `/api/harness/pending-approvals` every 60s. Renders amber banner with notification text, age, and Force Resend button. Hides when no pending rows. |
| `app/(dashboard)/autonomous/page.tsx` | Import and render `PendingApprovalsBanner` above existing content. |

---

## Check-Before-Build Findings

| Item | Finding |
|------|---------|
| `/api/harness/pending-approvals` | Does not exist — builder creates fresh |
| `/autonomous` page | Exists at `app/(dashboard)/autonomous/page.tsx` — server component, builder adds client `PendingApprovalsBanner` import |
| `outbound_notifications` schema | Has `status`, `requires_response`, `created_at`, `payload` columns — `payload.text` is the notification text |
| Auth pattern for cockpit API routes | See `requireCronSecret` in `lib/auth/cron-secret.ts` — use for `/api/harness/**` routes; confirm if cockpit-facing routes need different auth |
| F20 compliance | Builder must use shadcn/ui + Tailwind only; no inline styles |

---

## Implementation Design

### `/api/harness/pending-approvals/route.ts`

```typescript
// GET — no auth (cockpit dashboard polls this; Colin is the viewer)
// Returns: { rows: Array<{ id, text, age_minutes, created_at }> }
// Query:
//   SELECT id, payload->>'text' as text, created_at,
//     EXTRACT(EPOCH FROM (NOW() - created_at))/60 AS age_minutes
//   FROM outbound_notifications
//   WHERE requires_response = true
//     AND status = 'pending'
//     AND created_at < NOW() - INTERVAL '5 minutes'
//   ORDER BY created_at ASC
```

Log `agent_events` row with `action='pending_approvals_surfaced'` when result count >= 1 (fire-and-forget, non-blocking). Log only when count > 0 to avoid noise on clean polls.

### `PendingApprovalsBanner.tsx`

```tsx
'use client'
// Poll /api/harness/pending-approvals every 60s (useEffect + setInterval)
// Render: amber banner per pending row — "⚠ Approval needed: {text} (N min ago)"
// Force Resend button: POST /api/harness/notifications-drain (with CRON_SECRET header) then refresh
// Banner hidden when rows array is empty
```

**Note on Force Resend auth**: The drain endpoint requires CRON_SECRET. The Force Resend button should call `/api/harness/pending-approvals/resend` (new sub-route, POST, requireCronSecret) which calls the drain internally. Avoids CRON_SECRET exposure to browser. Alternative: Colin pastes CRON_SECRET to force resend — worse UX.

Simplest acceptable path: add a `POST /api/harness/notifications-drain/force` route (or reuse existing drain) that accepts requireCronSecret from a server action, and the banner triggers it via a server action or API call.

Builder chooses the simplest compliant pattern (no inline style, no secret exposure to browser).

---

## Acceptance Criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| AC1 | `GET /api/harness/pending-approvals` returns rows where `requires_response=true AND status='pending' AND created_at < NOW()-5min` | Insert test row, wait 6 min, call endpoint — expect row in response |
| AC2 | Banner renders on `/autonomous` when endpoint returns >=1 row, showing notification text and age | Manual: insert pending row, open `/autonomous`, confirm banner appears within 60s |
| AC3 | Force Resend button triggers drain and banner refreshes | Click button, check `agent_events` for drain trigger, banner should update within 10s |
| AC4 | Banner disappears when all rows have `status=sent` or `status=response_received` | Mark test row sent, refresh page — banner gone within 60s |
| AC5 | `agent_events` row with `action='pending_approvals_surfaced'` on each poll that finds >=1 stuck row | Query after AC2 test — expect at least one row |

---

## Grounding Checkpoint

**Colin verifies (after builder ships):**

```sql
-- Insert test pending row
INSERT INTO outbound_notifications (channel, payload, requires_response, status, created_at)
VALUES ('telegram', '{"text": "Test approval needed"}', true, 'pending', NOW() - INTERVAL '10 minutes')
RETURNING id;
```

1. Open `/autonomous` page.
2. Within 60 seconds: amber banner should appear with text "Test approval needed (10 min ago)" approximately.
3. Click Force Resend — verify drain is triggered (check `agent_events` for drain action).
4. Update the test row to `status='sent'`, wait 60 seconds — banner disappears.
5. Clean up: `DELETE FROM outbound_notifications WHERE payload->>'text' = 'Test approval needed'`.

---

## Kill Signals

- If `/autonomous` page has architectural constraints that prevent client component imports (e.g. strict server-only boundary), builder escalates with the constraint before implementing.
- If drain endpoint auth makes Force Resend impossible without exposing CRON_SECRET, builder proposes alternative (server action pattern) — both are acceptable.

---

## Cached-Principle Decisions

None — escalating to Colin. This adds a new UI component to the cockpit and a new harness API endpoint. Not cache-matchable under current sprint-state.md governance.

---

## Open Questions for Colin

1. **Pending-approvals endpoint auth**: Should `/api/harness/pending-approvals` require CRON_SECRET (like other harness routes), or should it be public (cockpit dashboard polls it; Colin is the only viewer)? Recommend: public GET, CRON_SECRET-gated POST for drain. No secrets in browser. Confirm.

2. **5-minute threshold**: Is 5 minutes the right age threshold before a pending notification is "stuck"? Could be shorter (2 min) if drain cron runs more frequently. Current drain: daily 1 AM UTC → 5 min is effectively instant for morning. Recommend 5 min. Confirm.

3. **Banner placement**: Above QualityTrends or below header? Recommend: above all content (amber full-width) so it's impossible to miss. Confirm or specify placement.
