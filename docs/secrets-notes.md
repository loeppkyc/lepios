# Secrets Diagnostic Notes — alerts_bot

**Audit date:** 2026-04-17
**Scope:** Read-only. No changes made to secrets.toml or .env files.

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

## Resolution Steps (for Colin via BotFather)

1. Open Telegram → search `@BotFather` → `/mybots`
2. Locate `loeppky_alerts_bot` in the list → tap **API Token** → copy it
3. Note the bot_id (the numeric prefix before the colon)
4. Verify it is **not** `8532992708` (daily bot) or `8660843715` (trigger bot)
5. In `secrets.toml`, replace `[alerts_bot] token` with the correct token
6. Add `chat_id = "8741603768"` to `[alerts_bot]` (same chat as `[telegram]`, unless alerts should go to a separate group)
7. Also check if `8502932021` (BBV bot) is the alerts bot or a separate BBV bot
8. After fixing the token: decide whether `send_alert()` should be updated to read from `[alerts_bot]` instead of `[telegram]`, or whether to leave `[telegram]` as the active path and create a dedicated `send_health_alert()` function for circuit-breaker and cron failures

---

## Current Live Behavior

All `send_alert()` calls (including circuit breakers, auto-reconcile, price monitors, staple alerts) send via `loeppky_daily_bot` (8532992708) to chat_id `8741603768`. There is no separate routing to `loeppky_alerts_bot` yet. The `[alerts_bot]` section exists in secrets.toml but is wired to the wrong bot and consumed by no code.

**No action is blocking.** Alerts are reaching Colin via `loeppky_daily_bot`. The fix is to (a) correct the token in `[alerts_bot]` and (b) optionally wire health-check-specific alerts to the alerts bot separately.
