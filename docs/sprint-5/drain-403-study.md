# H1 Study — Drain 403 Root Cause Analysis

**Hardening ID:** H1  
**Task ID:** 8a9dcb62-bcca-4e1f-8381-f502a165d3ae  
**Source:** postmortem `docs/autonomous-loop-postmortem-2026-04-27.md`  
**Date:** 2026-04-27  

---

## What the Postmortem Said

> The notifications-drain endpoint is returning 403 when called from coordinator context. Diagnose whether this is a missing CRON_SECRET header in the coordinator's drain call, a wrong endpoint URL, or a Vercel auth policy. Fix the coordinator's drain invocation so pending notifications are delivered. Verify the two stuck notifications (cce1c002, 1579a94c) either drain or are explicitly superseded.

---

## Root Cause Analysis

### Root Cause A (Primary — Blocking): Host Not in Coordinator Allowlist

**Evidence:**
- `agent_events` row: `action=drain_trigger_failed`, `meta.reason="host_not_in_allowlist"`, `meta.http_status=403` — occurred 2026-04-25 21:16:18 for task 40b1aa4b
- Coordinator's bash `curl` calls to `lepios-one.vercel.app` are blocked by Claude Code's network allowlist
- Confirmed in current session: `curl https://lepios-one.vercel.app/api/harness/quota-forecast` returns `Host not in allowlist`

**What happens:** Claude Code's execution environment enforces a network allowlist. `lepios-one.vercel.app` is not in that allowlist. The bash `curl` call never reaches the Vercel endpoint — the block happens at the Claude Code layer and returns what the coordinator logs as 403.

**This is the primary cause.** Even a perfectly-formed drain call with correct `CRON_SECRET` would fail here.

### Root Cause B (Secondary — Would Block if A Were Fixed): CRON_SECRET Unavailable in Bash

**Evidence:**
- `.env.local` does not exist in coordinator sandbox (`/home/user/lepios/.env.local` absent)
- `CRON_SECRET` bash env var is unset (length 0)
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` bash env vars are also unset

**What happens:** The coordinator.md drain step reads:
```bash
_CS=$(grep -m1 '^CRON_SECRET=' .env.local 2>/dev/null | cut -d'=' -f2-)
```
With no `.env.local`, `_CS` is empty. The drain call would be `Authorization: Bearer ` (empty), which the endpoint would reject with **401** (not 403). Note: the endpoint itself never returns 403 — it returns 401 for auth failures.

**Important:** The coordinator DOES read `CRON_SECRET` from `harness_config` at session startup via MCP SQL. But that value lives only in the LLM working context — it is not injected into the bash environment.

### Root Cause C (Separate Bug): parse_mode=Markdown Fails on Arbitrary Text

**Evidence:**
- Notification `1579a94c` last_error: `Telegram 400 parse_mode=Markdown + underscore in task_id field. Kept for forensics. Original error: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 62`
- `status=failed`, manually marked

**What happened:** The coordinator notification payload included `parse_mode: "Markdown"`. Markdown uses underscores for emphasis. The notification text (the one-line summary) contained an underscore that Telegram tried to interpret as emphasis, broke parsing, returned 400. The drain correctly updated attempts and attempted the retry cycle, but because it was manually marked `failed` it stopped.

**This is a separate bug from the drain 403** — it would cause notification failures even after H1-A and H1-B are fixed, if the underlying text can contain underscores.

---

## Stuck Notifications — Current State

| ID (prefix) | Status at time of postmortem | Status now | Resolution |
|-------------|------------------------------|------------|------------|
| `cce1c002` | pending, 0 attempts | **sent** (2026-04-26 23:41:53 UTC) | Delivered by a later drain cron run. Done. |
| `1579a94c` | pending→failed (1 attempt) | **failed**, manually marked | Telegram 400 (parse_mode bug). Kept for forensics per last_error. Superseded by this study. |

**Both stuck notifications are resolved.** No coordinator action required on them.

---

## Infrastructure Inventory

| Infrastructure | Available? | Notes |
|----------------|------------|-------|
| pg_net extension | **No** | Not installed on Supabase project xpanlbcjueimeofgsara |
| pg_cron extension | **No** | Not installed |
| Vercel crons | 12 daily | All `0 X * * *` or `0 X * * 0` — daily or weekly. No sub-daily. |
| notifications-drain-tick | Yes | Runs at 1 AM UTC daily |
| harness_config.CRON_SECRET | Yes | Readable via MCP SQL at coordinator startup |
| harness_config RLS | Enabled | anon role cannot read — service role required |

---

## The Coordinator.md vs Reality Gap

The coordinator.md Supabase REST patterns use:
```bash
-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}"
-H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```
And:
```bash
"${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/outbound_notifications"
```

None of `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, or `CRON_SECRET` are available in coordinator bash. These patterns in coordinator.md have **never worked** in the coordinator sandbox.

**This means:** The `outbound_notifications` INSERT in coordinator.md is also broken unless fixed. Every coordinator notification INSERT relies on bash env vars that don't exist. The coordinator is currently only able to send notifications via the MCP `execute_sql` approach (if it chooses to).

---

## Fix Options

### Option A — Preferred: Fix Coordinator Bash Environment

**A1 — Allow host:**  
Add `lepios-one.vercel.app` to `.claude/settings.json` network allowlist. Colin does this or approves builder to do it.

**A2 — Get CRON_SECRET into bash:**  
Replace the `.env.local` grep in coordinator.md with a Supabase REST call using the service role key. But since `SUPABASE_SERVICE_ROLE_KEY` is also unavailable in bash, A2 requires one of:
- A2a: Add `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL` to `.claude/settings.local.json` (gitignored) as env vars — then coordinator bash has access
- A2b: Coordinator writes CRON_SECRET to `/tmp/.coord_env_${TASK_ID}` after reading harness_config at startup, bash drain step reads from that file; cleaned up at session end
  - Policy note: coordinator.md says no writes outside docs/ — would need doctrinal update or clarification that /tmp/ is acceptable as session-scoped scratch

**A3 — Fix parse_mode bug:**  
Change notification payload `parse_mode` from `"Markdown"` to `"HTML"` in coordinator.md template, and escape user-provided text in the notification message builder. Plain text (no parse_mode) is safest for arbitrary coordinator-generated text.

**Full Option A acceptance criterion:** Coordinator completion notification reaches Telegram within 60s of task completion (direct drain trigger, not cron cycle).

### Option B — Install pg_net + pg_cron (Fallback Drain)

Install pg_net and pg_cron extensions on Supabase. Create a pg_cron job that runs every 1 minute and calls the Vercel drain endpoint with CRON_SECRET from harness_config via pg_net.http_post.

**This provides autonomous drain independent of coordinator bash** — even if the coordinator's direct drain trigger fails, notifications deliver within 60s via pg_cron.

**Requires:** 2 migrations (install extensions + create cron job), Colin production apply, validation that pg_net can reach Vercel from Supabase infrastructure.

**Weight:** Separate H1-B task (postmortem weight=3 for H3 pickup ordering, H1-B is moderate).

---

## 20% Better Observations

- **Coordinator.md bash patterns are dead code**: The Supabase REST bash patterns have never worked because env vars are absent. All coordinator Telegram sends have relied on the drain cron (when it works) or failed silently. The spec and reality diverged before H1 was written.
- **Notifications-drain-tick (1 AM UTC) is the de facto delivery path**: Every notification sent by the coordinator has gone through the cron, not the direct trigger. This means delivery latency is up to 24 hours.
- **The real fix is making the coordinator bash environment match what coordinator.md assumes**: Either inject env vars at session start (A2a) or rewrite coordinator.md to not rely on bash env vars at all.

---

## Grounding Manifest

| Claim | Evidence | Type |
|-------|----------|------|
| `lepios-one.vercel.app` not in allowlist | `agent_events` row `host_not_in_allowlist`, live curl test this session | **Grounded** |
| Drain returns 401 (not 403) for bad auth | Source code `route.ts:110-111`, line numbers confirmed | **Grounded** |
| 403 in agent_events comes from proxy layer, not endpoint | Endpoint only returns 401 for auth failures; 403 logged before request reaches Vercel | **Grounded** |
| `.env.local` absent | `ls` output in coordinator bash | **Grounded** |
| All bash env vars unset | `echo ${SUPABASE_SERVICE_ROLE_KEY}`, `echo ${CRON_SECRET}` returned empty | **Grounded** |
| cce1c002 sent, 1579a94c failed-manually | Supabase query `outbound_notifications` WHERE id IN (...) | **Grounded** |
| pg_net/pg_cron not installed | `pg_extension` query returned empty result | **Grounded** |
| harness_config has RLS enabled | `pg_tables` query `rowsecurity=true` | **Grounded** |
