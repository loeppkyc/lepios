# H1 Acceptance Doc — Fix Coordinator Drain 403

**Hardening ID:** H1  
**Task ID:** 8a9dcb62-bcca-4e1f-8381-f502a165d3ae  
**Study doc:** `docs/sprint-5/drain-403-study.md`  
**Status:** AWAITING COLIN APPROVAL  
**Date:** 2026-04-27  

---

## Scope

Fix the coordinator's notification delivery pipeline so that a coordinator completion notification reaches Telegram within 60 seconds of task completion.

**One acceptance criterion:** After this ships, run any coordinator session to completion. The resulting `outbound_notifications` row transitions from `pending` → `sent` within 60 seconds. Colin verifies by checking `sent_at` vs `created_at` in Supabase.

---

## Root Causes (from study doc)

| # | Root Cause | Effect |
|---|-----------|--------|
| A | `lepios-one.vercel.app` not in coordinator bash network allowlist | Drain curl call blocked by Claude Code proxy → logs as 403 |
| B | `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` unset in coordinator bash (no `.env.local`) | Empty bearer token → would get 401 even if host were reachable |
| C | `parse_mode: "Markdown"` in notification payloads | Telegram 400 on text containing underscores — separate from drain 403 but breaks delivery |

All three must be fixed. A alone fails at B. A+B alone risks C on every notification.

---

## Out of Scope

- **pg_net + pg_cron installation** (H1-B): autonomous 1-min drain backup. Deferred — separate task, weight=2. Delivers belt-and-suspenders, not required for the 60s criterion if this chunk passes.
- **Pickup ordering / queue serialization** (H3): separate postmortem item, weight=3.
- **Session log preservation** (H4): separate item.
- **The two stuck notifications** (cce1c002, 1579a94c): resolved — cce1c002 sent, 1579a94c manually marked failed (forensics, superseded by this fix).

---

## Files Expected to Change

| File | Change |
|------|--------|
| `.claude/settings.json` | Add `lepios-one.vercel.app` to network allowlist (or `allowedHosts` equivalent) |
| `.claude/settings.local.json` | Add env vars: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `CRON_SECRET` — this file is gitignored; Colin must populate values |
| `.claude/agents/coordinator.md` | Update §"Runtime Config" startup section to write env vars to a session temp file; update §"Sending Telegram notifications" Step 3 to use the service-role key for Supabase REST insert (not bash curl to Vercel) or to source from temp env; fix `parse_mode` to `"HTML"` throughout |

---

## Proposed Implementation

### Fix A — Network Allowlist

In `.claude/settings.json`, add:
```json
"allowedHosts": ["lepios-one.vercel.app"]
```
(Exact key name depends on Claude Code's settings schema — builder should verify via `update-config` skill or Claude Code docs before writing.)

### Fix B — Env Vars in Coordinator Bash

**B1 — Create `.claude/settings.local.json`** (gitignored, Colin populates values):
```json
{
  "env": {
    "SUPABASE_URL": "https://xpanlbcjueimeofgsara.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "<colin-fills-this>",
    "CRON_SECRET": "<colin-fills-this>"
  }
}
```

If `.claude/settings.local.json` already exists (check before creating), merge the `env` block.

**B2 — Update coordinator.md Runtime Config section** to replace the `.env.local` grep in drain step:

Old drain step read:
```bash
_CS=$(grep -m1 '^CRON_SECRET=' .env.local 2>/dev/null | cut -d'=' -f2-)
```

New drain step read (sources from settings.local.json env, which sets `CRON_SECRET` in bash):
```bash
# CRON_SECRET is set via .claude/settings.local.json env block.
# If unset, log and skip — do not abort.
_CS="${CRON_SECRET:-}"
```

Similarly fix the `outbound_notifications` INSERT bash block:
```bash
SUPA_URL="${SUPABASE_URL:-}"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
```
And the `outbound_notifications` poll block.

If any of these are empty, log `agent_events` row with `action='notification_env_missing'` and continue (non-fatal for session; fatal for delivery).

### Fix C — parse_mode Safety

In coordinator.md, all notification payload templates: change `"parse_mode": "Markdown"` to `"parse_mode": "HTML"`. HTML is safer than Markdown for arbitrary coordinator-generated text because only explicit `<b>`, `<i>`, `<code>` tags are interpreted — underscores, asterisks, and backticks in plain text are safe.

Existing `*bold*` or `_italic_` in coordinator.md templates: replace with `<b>bold</b>` or `<i>italic</i>`. If templates use none (they appear to be plain text), just removing `parse_mode` entirely is safest.

---

## Check-Before-Build Findings

| Item | Finding |
|------|---------|
| `.claude/settings.json` | Exists — builder must read before editing |
| `.claude/settings.local.json` | Likely absent — builder confirms with `ls .claude/` before creating |
| `coordinator.md` drain step | Confirmed uses `.env.local` grep — target for replacement |
| `coordinator.md` Supabase bash patterns | Use `${SUPABASE_SERVICE_ROLE_KEY}` bare — these also need env vars now available |
| No migrations required | This chunk is config + doc changes only |
| No schema changes | outbound_notifications table untouched |

---

## Grounding Checkpoint

**Colin verifies (after builder ships and settings.local.json is populated):**

1. Confirm `.claude/settings.local.json` exists with env block and values filled.
2. Run a coordinator session for any small task (or this task again).
3. `SELECT id, status, sent_at, created_at, (extract(epoch from sent_at) - extract(epoch from created_at))::int as latency_s FROM outbound_notifications ORDER BY created_at DESC LIMIT 3;`
4. Expect: newest row `status=sent`, `latency_s < 60`.
5. If `latency_s` is NULL or > 300, drain is still not triggering — check `agent_events` for `notification_env_missing` rows.

---

## Kill Signals

- If Claude Code's `settings.json` does not have an `allowedHosts` key or equivalent, this fix is blocked pending Anthropic docs check by builder.
- If `settings.local.json` env vars are not available in coordinator bash even after the fix (test: `echo ${CRON_SECRET}` in coordinator bash should be non-empty), the fix is incomplete.
- If the drain endpoint starts returning errors after the allowlist is added (e.g., Vercel Deployment Protection), that's a new root cause requiring separate diagnosis.

---

## Cached-Principle Decisions

None — `cache_match_enabled: false` (Sprint 4 baseline). This doc escalates to Colin unconditionally.

---

## Open Questions for Colin

1. **settings.local.json env vars**: Is it acceptable to store `SUPABASE_SERVICE_ROLE_KEY` in `.claude/settings.local.json` (gitignored) on your dev machine? This is the cleanest path. Alternative: store only `CRON_SECRET` there and use the Supabase MCP (which already has the service role key) for all Supabase REST calls, making the bash patterns secondary.

2. **parse_mode change**: Coordinator.md notification templates currently use `parse_mode: "Markdown"`. Switching to HTML is a cosmetic change — confirms no intentional Markdown formatting in notification bodies.

3. **H1-B deferral**: pg_net + pg_cron autonomous drain is deferred. If you want the 1-min autonomous fallback, queue H1-B separately with weight=2.
