# Quota-Forecast Endpoint Public + Stale Telegram Token

**Date:** 2026-05-05
**Found during:** Read-only audit pass + `/health` skill run
**Status:** Two unrelated questions, neither blocking

---

## Item 1 — `/api/harness/quota-forecast` is intentionally public

The audit flagged this as a CRITICAL F22 violation: the route handler
calls neither `requireCronSecret()` nor any `getUser()` gate. Verified
in `app/api/harness/quota-forecast/route.ts:6-9`.

But `.claude/agents/coordinator.md:157` explicitly documents it as
public:

> **The forecast endpoint is read-only and requires no auth.**
> Do not pass `CRON_SECRET`.

The coordinator agent calls it via plain `curl` from sub-agent context
where pulling `CRON_SECRET` from `harness_config` would add startup
overhead (and is documented as not needed).

So it's **not** an F22 violation — F22 applies to "routes that require
CRON_SECRET auth," and this one was deliberately declared not to.

### The real question for Colin

Should this endpoint stay public, or be gated?

**Stay public:**

- Read-only diagnostic, no PII, no secrets in the response
- Coordinator startup gets a free-and-fast call
- F22 doesn't claim it should be gated

**Gate it:**

- Defense in depth — anyone who finds the URL can poll quota state
- Even read-only telemetry leaks usage patterns
- Other read-only diagnostics that _do_ gate (e.g. `/api/harness/notifications-drain`) suggest the pattern is "gate by default"

If gating: update coordinator.md:120 to source CRON_SECRET (already
written to `/tmp/coordinator-secret` per coordinator.md:51), and
update line 157 to drop the "no auth" claim.

Recommendation: **gate it** unless Colin can articulate why this
particular read-only endpoint should be different from the others.
The startup-overhead argument is weak — coordinator already reads
CRON_SECRET at session start anyway.

---

## Item 2 — `loeppky_daily_bot` token in `.streamlit/secrets.toml` is 401

Running `/health` today, the Telegram summary send returned:

```
{"ok":false,"error_code":401,"description":"Unauthorized"}
```

Token in `streamlit_app/.streamlit/secrets.toml`:

```
[telegram]
token = "8532992708:..."   # masked
chat_id = "8741603768"
```

INC-002 in `~/.claude/CLAUDE.md` notes that two leaked Telegram tokens
were revoked via BotFather on 2026-04-21 — this may be one of them, or
a separate rotation that didn't propagate to `.streamlit/secrets.toml`.

### What to do

1. Generate a fresh token via BotFather for `loeppky_daily_bot`.
2. Update `.streamlit/secrets.toml` (Streamlit Cloud + local copy).
3. Verify by sending a test message:

   ```bash
   curl -s "https://api.telegram.org/bot<NEW_TOKEN>/getMe"
   ```

4. While at it: confirm `loeppky_alerts_bot` and `loeppky_trigger_bot`
   tokens stored in `harness_config` are still live (used by LepiOS
   crons). The `/health` skill description says it should send to
   `loeppky_alerts_bot`; only the daily bot was found in the secrets
   file. Either the alerts-bot token is missing locally, or the skill
   description should drop that step.

The 401 didn't break anything observable in production — LepiOS crons
read tokens from `harness_config` (Supabase), not from
`.streamlit/secrets.toml`. So this only affects local `/health` runs
and any Streamlit-side telegram sends (Megan's app + the older
Loeppky OS scripts).
