# Sprint 5 — coordinator-env: Streamlit Study / Problem Analysis

> **Recovery artifact.** The original study doc was written in session `87bc8578` (2026-04-25)
> but was not committed to disk. This recovery doc is reconstructed from the approved task
> metadata (`task_queue` row `87bc8578-6eb8-4f84-b522-00c4804a2398`). Colin approved the
> acceptance doc via callback at `2026-04-25T23:05:19Z`.

---

## What it does (problem statement)

The coordinator sub-agent runs as a Claude Code Routine fired by
`lib/harness/invoke-coordinator.ts`. The fire payload contains only `task_id` and `run_id`:

```ts
body: JSON.stringify({ text: `task_id: ${task_id}\nrun_id: ${run_id}` })
```

Inside the coordinator session, the agent must:

1. **Send heartbeats** to `/api/harness/task-heartbeat` — requires `Authorization: Bearer $CRON_SECRET`
2. **Send Telegram notifications** via the `outbound_notifications` table — requires knowing `TELEGRAM_CHAT_ID` for the `chat_id` field, and triggering the drain at `/api/harness/notifications-drain` — also requires `Authorization: Bearer $CRON_SECRET`

**Root cause:** `CRON_SECRET` is a Vercel environment variable. It is available inside Next.js server-side code (`process.env.CRON_SECRET`) but is **not** injected into the coordinator agent's bash environment when it runs as a Claude Code Routine. Same problem for `TELEGRAM_CHAT_ID`.

As a result, heartbeats are silently skipped and Telegram notifications cannot be sent, which means Colin receives no async signals that the coordinator ran.

---

## How it works today

| Config value | Available in Next.js? | Available in coordinator bash? | Impact |
|---|---|---|---|
| `CRON_SECRET` | ✓ (`process.env`) | ✗ | Heartbeat skipped; drain-trigger fails |
| `TELEGRAM_CHAT_ID` | ✓ (`process.env`) | ✗ | Notifications insert misses `chat_id`; drain fallback covers it |

Coordinator.md currently says: "If CRON_SECRET is unavailable: log `agent_events` row… do NOT abort." So the agent runs but produces no real-time signals.

Note: `TELEGRAM_CHAT_ID` is slightly less critical — the drain has a fallback at
`notifications-drain/route.ts:113`: `const defaultChatId = process.env.TELEGRAM_CHAT_ID`. If
`chat_id` is null in the row, the drain fills it from Vercel env. So Telegram notifications
**do** arrive eventually, they just have a null `chat_id` in the DB row. CRON_SECRET is the
harder gap: there is no fallback.

---

## Fix options considered

| Option | Description | Verdict |
|---|---|---|
| A | Pass `CRON_SECRET` in the fire payload (modify `fireCoordinator`) | Simpler, but secrets in `task_queue` text field — logged to DB |
| B | Create `harness_config` table; coordinator reads at startup via Supabase MCP | Selected — service-role-only RLS, single source of truth, rotate-friendly |
| C | Internal auth path — coordinator calls a no-secret internal route | More complex; requires new route |

---

## Twin Q&A

**Status: blocked — endpoint unreachable** (all calls failed during original session).
Questions routed to Colin instead.

### Q1: Is the CRON_SECRET gap the confirmed root cause of missing heartbeats?
**A (Colin):** Yes — diagnosed in previous session, recorded in 87bc8578 description. Root
cause: coordinator runtime cannot read `process.env.CRON_SECRET`. Recommended fix was Option A
(pass secret in fire payload).

### Q2: Should TELEGRAM_CHAT_ID also go into harness_config?
**A (Colin):** Yes — harness_config table with service-role-only RLS. TELEGRAM_CHAT_ID is not
a secret, just a chat number.

### Q3: Which fix option for CRON_SECRET?
**A (Colin):** (c) CRON_SECRET in harness_config. Same fix pattern as Q2 — single source of
truth for coordinator runtime config. Service-role RLS, audit log on read, rotate-friendly.
Acceptable for solo-operator harness. Branch A.

### Q4: Any Vercel plan concern?
**A (Colin):** Non-blocking acknowledged — Vercel plan stays Hobby for now, Pro deferred until
ports prove out.

---

## 20% Better

This is a greenfield fix, not a port. No Streamlit predecessor. 20% Better loop N/A.

Improvements vs. current (skipped heartbeats + silent coordinator):

- **Correctness:** CRON_SECRET available → heartbeats fire reliably → stale-reclaim window is
  respected → no false reclaims.
- **Observability:** TELEGRAM_CHAT_ID explicit in DB row → every notification is traceable back
  to the specific chat.
- **Extensibility:** `harness_config` is now the right place to add future coordinator runtime
  config (e.g., `NIGHT_TICK_CHAT_ID`, `BUILDER_ROUTINE_ID`) without modifying the fire payload.

---

## Fragile points

- CRON_SECRET value must be inserted by Colin manually after migration — the migration seeds an
  empty row; the coordinator will fail its first heartbeat until Colin inserts the real value.
- If the harness_config table is dropped or truncated, coordinator goes silent. Worth adding a
  startup guard: log `agent_events` if the row is missing.
