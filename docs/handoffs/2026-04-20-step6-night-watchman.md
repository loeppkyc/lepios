---
name: Step 6 — Night Watchman
type: project
description: Minimal autonomous orchestration loop — nightly read-only integrity checks + morning Telegram digest
---

# Step 6 — Night Watchman Handoff

**Date:** 2026-04-20
**Verdict:** PENDING VERIFICATION (commit not made — review required)
**Prior step:** Step 5 E2E verified (8/8 PASS, 2026-04-19)

---

## What was built

### New routes

| Route                          | Auth               | Purpose                                                                 |
| ------------------------------ | ------------------ | ----------------------------------------------------------------------- |
| `GET /api/health`              | None               | Lightweight db-reachability probe; used internally by site-health check |
| `GET /api/cron/night-tick`     | Bearer CRON_SECRET | Runs all three integrity checks, writes one agent_events row            |
| `GET /api/cron/morning-digest` | Bearer CRON_SECRET | Reads last night_tick, formats Telegram message, sends or logs failure  |

Both cron routes also accept POST (Telegram bot trigger pattern).

### New modules

```
lib/orchestrator/
  types.ts          — TickResult, CheckResult, Flag, TickStatus, DigestStatus
  config.ts         — ALLOWED_EVENT_DOMAINS, thresholds, getYesterdayRangeMT()
  telegram.ts       — postMessage(), MissingTelegramConfigError
  tick.ts           — runNightTick() (never throws, always writes one agent_events row)
  digest.ts         — composeMorningDigest(), sendMorningDigest()
  checks/
    site-health.ts           — 3 sub-checks: db, knowledge table, /api/health HTTP
    scan-integrity.ts        — missing asin, null profit, negative cost, duplicate isbn
    event-log-consistency.ts — stuck processing, slow events, unknown domains
```

### Vercel cron schedule

```
/api/cron/night-tick      — 0 8 * * *   (08:00 UTC ≈ 02:00 MDT / 01:00 MST)
/api/cron/morning-digest  — 0 12 * * *  (12:00 UTC ≈ 06:00 MDT / 05:00 MST)
```

DST note documented in `vercel.json._dst_note` — schedules are UTC-fixed, ~1h drift acceptable.

---

## Schema workarounds (two)

### 1. agent_events.status CHECK constraint

The `agent_events.status` column has a CHECK constraint: `('success', 'error', 'warning')`.
Step 6 requires finer-grained status values. Mapping applied (spec_v1):

| Spec value        | Column value | Where preserved      |
| ----------------- | ------------ | -------------------- |
| `completed`       | `success`    | `meta.tick_status`   |
| `partial_failure` | `warning`    | `meta.tick_status`   |
| `failed`          | `error`      | `meta.tick_status`   |
| `sent`            | `success`    | `meta.digest_status` |
| `no_tick_found`   | `warning`    | `meta.digest_status` |
| `telegram_failed` | `error`      | `meta.digest_status` |

To query by spec status: `WHERE meta->>'tick_status' = 'partial_failure'`

If a future migration widens the constraint, it would look like:

```sql
ALTER TABLE public.agent_events
  DROP CONSTRAINT agent_events_status_check,
  ADD CONSTRAINT agent_events_status_check
    CHECK (status IN ('success', 'error', 'warning', 'completed', 'partial_failure',
                      'failed', 'sent', 'no_tick_found', 'telegram_failed'));
```

### 2. agent_events.tags is JSONB, not text[]

`agent_events.tags` is `JSONB`, not `text[]`. Supabase JS serializes JS arrays transparently
so inserts are unaffected (`tags: ['night_tick', 'step6', 'read_only']` works correctly).

Query syntax differs from PG array operators:

- Use: `tags @> '["night_tick"]'::jsonb`
- Not: `'night_tick' = ANY(tags)`

Noted for future analytics queries.

---

## Open items from prior sessions

| Item                                                        | Status                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` not in Vercel env | Still unset locally — digest logs `telegram_failed` until set |
| `OLLAMA_TUNNEL_URL` not in Vercel env                       | Not needed for Step 6 (no Ollama calls)                       |
| `generate()` cold-start ~12.6s                              | Not needed for Step 6                                         |

---

## Resume instructions (Step 6.5 or Step 7)

1. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in Vercel env (and `.env.local`) — required for digest to send.
2. Smoke test: `curl -H "Authorization: Bearer $CRON_SECRET" https://lepios-one.vercel.app/api/cron/night-tick`
3. Confirm Telegram message arrives (or `agent_events` shows `status='warning'` + `meta.digest_status='no_tick_found'` if no prior tick).
4. Step 6.5 (daytime tick) adds a second cron for business-hours checks — reads ARCHITECTURE.md §3.2 Tier 2 before writing.
