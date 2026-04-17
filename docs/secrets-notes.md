# Secrets Diagnostic Notes — alerts_bot

**Audit date:** 2026-04-17
**Resolution date:** 2026-04-17
**Scope:** Diagnostic + one local edit (secrets.toml is gitignored).

---

## Bot Inventory

| Section | Bot ID (prefix) | chat_id | Identity |
|---------|----------------|---------|----------|
| `[telegram]` in secrets.toml | 8532992708 | 8741603768 | `loeppky_daily_bot` — general alerts, used by `send_alert()` in Python |
| `[builder_bot]` in secrets.toml | 8660843715 | MISSING | `loeppky_trigger_bot` — build commands |
| `[alerts_bot]` in secrets.toml | **8660843715** | **MISSING** | **WRONG** — same token as `builder_bot` |
| `TELEGRAM_BOT_TOKEN` in BBV `.env.local` | 8502932021 | 8741603768 | Unknown — possibly the real `loeppky_alerts_bot` |

---

## Bugs Found

### Bug 1 — Wrong token in `[alerts_bot]`

`secrets.toml [alerts_bot].token` has bot_id `8660843715`, which is identical to `[builder_bot]`. This means the `[alerts_bot]` section is pointing at `loeppky_trigger_bot`, not `loeppky_alerts_bot`.

The real `loeppky_alerts_bot` token is not present in secrets.toml.

**Impact:** Any code that reads `st.secrets["alerts_bot"]["token"]` would silently send messages via the trigger bot, not the alerts bot. However, no Python code currently reads `[alerts_bot]` at all (see Bug 2), so this has had no live impact yet.

### Bug 2 — `send_alert()` ignores `[alerts_bot]` entirely

`utils/alerts.py:38–40` reads:
```python
cfg     = dict(st.secrets.get("telegram", {}))
token   = cfg.get("token", "")
chat_id = cfg.get("chat_id", "")
```

It reads from `[telegram]` (bot 8532992708, `loeppky_daily_bot`). The `[alerts_bot]` section is never read by any Python function. Every `send_alert()` call in the codebase uses `loeppky_daily_bot`, not `loeppky_alerts_bot`.

This is the intended behavior described in CLAUDE.md (`loeppky_daily_bot` = general, `loeppky_alerts_bot` = health check failures). But the two are not wired separately — all alerts go to the same bot.

### Bug 3 — No `chat_id` in `[alerts_bot]` or `[builder_bot]`

Both `[alerts_bot]` and `[builder_bot]` sections have only a `token` field. If code ever tries to send a message via these bots, it will fail silently — no destination chat configured.

---

## Unknown

The BBV `.env.local` `TELEGRAM_BOT_TOKEN` has bot_id `8502932021` — not matching any of the three Streamlit secrets.toml bots. This could be:
- The real `loeppky_alerts_bot` token (used by BBV health scripts, which send health check failures)
- A separate BBV-specific bot that was set up independently

Cannot confirm without checking @BotFather.

---

## Resolution

**`[alerts_bot]` removed from secrets.toml on 2026-04-17.**

The section (2 lines: header + token) was deleted locally. secrets.toml is gitignored — this is a local-only change with no commit required.

**Why removed rather than fixed:** No Python code reads `[alerts_bot]`. No `chat_id` was set. The token was a copy of `[builder_bot]`'s token — a trap that could mislead a future session into thinking alerts routing was wired when it wasn't.

**`loeppky_alerts_bot` exists in BotFather** but was never wired to any code. No live impact from removal.

---

## If Alerts Bot Routing Is Needed in Future

When Sprint 6 Telegram webhook work happens in LepiOS (or any session that needs dedicated health-check routing):

1. Open Telegram → `@BotFather` → `/mybots` → find `loeppky_alerts_bot` → copy API Token
2. Get bot_id (prefix before `:`) — verify it is **not** `8532992708` (daily) or `8660843715` (trigger)
3. Re-add to secrets.toml cleanly:

   ```toml
   [alerts_bot]
   token   = "<real loeppky_alerts_bot token>"
   chat_id = "8741603768"
   ```

4. Wire a dedicated `send_health_alert()` function in `utils/alerts.py` that reads `[alerts_bot]`
5. Route circuit-breaker and cron-failure alerts to that function; leave `send_alert()` on `[telegram]` for general use

---

## Current Live Behavior

All `send_alert()` calls (circuit breakers, auto-reconcile, price monitors, staple alerts) send via `loeppky_daily_bot` (bot_id `8532992708`) to chat_id `8741603768`. This is correct and unaffected by the removal of `[alerts_bot]`.
