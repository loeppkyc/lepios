# budget-summary — Acceptance Doc

Sprint 5 · chunk: budget-summary
Coordinator task: 8cba5a75-b872-46b7-a13a-bc1058cabf4c
Colin approval: pre-staged with defaults, review_via=pre_staged_with_defaults, 2026-04-26

---

## Scope

When a `work_budget_sessions` row transitions to a terminal status (`completed`, `stopped`,
or `expired`), fire one Telegram notification summarising what happened during the session.

**Acceptance criterion:**
(a) Ending a budget session (any terminal status) inserts exactly one `outbound_notifications`
row with the summary text within 5 seconds of the status flip,
(b) ending the same session twice produces no second notification (dedup via
`metadata.budget_summary_sent`), and
(c) `agent_events` row with `action='budget_summary_sent'` and `meta.session_id` appears
after each successful send.

---

## Summary message content

```
[LepiOS Budget] Session {id_8} ended — {status}
Duration: {N} min ({started_at} → {completed_at})

Tasks claimed ({count}):
  • {id_8} — {description_40}
  ...

Tasks completed ({count}):
  • {id_8} — {description_40}
  ...

Awaiting review/grounding ({count}):
  • {id_8} — {description_40}
  ...

Cost: ${total:.2f}
```

Omit any section with count = 0. Omit Cost line if no cost_log entries found for the window.

---

## Out of scope

- Per-task timing breakdown within the session
- Slack or email delivery (Telegram only)
- Retroactive summaries for already-closed sessions
- Session history UI

---

## Files expected to change

| File | Change |
|------|--------|
| `lib/orchestrator/budget-summary.ts` | New — `buildBudgetSummary(sessionId)` + `fireBudgetSummaryNotification(sessionId)` |
| `lib/orchestrator/budget.ts` | Update — call `fireBudgetSummaryNotification` on terminal status transitions |
| Any manual-stop API route under `app/api/` | Update — same call on explicit stop |
| `tests/orchestrator/budget-summary.test.ts` | New — unit + dedup tests |

---

## Check-Before-Build findings

Builder must verify before coding:

| Item | Expected |
|------|----------|
| `work_budget_sessions` columns | `id, status, budget_minutes, used_minutes, completed_count, started_at, completed_at, source, telegram_chat_id, metadata` |
| `work_budget_sessions.metadata` | JSONB — add `budget_summary_sent: true` flag here for dedup |
| Terminal statuses | `completed`, `stopped`, `expired` — confirm against CHECK constraint in migration 0027 |
| `cost_log` table | Verify existence and schema before querying for session-window cost |
| `harness_config` TELEGRAM_CHAT_ID | Read at call time via Supabase MCP (same as existing notification pattern) |
| Existing budget.ts terminal transition site | Grep `status.*completed\|status.*stopped\|status.*expired` in `lib/orchestrator/budget.ts` |
| Manual-stop route | Grep `app/api` for `stop` or `budget` to find the route |

---

## External deps

| Dep | Note |
|-----|------|
| `outbound_notifications` insert | Use existing pattern — no parse_mode, chat_id from harness_config |
| `task_queue` join | Query tasks where `claimed_at BETWEEN session.started_at AND session.completed_at` for claimed list |
| `agent_events` insert | action=`budget_summary_sent`, meta includes session_id + counts |

---

## Deduplication

Before inserting the notification, check:

```typescript
if (session.metadata?.budget_summary_sent) return
```

After inserting, SET:

```sql
UPDATE work_budget_sessions
SET metadata = metadata || '{"budget_summary_sent": true}'::jsonb
WHERE id = $1
```

---

## F18 metric

```json
{
  "action": "budget_summary_sent",
  "domain": "orchestrator",
  "actor": "budget-summary",
  "status": "success",
  "meta": {
    "session_id": "<id>",
    "session_status": "completed|stopped|expired",
    "tasks_claimed": N,
    "tasks_completed": N,
    "tasks_awaiting": N,
    "duration_minutes": N
  }
}
```

**Benchmark:** summary fires within 5s of terminal status flip. No p-value target for v1 —
surface via `SELECT meta->>'duration_minutes', occurred_at FROM agent_events WHERE action='budget_summary_sent'`.

---

## Grounding checkpoint

1. Create and immediately expire a test session:
   ```sql
   INSERT INTO work_budget_sessions (status, budget_minutes, started_at, completed_at)
   VALUES ('expired', 30, now() - interval '35 minutes', now())
   RETURNING id;
   ```
2. Call `fireBudgetSummaryNotification(id)` directly (or trigger via the expire path).
3. Confirm:
   ```sql
   SELECT payload->>'text' FROM outbound_notifications
   WHERE correlation_id LIKE 'budget-%' ORDER BY created_at DESC LIMIT 1;
   ```
   → Contains session ID, duration, status line.
4. Confirm `agent_events` row with `action='budget_summary_sent'`.
5. Call again — confirm no second `outbound_notifications` row (dedup).
6. Cleanup: `DELETE FROM work_budget_sessions WHERE id = '<test_id>';`

---

## Open questions

All defaults accepted (pre-staged):

- Q1: Include cost in summary? **YES**
- Q2: Include awaiting_* counts at end? **YES**
- Q3: Send even on 'expired' status? **YES**

---

## Cached-principle decisions

`cache_match_enabled: false` for Sprint 5. Pre-staged by Colin 2026-04-26 with defaults accepted.

- Principle 17: no new tables; uses existing `work_budget_sessions.metadata` JSONB for dedup ✓
- Principle 18: `budget_summary_sent` F18 event with session_id + counts ✓
- Principle 19: lib function only, no UI changes ✓
