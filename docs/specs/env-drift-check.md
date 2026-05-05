# Spec — Env Drift Check

**Date:** 2026-05-05
**Status:** approved; queued in `task_queue`
**Closes:** F-E5 / F-E6 from `docs/env-audit-2026-05-05.md`

## Purpose

Detect drift between Vercel env vars and `harness_config` rows for shared keys. Today, `CRON_SECRET` and `TELEGRAM_CHAT_ID` are duplicated. If one is rotated and the other isn't, autonomous agents diverge from the cron auth path. The drift check catches this.

## Scope

Compare these shared keys across surfaces:

| Key | Vercel env var | harness_config row |
|---|---|---|
| `CRON_SECRET` | yes | yes |
| `TELEGRAM_CHAT_ID` | yes | yes |

The check **does not** include single-source keys (`OURA_TOKEN` is harness_config-only by design; `KEEPA_API_KEY` is Vercel-only). It only flags keys in the shared set.

## Implementation

### Cron route — `app/api/cron/env-drift-check/route.ts`

- Auth: `requireCronSecret(request)`
- For each shared key:
  - Read the Vercel value via `process.env.X`
  - Read the harness_config value via SQL: `SELECT value FROM harness_config WHERE key = $1`
  - Compare byte-for-byte (length, content)
  - If mismatch → log to `agent_events` with kind=`env_drift_detected`, payload `{ key, vercel_len, harness_len, vercel_first4, harness_first4 }` (NEVER the full values)
  - Send Telegram alert via `outbound_notifications`

- If no mismatches: log a single `env_drift_clean` event for surfacing.

### Schedule

Daily at 06:30 UTC (between morning_digest at 06:00 and Oura sync at 07:00). Add to `vercel.json` crons.

### Surfacing

Morning digest reads the most recent `env_drift_*` event and includes a one-line status:

- `env drift: clean` (green)
- `env drift: 1 mismatch — CRON_SECRET` (red, alert)

## Acceptance criteria

- [ ] Route returns 200 with `{ ok: true, mismatches: 0 | n }` JSON
- [ ] All 2 shared keys checked
- [ ] Mismatch path: `agent_events` row written, Telegram alert sent, full secret values never logged or sent (only first-4 + last-4)
- [ ] Clean path: `agent_events` row written, no Telegram noise
- [ ] CRON_SECRET auth gate via `requireCronSecret` (F22 compliance)
- [ ] Tests: (a) clean path, (b) mismatch path, (c) missing env var path, (d) missing harness_config row path
- [ ] Cron registered in `vercel.json` at 06:30 UTC daily
- [ ] Morning digest shows env-drift status line

## Build estimate

1 builder session, ~1 hour including tests.

## Tracker impact

Closes F-E5 / F-E6 from env audit. No direct tracker line, but adds to F18 surfacing layer.
