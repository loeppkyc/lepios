# Phase 1a Study — 99_n8n_Webhook.py
**Task ID:** ec1d00c7-d331-451e-ba4e-f43c946ed65e
**Coordinator run:** 2026-04-27
**Source:** embedded in task metadata (114 lines, `pages/99_n8n_Webhook.py`)
**Audit cross-reference:** `audits/integrations-report.md §2.10`

---

## What it does

`99_n8n_Webhook.py` is a hidden Streamlit page that acts as an API receiver for n8n automation workflows. n8n calls it via URL query parameters (`?endpoint=<name>&token=<secret>`), and the page returns JSON via `st.json()`. It is hidden from the sidebar (`st.set_page_config(page_title="Webhook", ...)`).

The page itself is a **114-line routing shell**. All actual business logic lives in `utils/n8n_webhooks.py` (1,077 lines, 44 KB — a separate, large file not included in this task scope).

---

## How it does it

**Authentication:** HMAC `compare_digest` between the `?token=` query param and `st.secrets["n8n"]["webhook_token"]`. If no token is configured, all requests are rejected (secure by default). [grounded: source_content lines 21–38]

**Routing:**

| Endpoint           | Handler called                     | Extra param |
|--------------------|------------------------------------|-------------|
| `health`           | inline `{"status": "ok"}`          | none        |
| `sync-statements`  | `handle_sync_statements()`         | none        |
| `check-coverage`   | `handle_check_coverage()`          | none        |
| `check-prices`     | `handle_check_prices()`            | none        |
| `check-retirement` | `handle_check_retirement()`        | none        |
| `weekly-digest`    | `handle_weekly_digest()`           | none        |
| `price-monitor`    | `handle_price_monitor()`           | none        |
| `check-promos`     | `handle_check_promos()`            | none        |
| `telegram-query`   | `handle_telegram_query(message)`   | `?message=` |
| `trading-signal`   | `handle_trading_signal(action)`    | `?action=`  |
| `sports-prediction`| `handle_sports_prediction(action)` | `?action=`  |
| unknown            | inline `{"status": "error", ...}`  | none        |

[grounded: source_content lines 56–108]

---

## Domain rules embedded

1. **Token required on health endpoint too.** Unlike many health-check patterns, n8n webhook health requires auth. [grounded: source_content lines 62–65]
2. **Missing token config = reject all.** If `webhook_token` not in secrets, returns error on ALL requests. Explicit fail-secure. [grounded: source_content lines 33–35]
3. **Timing-safe comparison.** Uses `hmac.compare_digest` — correct defence against timing attacks. [grounded: source_content line 38]
4. **Unknown endpoint returns error, not 404.** Streamlit can't send a real 404 — it always renders something. [grounded: source_content lines 107–108]

---

## Edge cases

- **Streamlit is not an HTTP API framework.** The "API" is a page that renders HTML containing JSON. The caller gets the full Streamlit page response, not a clean JSON body. This means HTTP status codes are always 200 even on auth failure. n8n must parse `st.json()` output from HTML, which is fragile. [grounded: architecture mismatch — Streamlit renders HTML]
- **Dev section call at line 114:** `dev_section("n8n Webhook")` — this function is called unconditionally even after all `st.stop()` branches. May be a dead call or may cause rendering after JSON output. Fragile. [grounded: source_content line 114]
- **11 different endpoint domains.** The handlers span: financial statements, book inventory, trading, sports, Telegram, prices. There is no domain cohesion — this page is a catch-all.

---

## Status

**NOT LIVE.** The n8n integration was never active. The 6 n8n workflow JSONs point to `loeppky-app.streamlit.app/n8n_Webhook` (Streamlit Cloud URL), and the n8n instance URL is not in the codebase. [grounded: `audits/integrations-report.md §2.10`]

---

## Fragile or improvable points

1. **Wrong architecture from the start.** Streamlit is a UI framework. Using it as a webhook receiver is a workaround, not a pattern. The 200-always response, inability to set proper headers, and HTML-wrapped JSON are all architectural defects.
2. **All 11 endpoints in one router.** Each endpoint covers a different domain. In LepiOS these are (or will be) separate modules.
3. **Security issue: hardcoded bot token in n8n JSON files.** The n8n workflow files contain a hardcoded Telegram bot token in the URL. Documented as INC-002; token revoked. [grounded: `audits/integrations-report.md §3 Critical Issues`]
4. **`utils/n8n_webhooks.py` is 1,077 lines** — a large library that aggregates logic from every domain. Not suitable for direct port; each section belongs to its own module.

---

## What exists in LepiOS already

| n8n endpoint         | LepiOS equivalent                             | Status        |
|----------------------|-----------------------------------------------|---------------|
| `health`             | `/api/health`                                 | Live          |
| `sync-statements`    | `/api/cron/amazon-settlements-sync`           | Live          |
| `weekly-digest`      | `/api/cron/morning-digest`                    | Live          |
| `telegram-query`     | Harness Telegram via `outbound_notifications` | Live          |
| `check-prices`       | `/api/scan` (partial)                         | Partial       |
| `check-coverage`     | `/api/business-review/statement-coverage`     | Live          |
| `price-monitor`      | No equivalent                                 | Not built     |
| `check-retirement`   | No equivalent                                 | Not built     |
| `check-promos`       | No equivalent                                 | Not built     |
| `trading-signal`     | No equivalent (Trading module not started)    | Not built     |
| `sports-prediction`  | No equivalent (Betting module not started)    | Not built     |

[grounded: `app/api/` directory listing]

---

## 20% Better

The n8n webhook **routing shell** has no value to improve because the correct action is to not port it. The underlying endpoint handlers are the substance:

| Category      | Assessment |
|---------------|------------|
| Correctness   | The Streamlit webhook architecture is fundamentally incorrect (HTML-wrapped JSON, always-200, no proper auth headers). LepiOS native routes fix all of these. |
| Performance   | Streamlit startup overhead on every webhook call. Vercel cron routes add zero overhead. |
| UX            | N/A — this is backend automation plumbing. |
| Extensibility | LepiOS cron + task queue is significantly more extensible than n8n + Streamlit webhook. |
| Data model    | N/A for the routing layer. Individual handlers are separate scope. |
| Observability | n8n workflows have no observability into LepiOS state. Native Vercel crons log to `agent_events`. |

**20% Better verdict:** The 20% better version of the n8n webhook is "don't have an n8n webhook." LepiOS cron infrastructure is already architecturally superior in every dimension.

---

## Twin Q&A

**Status: blocked — endpoint unreachable (allowlist restriction)**

All 3 questions escalated to Colin:

1. `"Was the n8n integration (99_n8n_Webhook.py) ever live in production in the Streamlit OS, or always configured-but-inactive?"` — [twin: unreachable, endpoint error]
2. `"Is there a plan to use n8n (self-hosted) in LepiOS, or has it been superseded by Vercel cron jobs and the harness task queue?"` — [twin: unreachable, endpoint error]
3. `"Do any of the n8n webhook handlers (sync-statements, check-prices, check-retirement, weekly-digest, price-monitor, check-promos) represent functionality that needs to be built in LepiOS soon, or are they deferred?"` — [twin: unreachable, endpoint error]

Audit evidence answers Q1 and Q2 with high confidence (see Status and integrations-report.md §2.10 above). Q3 depends on sprint prioritization — Colin's call.

---

## Pending Colin Questions

1. **Direction for this module:** (A) Port the webhook router to a Next.js API route `/api/webhooks/n8n`; (B) Replace specific n8n workflows with Vercel crons (partially done already); or **(C) Skip / Close** — the webhook routing layer has no purpose in LepiOS, individual endpoint handlers are already built or will be built as separate modules in their own sprints.

2. **Harness component registration:** `harness:streamlit_rebuild_n8n_webhook` does not exist in `harness_components`. If direction is C (skip), should builder add a migration to register this component at 100%? Or should it be registered at a lower % (e.g. 60% = "evaluated, skip decided") to distinguish from "fully built"?

---

## Grounding manifest

| Claim | Evidence | Type |
|-------|----------|------|
| 114-line routing shell | task.metadata.source_content | grounded |
| NOT LIVE | integrations-report.md §2.10 | grounded |
| n8n workflows point to Streamlit Cloud | integrations-report.md §2.10 table | grounded |
| Token auth uses hmac.compare_digest | source_content line 38 | grounded |
| 11 endpoints dispatched to handlers | source_content lines 56–108 | grounded |
| utils/n8n_webhooks.py = 1077 lines | audits/00-inventory.md | grounded |
| LepiOS has /api/health, /api/cron/* | app/api/ directory listing | grounded |
| harness:streamlit_rebuild_n8n_webhook absent from harness_components | SQL query result (empty) | grounded |
| Bot token hardcoded in n8n JSON | integrations-report.md §3 | grounded |
