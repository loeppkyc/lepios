# Coordinator Runtime Environment — Phase 1 Study

**Date:** 2026-04-25
**Task:** 87bc8578-6eb8-4f84-b522-00c4804a2398
**Status:** complete — feeds coordinator-env-acceptance.md
**Prior escalation:** Q2 + Q3 answered by Colin in task metadata (review_action=approved)

---

## Phase 1a — What It Does

The coordinator is a Claude Code routine (fired via Anthropic Routines API). It runs
every sprint cycle: claims a task from task_queue, produces acceptance docs, delegates
to builder, reviews handoffs.

Two critical shell variables the coordinator needs at runtime:

| Var | Used for | Current source |
|-----|----------|----------------|
| `CRON_SECRET` | Bearer token in heartbeat + drain curl calls | `process.env.CRON_SECRET` (Vercel only) |
| `TELEGRAM_CHAT_ID` | Recipient in outbound_notifications inserts | `process.env.TELEGRAM_CHAT_ID` (Vercel only) |

**Root cause:** coordinator runtime is a Claude Code session, not a Vercel serverless
function. Vercel env vars are injected at build/runtime for Next.js routes — they are
not present in a Claude Code sandbox. `$CRON_SECRET` and `$TELEGRAM_CHAT_ID` are empty
strings in the coordinator shell.

**Observed effects (grounded in agent_events):**
- Heartbeat curls fail silently (no auth header → Vercel returns 401 or 200-passthrough
  depending on route guard: `if (!secret) return true // dev: no secret configured`)
- outbound_notifications inserts succeed (coordinator uses Supabase REST with service_role)
  BUT `chat_id` field is empty string → drain route logs
  `'no chat_id and TELEGRAM_CHAT_ID not configured'` → notification never delivered
- Colin receives no Telegram messages from coordinator runs

**Source references:**
- `app/api/harness/invoke-coordinator/route.ts:14-17` — CRON_SECRET guard
- `app/api/harness/task-heartbeat/route.ts:1` — CRON_SECRET auth pattern
- `.claude/agents/coordinator.md:37` — heartbeat curl uses `$CRON_SECRET`
- `.claude/agents/coordinator.md:370` — notification insert uses `${TELEGRAM_CHAT_ID}`
- `app/api/harness/notifications-drain/route.ts:76-80` — TELEGRAM_CHAT_ID fallback

## Phase 1a — How It Does It (Current)

**Fire path:** `lib/harness/invoke-coordinator.ts:40-55`
- Reads `COORDINATOR_ROUTINE_ID` and `COORDINATOR_ROUTINE_TOKEN` from process.env (Vercel)
- POST to `https://api.anthropic.com/v1/claude_code/routines/{id}/fire`
- Body: `{ "text": "task_id: {uuid}\nrun_id: {uuid}" }` — plain text, no secrets passed

**Coordinator startup (current):**
- Receives only `task_id` and `run_id` in the fire body
- No CRON_SECRET or TELEGRAM_CHAT_ID in the environment
- Has: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (environment connectors, always present)

**Notification path (current, broken):**
1. Coordinator builds JSON with `"chat_id": "${TELEGRAM_CHAT_ID}"` → empty string
2. INSERT succeeds (Supabase accepts any text)
3. Drain reads row, finds no chat_id and env TELEGRAM_CHAT_ID not set → skips delivery

## Phase 1a — Domain Rules Embedded

1. **CRON_SECRET must never appear in agent output or committed files verbatim.**
   (CLAUDE.md §5 security safeguards — applies to coordinator too)
2. **harness_config reads must log to agent_events** (action, keys fetched, no values).
   This is the audit trail Colin can query to verify config was read without exposing values.
3. **Graceful degradation required** — if harness_config row is missing, coordinator
   continues with empty var. Existing behavior (heartbeat_skipped, notification_insert_failed)
   is already documented in coordinator.md:40-43.
4. **Colin manually inserts the secret values** — no automated seeding of secrets into
   harness_config from code or agent output.

## Phase 1a — Edge Cases

| Case | Current behavior | Target behavior |
|------|-----------------|-----------------|
| harness_config table missing | query fails → empty var → degradation | same degradation, error logged |
| harness_config row for key missing | query returns [] → empty var | same; no retry |
| SUPABASE_SERVICE_ROLE_KEY unavailable | coordinator can't query anything | fail-fast at startup, log to agent_events, continue |
| CRON_SECRET rotated | old value in harness_config → heartbeats 401 | degradation until Colin updates harness_config row |

## Phase 1b — Twin Q&A

**Status: blocked (endpoint unreachable — coordinator sandbox blocks outbound HTTP)**

Pending questions routed to Colin:

1. "Should harness_config store CRON_SECRET as plaintext TEXT, or encrypted at rest?"
   — Colin answered via task metadata (q3_answer): "Acceptable for solo-operator harness."
   → **Plaintext TEXT is approved.** Supabase DB encryption at rest covers the storage layer.

2. "Is there an existing audit logging pattern for config reads in agent_events?"
   — Codebase grep: no prior harness_config reads exist. Nearest pattern: `invoke-coordinator.ts`
   logs `action='invoke_coordinator'` with meta (no secret values). Same pattern applies.
   → **Grounded from codebase, no escalation needed.**

## Phase 1c — 20% Better

Compared to current (silent failure / no notifications):

| Category | Improvement |
|----------|-------------|
| Correctness | Fix: coordinator Telegram messages actually deliver. Currently 0% delivery rate. |
| Observability | Startup log (agent_events action=harness_config.read) makes config fetch auditable without revealing values. |
| Extensibility | harness_config is a general key-value store. Future secrets (e.g. OLLAMA_TUNNEL_URL) extend the same table, same pattern, zero migration cost. |
| Security | Service-role RLS means anon/authenticated roles cannot read harness_config even via Supabase client. Colin's dashboard cannot accidentally expose it. |
| Rotation-friendliness | Colin updates a single row in harness_config to rotate CRON_SECRET — no Vercel env var redeploy required for coordinator. |

**F17 integration:** Every coordinator notification closes the behavioral loop — Colin sees
run status on mobile, which is the signal that drives path probability updates (approved /
rejected / ignored ratio over time).

**F18 metric — notification_delivery_latency:**
- Formula: `sent_at - created_at` on `outbound_notifications` table
- Both columns already exist (created_at: NOT NULL DEFAULT now(), sent_at: nullable)
- Target: p50 < 60s (drain cron fires every 5min; baseline latency 0-300s window)
- Secondary metric: harness_config.read success rate (action='harness_config.read',
  status='success' vs 'error') in agent_events — target 100% after initial population

## Phase 1c — Pending Colin Qs

None. All questions answered via task metadata or codebase grep.

---

## Grounding Manifest

| Claim | Evidence | File:line |
|-------|----------|-----------|
| CRON_SECRET only in process.env (Vercel) | source read | app/api/harness/task-heartbeat/route.ts:1 |
| Fire body passes only task_id + run_id | source read | lib/harness/invoke-coordinator.ts:77 |
| TELEGRAM_CHAT_ID only in process.env | source read | app/api/harness/notifications-drain/route.ts:22 |
| coordinator uses ${TELEGRAM_CHAT_ID} in notify | source read | .claude/agents/coordinator.md:370 |
| outbound_notifications has created_at + sent_at | DB schema query | Supabase execute_sql |
| No harness_config table exists | DB schema query | Supabase execute_sql (no match) |
| task_queue RLS pattern (authenticated) | migration read | supabase/migrations/0015_add_task_queue.sql |
| Colin approved plaintext + harness_config approach | task metadata | task_queue.metadata.q3_answer |
| Q2: TELEGRAM_CHAT_ID in DB ok | task metadata | task_queue.metadata.q2_answer |
