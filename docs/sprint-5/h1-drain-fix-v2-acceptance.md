# Acceptance Doc — H1 v2: Remove Bash Drain Curl, Use pending_drain_triggers

**Hardening ID:** H1  
**Task ID (H1 main):** 8a9dcb62-bcca-4e1f-8381-f502a165d3ae  
**Related task (F-N28-fix-A):** 165faf9c-80fc-403b-a138-92023530e5cd  
**Status:** COLIN APPROVED — 2026-05-09  
**Date:** 2026-05-09  
**Supersedes:** docs/sprint-5/drain-403-acceptance.md (v1, April 2026 — approach changed by 2b05123b)

---

## Background

The v1 drain-403 acceptance doc proposed fixing coordinator bash network access so the curl to
`/api/harness/notifications-drain` would succeed. That approach was superseded by task 2b05123b
("Replace coordinator drain curl with Supabase-native trigger pattern"), which shipped migration
0041 (`pending_drain_triggers` table) and wired the drain route to process it.

The infrastructure is now correct:

- `pending_drain_triggers` table exists in production (migration 0041, confirmed live via REST)
- `notifications-drain` route reads and processes `pending_drain_triggers` rows on every run
- pg_cron (migration 0168) fires the drain tick every 5 minutes via pg_net — no Vercel cron limits, no sandbox restrictions

**The remaining gap:** coordinator.md Step 3 still instructs a bash curl to the Vercel drain
endpoint. This curl fails with 403/blocked in the coordinator sandbox because the host is not
in the Claude Code network allowlist. The fix is a one-file doc change: replace Step 3 with
an INSERT to `pending_drain_triggers`.

---

## Scope

**One change, one acceptance criterion:**

Replace coordinator.md §"Sending Telegram notifications, Step 3" with an INSERT into
`pending_drain_triggers` via the same Supabase REST pattern coordinator already uses for
`outbound_notifications`. Remove all text about draining via bash curl, 401 CRON_SECRET
mismatch, and "daily 1 AM UTC" cron cycle (stale — drain now runs every 5 min via pg_cron).

**Acceptance criterion:** After this ships, a coordinator session that inserts an
`outbound_notifications` row also inserts a `pending_drain_triggers` row. No bash curl to
Vercel is attempted. Within 5 minutes, pg_cron fires the drain and the notification is delivered.

---

## Out of Scope

- **coordinator-resume / polling pattern** (F-N28-fix-A ACs 2-5): those require new TypeScript
  lib and API route (`coordinator-resume`). That is a separate builder task. This chunk is
  doc-only and ships the immediate fix.
- **b93658c2 (LEPIOS_BASE_URL / awaiting_grounding):** that task's grounding checkpoints
  (apply migration 0101, seed LEPIOS_BASE_URL) are now unnecessary. The pg_cron approach
  doesn't need a base URL config. Recommend Colin mark b93658c2 as `cancelled` (superseded).
- **harness_config LEPIOS_BASE_URL entry:** if migration 0101 was not applied, no action
  needed — the pending_drain_triggers approach requires no LEPIOS_BASE_URL.

---

## Files Expected to Change

| File                            | Change                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.claude/agents/coordinator.md` | Replace Step 3 bash curl block with INSERT to `pending_drain_triggers`. Update Step 4 stale "daily 1 AM UTC" reference. Remove 401/mismatch/drain-failure error handling (no longer applicable). |

No schema changes. No code changes outside agent spec.

---

## Check-Before-Build Findings

| Item                                  | Finding                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending_drain_triggers` schema       | `id uuid, created_at timestamptz, triggered_by text NOT NULL, task_id text, status text CHECK IN ('pending','processed'), processed_at timestamptz`                                                                                                                                                                                                                    |
| coordinator Supabase REST pattern     | Already established — coordinator inserts to `outbound_notifications` via the same curl + `${NEXT_PUBLIC_SUPABASE_URL}` pattern. Builder reuses it.                                                                                                                                                                                                                    |
| Step 3 current text                   | Lines 574-593 of coordinator.md — all stale, all removed                                                                                                                                                                                                                                                                                                               |
| drain cron schedule                   | pg_cron: `notifications_drain_5min` runs at `2-57/5 * * * *` (every 5 min, offset 2 min). Vercel daily cron at `/api/cron/notifications-drain-tick` still exists as a belt-and-suspenders fallback.                                                                                                                                                                    |
| NEXT_PUBLIC_SUPABASE_URL availability | Written to `/tmp/coordinator-secret` path pattern? No — Supabase URL is already in the outbound_notifications insert block as `${NEXT_PUBLIC_SUPABASE_URL}`. Coordinator reads from `harness_config` at startup and uses these values in all REST calls. Builder must verify the variable name used in the existing outbound_notifications block and use the same one. |

---

## Exact Replacement Text for coordinator.md Step 3

**Remove (lines 574–593, approximately):**

````
## Step 3 — Trigger drain (best-effort)

```bash
# CRON_SECRET is in /tmp/coordinator-secret ...
_CS=$(cat /tmp/coordinator-secret 2>/dev/null || echo "")
DRAIN_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST https://lepios-one.vercel.app/api/harness/notifications-drain \
  -H "Authorization: Bearer ${_CS}" 2>/dev/null || echo "000")
unset _CS
````

On failure:

- `200` → delivered; proceed.
- `401` → CRON_SECRET in `/tmp/coordinator-secret`...
- Any other code → log `drain_trigger_failed`...

Do not abort on drain failure. For interactive approval sessions...

````

**Replace with:**

```markdown
## Step 3 — Signal drain (insert to pending_drain_triggers)

The coordinator sandbox cannot call Vercel endpoints directly. Instead, insert a row into
`pending_drain_triggers` — the pg_cron job fires the drain within 5 minutes via pg_net
with no sandbox restrictions.

```bash
# Signal drain by inserting a row to pending_drain_triggers.
# pg_cron fires /api/cron/notifications-drain-tick every 5 minutes (migration 0168).
# No bash curl to Vercel needed — coordinator sandbox cannot reach it anyway.
DRAIN_SIGNAL=$(curl -s -X POST "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/pending_drain_triggers" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"triggered_by\": \"coordinator\", \"task_id\": \"${TASK_ID}\"}" 2>/dev/null || echo "")
DRAIN_SIGNAL_ID=$(echo "$DRAIN_SIGNAL" | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d,list) and d else 'SIGNAL_FAILED')" \
  2>/dev/null)
if [ "$DRAIN_SIGNAL_ID" = "SIGNAL_FAILED" ] || [ -z "$DRAIN_SIGNAL_ID" ]; then
  echo "[coordinator] pending_drain_triggers insert failed — notification will deliver on next cron cycle (within 5 min)"
fi
````

Non-fatal if the insert fails. pg_cron fires the drain every 5 minutes regardless.

````

**Also update Step 4** — change:
- OLD: "notification delivers on next cron cycle (daily 1 AM UTC via `/api/cron/notifications-drain-tick`)"
- NEW: "notification delivers on next pg_cron cycle (within 5 minutes via `notifications_drain_5min` pg_cron job, migration 0168)"

---

## Grounding Checkpoint

**Colin verifies (no live coordinator session required — DB query is sufficient):**

1. Run any coordinator session (or wait for the next autonomous pickup).
2. After the session inserts an `outbound_notifications` row, check:
   ```sql
   SELECT id, triggered_by, task_id, status, processed_at
   FROM pending_drain_triggers
   ORDER BY created_at DESC LIMIT 5;
````

Expect: a row with `triggered_by='coordinator'` and `status='processed'` within 5 minutes. 3. Check the notification was delivered:

```sql
SELECT id, status, sent_at, (extract(epoch from sent_at) - extract(epoch from created_at))::int as latency_s
FROM outbound_notifications
ORDER BY created_at DESC LIMIT 3;
```

Expect: `status='sent'`, `latency_s < 300` (within 5 min). 4. Confirm NO `drain_trigger_failed` rows appear in `agent_events` for the coordinator session.

This is a DB-state grounding checkpoint per Principle 14 escape hatch — no physical-world artifact
required for a config/doc change.

---

## Kill Signals

- If `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` are not available in coordinator
  bash at INSERT time, the insert fails silently. Builder must confirm these are the same variable
  names used in the existing `outbound_notifications` INSERT block (Step 2).
- If `pending_drain_triggers` table is missing (shouldn't be — confirmed live), drain signal fails.
  Fallback: Vercel daily cron still runs as belt-and-suspenders.

---

## Cached-Principle Decisions

None — this doc escalates to Colin unconditionally per Non-negotiable #2 (coordinator never
self-approves acceptance docs).

---

## Open Questions for Colin

None. The approach is clear:

1. `pending_drain_triggers` is live in prod
2. pg_cron fires every 5 min
3. The fix is a pure text replacement in coordinator.md — no schema, no new code
4. `b93658c2` (LEPIOS_BASE_URL approach) should be marked `cancelled` — superseded

---

## Numeric Field Definition Table

Not applicable — no SP-API financial data in this chunk.
