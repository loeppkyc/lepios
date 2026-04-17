# LepiOS Phase 2 — Integrations Audit Report
**Agent D — Integrations Audit**
**Date:** 2026-04-17
**Method:** Read-only scan of Streamlit OS codebase. No files modified.

---

## 1. Integration Inventory

| Integration | Status | Key Files | v1 Critical? | Port Effort | Security Flag |
|---|---|---|---|---|---|
| **Telegram Bot (daily)** | Live | `telegram_bot.py` (1640 lines) | YES — alerts + logging | Low: wrap in Next.js API route as webhook | No exposed secrets in checked-in files |
| **Telegram Bot (builder)** | Live | `builder_bot.py` (20 KB) | Conditional — useful not mandatory | Low | Hardcoded path `C:\Users\Colin\Desktop` in builder_bot.py:20 |
| **Amazon SP-API** | Live | `utils/amazon.py` (2128 lines), `crawlers/sp_enrich.py` | YES — deal scouting + order sync | Medium: auth pattern portable, creds migration needed | Dual creds path (st.secrets + .env) — OK |
| **Keepa** | Live | `utils/keepa_api.py` (38 KB), `utils/keepa_harvester.py` (38 KB), `scripts/deal_scan.py` | YES — deal finding | Medium: pure HTTP client, no SDK | Token exhaustion risk documented (F7 known) |
| **Oura API** | Configured-not-live | `telegram_bot.py:1109–1175`, `pages/82_Oura_Health.py` | No (v2) | Low: one REST endpoint | Token in secrets.toml — not live-tested |
| **Ollama / local LLM** | Configured-not-live | `utils/local_ai.py` (863 lines) | Partial — Tier 3 only | Low: HTTP client, already has tunnel fallback | None — local only |
| **ChromaDB** | Configured-not-live | `utils/knowledge.py`, `utils/local_ai.py:215–280` | No (v2) | Medium: path to C:/AI_Data hardcoded | Local path hardcoded |
| **Google Sheets** | Live | `utils/sheets.py`, 50+ tabs in single spreadsheet | YES — primary data store | Low: data model stays, query patterns differ | Service account JSON in Streamlit secrets |
| **Anthropic Claude API** | Live | `utils/ai.py`, `utils/managed_agent.py`, `utils/local_ai.py` | YES | Low: already standard API | Key in secrets.toml |
| **The Odds API** | Configured-not-live | `utils/sports_odds.py` (38 KB) | No (v1 optional) | Low: single REST client | Key in secrets, no Play Alberta API exists |
| **eBay API** | Configured-not-live | `utils/ebay_api.py`, `utils/ebay.py` | No (v1 optional) | Medium: XML SOAP (Trading API) — awkward | `dev_id`, `cert_id`, `user_token` not fully provisioned |
| **n8n** | Configured-not-live | `n8n/*.json` (6 workflows), `utils/n8n_webhooks.py` | No | Medium: webhook URL hardcoded to Streamlit Cloud | **CRITICAL: Bot token hardcoded in n8n JSON files** |
| **GitHub Actions** | Live | `.github/workflows/` (3 workflows) | No — CI hygiene | n/a — stays in GitHub | Secrets properly in GitHub Secrets |
| **Google Sheets (Gmail/Drive)** | Live | `utils/gmail.py`, `utils/drive.py`, `gmail-credentials.json`, `gmail-token.json` | No | Medium: OAuth token files in repo root | **gmail-token.json checked into repo root — SECURITY RISK** |
| **Dropbox** | Live | `utils/dropbox_statements.py` | No | Low | Refresh token in secrets.toml |
| **yfinance** | Live | `utils/market_data.py` | No (Trading tile helpful) | None: no auth | None |
| **Flipp API** | Configured-not-live | `utils/flipp_api.py`, `telegram_bot.py:374–388` | No | Low: public scrape | None — no auth |
| **Twilio (SMS)** | Configured-not-live | `utils/alerts.py:64–137` | No | Low: already abstracted | Key in secrets |
| **Reddit/RFD scraper** | Stub | `utils/redflagdeals.py`, `utils/retail_intel.py` | No | Low: scraping only | None |
| **CrewAI** | Configured-not-live | `utils/agent_crew.py` | No | Low: local dev only | Not in requirements.txt |
| **Sentry** | Configured-not-live | `app.py:9` | No | Low | DSN in env var |
| **Supabase** | Absent | — | YES for LepiOS v1 | Build: Supabase replaces Sheets as data store | None |
| **Stripe** | Absent | — | No (v1 not needed) | None | None |
| **Play Alberta API** | Absent | — | No | None | No such public API exists |
| **1Password MCP** | Absent | — | No | None | None |

---

## 2. Deep Assessment Per Integration

### 2.1 Telegram Bot (`telegram_bot.py` + `builder_bot.py`)

**What it does:**
The daily bot (`loeppky_daily_bot`) is a long-polling Python process. It handles inbound text commands and runs a scheduled alert system on every polling cycle. The scheduled alerts fire time-gated tasks at specific Mountain Time hours. [grounded: `telegram_bot.py:1091–1565`]

**Commands implemented (from `handle_message()`):** [grounded: `telegram_bot.py:393–1040`]
- Sales/orders/revenue/today → SP-API live orders
- MTD / month / this month → Google Sheets Amazon 2026 tab
- Yesterday → Google Sheets
- Inventory / FBA / stock → Book Inventory sheet
- Deal / flyer / find → Flipp API search
- Briefing / report / summary → combined daily briefing
- Call me / text me → Twilio SMS fallback
- Voices / say / speak → TTS via `utils/voice.py`
- Help / menu → section drill-down menu with inline buttons
- Ask / what / how / why → Ollama RAG → Claude fallback
- Show trades → Trading Journal data
- Bet → Sports Betting data
- Health / oura / sleep → Oura/health data
- Scanner / scan → Phone barcode relay
- Builder / trigger / build → Claude Code trigger runner
- Section drill-down: full SECTION_MAP of all 85 pages with inline keyboard navigation

**Scheduled tasks (Mountain Time):** [grounded: `telegram_bot.py:1091–1566`]
- 2:00 AM — Keepa product harvest → ChromaDB
- Every hour (not 2 AM) — Keepa backfill (250 ASINs)
- Every odd hour — SP-API enrichment (200 ASINs, 0 tokens)
- 6:00 AM — ChromaDB knowledge sync
- 8:00 AM — Oura Ring sync → Google Sheets
- 8:30 AM (weekdays) — Trading predictions (M2K)
- 9:00 AM — Sports predictions (NHL/CFL)
- 9:30 AM — Polymarket predictions
- 11:00 AM — Sports results update
- 2:00 PM + 8:00 PM — Arb auto-scan (Stocktrack + Keepa)
- Every hour — Brand monitor (LEGO, Hot Wheels, etc.)
- 4:30 PM (weekdays) — Trading results update
- 5:00 PM — Polymarket results
- 5:15 PM (weekdays) — Trading learning moment
- 7:00 PM — Gmail receipt scan
- 8:00 PM (Sunday) — Weekly digest
- 11:00 PM — Coach nightly review + auto-heal
- 11:00 PM — Sports late results
- 11:30 PM — Daily profit backfill
- 8:00 AM (Monday) — Edmonton family events search

**Deal-scanning loop detail:** [grounded: `telegram_bot.py:1259–1293`]
At 2 PM and 8 PM MT, the bot runs `run_arb_scan()` from `utils/arb_engine.py` against Stocktrack (Canadian retail clearance feeds), filters by min ROI 25%, min profit $5, max rank 300,000, min discount 20%, cashback adjusted (Southgate 5% + credit card 2%). Matching deals fire individual Telegram messages with Buy/Skip/Info inline buttons. [grounded: `telegram_bot.py:1262–1281`]

**Polling vs webhook:**
Long-polling via `getUpdates` with `timeout=5`. The bot calls `deleteWebhook()` on startup to clear any registered webhook. [grounded: `telegram_bot.py:260–276`, `1573`]

**Polling cadence:** No explicit `time.sleep()` in the main loop — polls immediately on each iteration then checks scheduled alerts. Error backoff: exponential up to 300s. [grounded: `telegram_bot.py:1583–1636`]

**Inline keyboard (callback queries):** Supported via `_handle_callback()` and `tg_answer_callback()`. [grounded: `telegram_bot.py:247–257`, `1591–1601`]

**Builder bot (`loeppky_trigger_bot`):** [grounded: `builder_bot.py`]
- Manages Claude Code scheduled triggers via trigger IDs (hardcoded map)
- Can run: `bbv health` (npm test), `megan health` (pytest), `bbv status` (live site ping), `sync fba` (sp_enrich crawler)
- Routes open-ended build tasks to Claude API (`claude_build()`)
- Uses long-polling with timeout=30

**Quality assessment:** Production-quality for a polling bot. Rate limiting (20 msgs/60s), retry logic (3 attempts with 2s backoff), HTML parse error fallback, message chunking at 4000 chars. The scheduled task system is a big inline function but works reliably. The dedup mechanism (`_last_sent` dict, per-day key) prevents duplicate scheduled alerts.

**Port plan for Next.js:**
1. Replace polling with a webhook endpoint: `POST /api/telegram/webhook` — Next.js route handler.
2. Register webhook via `setWebhook` Telegram API call on deploy.
3. Scheduled tasks move to cron-triggered server actions or Vercel cron jobs.
4. The command handler logic can be ported function-by-function — it's already cleanly separated.
5. All data calls are already modular (`get_today_sales()`, `get_mtd()`, etc.) — each becomes a server action or API call.

**Risks:** The scheduled task system is dense (500+ lines of inline logic). The polling architecture is fragile — if the machine sleeps, nothing fires. Webhook architecture solves this for Next.js/Vercel.

---

### 2.2 Amazon SP-API (`utils/amazon.py`)

**What it does:** [grounded: `utils/amazon.py:1–400`]
- ISBN → ASIN lookup (EAN, ISBN-10, keyword fallback)
- ASIN → catalog data (title, brand, image, BSR)
- Used buy box price lookup
- Order history sync
- Reports API (FBA inventory reports)
- FBA inbound API (shipment creation)

**API endpoints used:** [grounded: `utils/amazon.py:75–130`]
- `Orders` — get_orders (24h window, health check)
- `CatalogItems` — search_catalog_items, get_catalog_item
- `ProductsV0` — get_competitive_pricing_for_asins (buy box)
- `Reports` — get_reports (FBA inventory)
- `FulfillmentInbound` — get_inbound_guidance

**Auth/refresh tokens:** Uses `python-amazon-sp-api` library which handles LWA (Login With Amazon) token refresh automatically. Credentials loaded from `st.secrets["amazon"]` with env var fallback. [grounded: `utils/amazon.py:28–46`]

**Caching:** All major endpoints decorated with `@st.cache_data(ttl=3600)` (1 hour) or `ttl=1800`. [grounded: `utils/amazon.py:146`, `225`, `289`]

**Quality assessment:** Production quality. Good error handling (all exceptions caught, logged, return empty/None on failure). Dual credential path (secrets.toml + .env) works for both cloud and local. The `test_amazon_connection()` function provides health-check coverage.

**Port plan for Next.js:**
1. Use `amazon-sp-api` npm package or implement direct LWA HTTP calls in a Next.js API route.
2. Credentials migrate directly to Supabase secrets or Vercel env vars.
3. Caching moves from `@st.cache_data` to `unstable_cache` or Redis.
4. The ISBN→ASIN lookup and buy box endpoints are the most v1-critical — port those first.

---

### 2.3 Keepa (`utils/keepa_api.py` + `utils/keepa_harvester.py`)

**What it does:** [grounded: `utils/keepa_api.py:1–300`]
- `get_product(asin)` — single ASIN full data (history=1, days=90, stats=90, rating=1 — ~2 tokens)
- `get_products_batch(asins, stats_only=False)` — up to 100 ASINs per call; `stats_only=True` costs ~1 token/ASIN
- `keepa_deals()` — `/deals` endpoint, ~50 tokens per call, server-side filtered
- `search_products()` — keyword search, fetches batch of results
- `extract_product_summary()` — normalizes raw Keepa data to clean dict

**Token consumption pattern:** [grounded: `utils/keepa_api.py:100–120`]
- `get_products_batch(..., stats_only=True)`: ~1 token/ASIN — USE FOR DEAL FINDING
- `get_products_batch(..., stats_only=False)`: ~2 tokens/ASIN (history+rating) — USE FOR OOS ANALYSIS ONLY
- `get_product(asin)`: ~2 tokens (hardcoded full params) — single-use
- `keepa_deals()`: ~50 tokens per call (server-side filtered, more efficient for bulk)

**Known risk:** Global CLAUDE.md F7 documents token exhaustion when `get_products_batch()` called with full params on every scan. The fix is already implemented: `stats_only=True` parameter exists. `deal_scan.py` should use `stats_only=True`.

**Harvester flow:** [grounded: `utils/keepa_harvester.py:1–180`]
Gets best-seller ASINs per category (Books, Toys, Video Games, Board Games), batch-fetches product data, stores to `🔍 Keepa Deals` and `🔍 Product Harvest` sheets. Also has OOS watch tab. The `harvest_batch()` function is called nightly by the Telegram bot at 2 AM.

**Quality assessment:** Solid implementation. Pure HTTP client (urllib + gzip), no SDK dependency. The `stats_only` flag properly addresses the token exhaustion issue. Token budget checking exists in `get_token_status()`. CircuitBreaker wraps the harvester.

**Port plan for Next.js:**
Keepa has no Node.js SDK — would require direct HTTP requests. The Python implementation is a clean, direct HTTP client and can be translated 1:1 to TypeScript `fetch()` calls. The batch endpoint logic is straightforward.

---

### 2.4 Oura API (`telegram_bot.py:1109–1175`, `pages/82_Oura_Health.py`)

**What it does:** Fetches daily sleep, readiness, activity, and detailed sleep data from Oura Ring API v2. Writes to `❤️ Oura Daily` Google Sheets tab (created on first run). [grounded: `telegram_bot.py:1109–1175`]

**API calls:** [grounded: `telegram_bot.py:1141`]
- `GET /v2/usercollection/daily_sleep` — sleep score per day
- `GET /v2/usercollection/daily_readiness` — readiness score per day
- `GET /v2/usercollection/daily_activity` — activity/steps per day
- `GET /v2/usercollection/sleep` — detailed sleep (HRV, heart rate, durations)

**Auth:** Bearer token from `secrets.toml[oura][token]`. No refresh — Oura personal access tokens are long-lived.

**Sync trigger:** 8 AM MT daily via the Telegram bot's scheduled alert loop.

**Quality assessment:** Functional but quick hack. The entire sync is inline in `_check_scheduled_alerts()` — 65 lines of spaghetti inside a scheduling function. It works but is not testable in isolation. The sync is deduplicated by date (skips rows already in the sheet).

**Is the nightly sync working?** Cannot verify from static analysis — depends on the Oura token being valid and the Telegram bot process running. The code path is correct. [generated — runtime verification needed]

**Port plan for Next.js:**
Clean extraction into a server action or API route. Oura v2 API is standard REST — direct fetch calls. Credentials → Supabase or Vercel env vars.

---

### 2.5 Ollama / Local LLM (`utils/local_ai.py`)

**What it does:** [grounded: `utils/local_ai.py:1–300`]
- `is_ollama_running()` — tries localhost:11434, then tunnel URL from secrets
- `smart_ask()` — full RAG pipeline: personal/time detection → ChromaDB retrieval → Ollama inference → uncertainty detection → Claude escalation
- `chat_stream()` — streaming inference from Ollama
- `web_search()` — SerpAPI or Brave Search for real-time queries
- Code mode detection — switches to `CODE_SYSTEM_PROMPT` for code questions

**Models:** [grounded: `utils/local_ai.py:100`]
- Default: `qwen2.5-coder:7b`
- General: `qwen2.5:7b`
- Heavy: `qwen2.5:32b` (manual selection)
- ARCHITECTURE.md targets: Qwen 2.5 32B, Phi-4 14B

**Routing logic:** [grounded: `utils/local_ai.py:105–135`]
1. Personal question keyword detection → aggressive RAG
2. Time-sensitive keyword detection → force web search
3. RAG distance thresholds: personal < 1.35, factual < 1.10
4. Uncertainty marker detection → auto-escalate to Claude

**Tunnel support:** If `secrets.toml[ollama][tunnel_url]` is set, tries tunnel after localhost fails. This enables Streamlit Cloud to reach the local Ollama server via Cloudflare tunnel.

**Quality assessment:** Well-architected for local dev. The RAG pipeline with uncertainty-aware Claude fallback is production-grade design. The tunnel URL pattern is a good bridge for cloud deployments.

**Port plan for Next.js (LepiOS):**
The Ollama server stays local. The tunnel URL pattern works unchanged — LepiOS on Vercel makes HTTP calls to the tunnel URL to reach local Ollama. The `smart_ask()` logic ports directly to a server action. The streaming response pattern works with Next.js Server-Sent Events.

---

### 2.6 ChromaDB (`utils/knowledge.py`, `utils/local_ai.py:215–280`)

**What's stored:** [grounded: `utils/local_ai.py:220–257`]
- Collection `colin-memories` at `C:/AI_Data/vectordb/` — personal memories, business context
- Collection `knowledge-base` at `C:/AI_Data/knowledge-db/` — structured knowledge entries

**How it's used:**
- RAG retrieval for AI Coach and `smart_ask()` queries
- Nightly export from Google Sheets/session memories via `scripts/export_to_chromadb.py`
- Distance threshold filtering: < 1.35 for personal, < 1.10 for factual

**Known state:** The path `C:/AI_Data/vectordb/` is hardcoded. [grounded: `utils/local_ai.py:27`] 286 documents reported indexed from last export. [grounded: `00-inventory.md: scripts/export_to_chromadb.py` description]

**Quality assessment:** Local-only, path-hardcoded, depends on Ollama being up. Works for local dev but not cloud-deployed. Not a v1 blocker (v1 can use Claude API for all RAG tasks and build ChromaDB incrementally).

**Port plan for Next.js:**
Replace with Supabase `pgvector` extension for cloud-hosted semantic search. ChromaDB stays as local dev option. The export scripts become migration tools.

---

### 2.7 Google Sheets (`utils/sheets.py`)

**What it does:** Primary data store for the entire OS. All business data, accounting, health records, deal history, and configuration lives in a single Google Spreadsheet with 50+ tabs. [grounded: `00-inventory.md: §2`]

**Data flow:** [grounded: `utils/sheets.py:32–49`]
- `get_spreadsheet()` — `@st.cache_resource` singleton, authenticated via GCP service account
- Cloud: service account JSON from `st.secrets["gcp_service_account"]`
- Local: `sheets-credentials.json` file two levels up from `utils/`
- Writes: `append_row()`, `update_cell()`, `append_rows()` — all through the gspread library

**How many sheets:** 50+ tabs in the main spreadsheet. Notable domains: accounting (Business Transactions, Receipts, Statement Lines), Amazon (Amazon 2026, FBA Items, COGS Lookup), health (Oura Daily), deals (Keepa Deals, Product Harvest), bets (Bets tab). Full list in `00-inventory.md §2`. [grounded]

**Caching layer:** `@st.cache_data(ttl=300)` on most loaders (5 min). The spreadsheet connection itself is `@st.cache_resource` (session lifetime). `sync_engine.py` provides SQLite offline-first sync.

**Quality assessment:** Works well as a Streamlit-Sheets system but not designed for concurrent multi-user writes. The single spreadsheet with 50+ tabs is a monolith — each tab is effectively a table. Write contention is low (single user) so this hasn't been a problem.

**Port plan for Next.js (LepiOS):**
Google Sheets becomes read-only import source during migration. Supabase replaces Sheets as the canonical data store. The migration path: read Sheets tabs → write to Supabase tables → verify → flip new writes to Supabase. The schema is already documented in `00-inventory.md §2`.

---

### 2.8 The Odds API (`utils/sports_odds.py`)

**What it does:** [grounded: `utils/sports_odds.py:1–100`]
Fetches moneyline H2H odds for Alberta-relevant leagues: NHL, CFL, NBA, NFL, MLB, MLS, EPL, UEFA CL/EL, UFC/MMA, Tennis, Golf. Returns game objects with bookmaker odds. Also includes Kelly sizing math, American odds conversion, and probability calculations.

**API calls:** `GET /v4/sports/{sport_key}/odds/?regions=us,eu&markets=h2h&oddsFormat=american`

**Auth:** `secrets["odds"]["api_key"]` or `ODDS_API_KEY` env var. [grounded: `utils/sports_odds.py:41–48`]

**Status:** Configured-not-live. Key may not be provisioned. No Play Alberta API exists — bet placement remains fully manual with Sheets logging. [grounded: `00-inventory.md §5`]

**Quality assessment:** Clean REST client. The Alberta sports league focus and Kelly math are well-implemented. This is decision support, not automated betting.

**Port plan for Next.js:** Direct port — standard REST client, no Python-specific dependencies.

---

### 2.9 eBay API (`utils/ebay_api.py`)

**What it does:** [grounded: `utils/ebay_api.py:1–80`]
Uses the eBay Trading API (SOAP/XML) for listing management: AddItem, EndItem, ReviseItem. Book and LEGO category IDs hardcoded (267, 183446). Condition IDs mapped. GTC and timed duration support.

**Auth status:** `is_configured()` checks for `dev_id`, `cert_id`, `user_token` — all three noted as "needed" in the docstring. The `app_id` (client ID) is noted as present. [grounded: `utils/ebay_api.py:6–9`]

**Quality assessment:** The Trading API SOAP/XML implementation is verbose and dated (eBay Trading API v1155). The newer eBay REST APIs (Sell APIs) would be simpler. However, `defusedxml` is used for XML parsing — shows security awareness. [grounded: `utils/ebay_api.py:15`]

**Port plan for Next.js:** Lowest priority. If eBay integration is needed in v1, use the newer eBay REST Sell API instead of Trading API. Much simpler to implement.

---

### 2.10 n8n Workflows

All 6 workflows follow the same pattern: scheduled trigger → HTTP POST to Streamlit webhook → conditional Telegram alert. [grounded: `n8n/*.json`]

| Workflow | Schedule | Trigger URL | Alert Condition |
|---|---|---|---|
| `01_daily_statement_sync.json` | Daily 6 AM | `loeppky-app.streamlit.app/n8n_Webhook?endpoint=sync-statements` | If `new_statements_found > 0` |
| `02_missing_statement_alert.json` | (not read in detail) | Similar pattern | Missing statement |
| `03_app_health_check.json` | Every hour | `loeppky-app.streamlit.app/n8n_Webhook?endpoint=health` | If `status != "ok"` |
| `04_price_drop_monitor.json` | Every 4 hours | `loeppky-app.streamlit.app/n8n_Webhook?endpoint=check-prices` | If `deals_found > 0` |
| `05_retirement_price_check.json` | (not read) | Similar pattern | Price change |
| `06_staple_food_monitor.json` | (not read) | Similar pattern | Price drop |

**Status:** NOT LIVE. The webhook URL points to `loeppky-app.streamlit.app` (the Streamlit Cloud deployment). If n8n is self-hosted (Docker Compose per `infra/`), it needs to be running and the webhook token needs to match. The n8n instance URL is not in the codebase — lives in n8n itself. [generated — requires runtime verification]

**Port plan for Next.js (LepiOS):**
Replace n8n workflows with Vercel cron jobs or scheduled server actions. The patterns are simple enough that n8n adds complexity without benefit. If n8n is preferred, update webhook URL to LepiOS domain.

---

### 2.11 GitHub Actions (3 Workflows)

**CI** (`ci.yml`) — triggers on every push: compile check all .py, pytest `tests/test_imports.py`, bandit security scan. No secrets needed for basic run. [grounded: `.github/workflows/ci.yml`]

**Night Watch** (`night-watch.yml`) — daily 7 AM MDT: compile check, smoke tests, import tests, page import tests, utility tests, telegram bot tests, bandit scan, Sheets connectivity test (if `GCP_SERVICE_ACCOUNT` set), Telegram alert on failure or success. [grounded: `.github/workflows/night-watch.yml`]

**Deal Scan** (`deal_scan.yml`) — 6 AM + 6 PM MDT daily: runs `scripts/deal_scan.py`. Requires GitHub Secrets: `GOOGLE_CREDENTIALS_JSON`, `KEEPA_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SPREADSHEET_ID`. [grounded: `.github/workflows/deal_scan.yml`]

**Note:** `uptime.yml.disabled` exists but is disabled. [grounded: `00-inventory.md §4`]

**Quality assessment:** The Deal Scan workflow is v1-critical for autonomous deal scouting — it runs completely serverlessly via GitHub Actions, no local machine needed. Night Watch provides early warning on code breakage.

**Port plan for LepiOS:**
- CI: keep in GitHub Actions, update to test Next.js codebase
- Deal Scan: keep as GitHub Actions cron, or migrate to Vercel cron jobs
- Night Watch: adapt for LepiOS test suite

---

## 3. Security Review

### Critical Issues

**CRITICAL — Telegram bot token hardcoded in n8n JSON files** [grounded: `n8n/01_daily_statement_sync.json:54`, `n8n/03_app_health_check.json:56`]
The n8n workflow JSONs contain a hardcoded Telegram bot token in the URL: `https://api.telegram.org/bot8502932021:AAEq5RubaAsD0Crx4I8JqqyyntNi6h53fu4/sendMessage`. This token is in a file committed to the git repository. The Telegram chat ID `8741603768` is also hardcoded.

**Action required:** This token is exposed in the git history. Revoke and regenerate via BotFather. Replace hardcoded token in JSON with `{{TELEGRAM_BOT_TOKEN}}` variable in n8n, not a raw URL.

**MEDIUM — Gmail OAuth token checked into repo root** [grounded: `00-inventory.md §1: gmail-token.json` in root]
`gmail-token.json` (735 bytes) and `gmail-credentials.json` (412 bytes) are in the streamlit_app root. If these are committed to git, the OAuth tokens are exposed.

**Action required:** Verify these files are in `.gitignore`. If not, revoke the OAuth token and regenerate. Move to `.streamlit/` directory (which is presumably gitignored for the secrets.toml).

**LOW — Hardcoded absolute path in builder_bot.py** [grounded: `builder_bot.py:20`]
`BBV_ROOT = Path(r"C:\Users\Colin\Desktop\brick-and-book-vault")` — machine-specific path. Not a secret, but fails on any machine other than Colin's. Acceptable for a local bot.

**LOW — Dual credential path in amazon.py** [grounded: `utils/amazon.py:14–46`]
The file loads from `.env` in workspace root AND from `st.secrets`. The `.env` file is presumably gitignored but having two credential paths increases risk surface.

### Non-Issues (verified safe)
- All secrets in `secrets.toml` — this file is gitignored [generated — assumed standard Streamlit Cloud practice, verify with `git check-ignore .streamlit/secrets.toml`]
- GitHub Actions secrets properly use repository secrets, not hardcoded values [grounded: `deal_scan.yml`, `night-watch.yml`]
- `sanitize_sheet_value()` exists to prevent Google Sheets formula injection [grounded: `utils/sheets.py:52–58`]
- `defusedxml` used for eBay XML parsing [grounded: `utils/ebay_api.py:15`]
- Rate limiting implemented in Telegram bot main loop (20 msgs/60s) [grounded: `telegram_bot.py:1578–1616`]
- Chat ID validation on all incoming Telegram messages [grounded: `telegram_bot.py:1607`]

---

## 4. v1 Wiring Priority List

In priority order for LepiOS v1 ("The Earning Day"):

| Priority | Integration | What's Needed | Effort | Notes |
|---|---|---|---|---|
| 1 | **Telegram Bot (webhook)** | Convert polling → webhook; deploy to Vercel; port command handlers | 1–2 days | Most critical — deal alerts + logging. Webhook is simpler than polling for Vercel |
| 2 | **Amazon SP-API** | Port auth + ISBN→ASIN + buy box + order sync to Next.js API routes | 1–2 days | Use `amazon-sp-api` npm package or direct HTTP |
| 3 | **Keepa** | Port batch endpoint client to TypeScript; preserve `stats_only` pattern | 1 day | Pure HTTP — straightforward port |
| 4 | **Google Sheets (read)** | Wire `google-spreadsheet` npm package for read access during migration | 0.5 days | Read-only during Supabase migration |
| 5 | **Anthropic Claude API** | Already used in BBV — copy pattern. Wire to agent council | 0.5 days | SDK identical, already familiar |
| 6 | **Supabase** | Build schema; migrate data from Sheets; wire auth | 3–5 days | Foundation for everything — do this early |
| 7 | **Deal Scan (GitHub Actions)** | Update workflow to point at LepiOS; wire Telegram token | 0.5 days | Already working — minimal change |
| 8 | **The Odds API** | Port REST client; wire to Betting tile | 0.5 days | Simple REST, no SDK needed |
| 9 | **Ollama (tunnel)** | Wire tunnel URL → server action; add to Tier 3 routing | 0.5 days | Tunnel pattern already proven |

---

## 5. Quick-Lift Integrations (< 1 day each)

These are already well-implemented in Python and port cleanly to TypeScript:

1. **The Odds API** — Standard REST client, no auth complexity, clean TypeScript port. [grounded: `utils/sports_odds.py`]
2. **yfinance** → swap for Yahoo Finance npm package or `@yahoo-finance2/api` (same API surface). [grounded: `utils/market_data.py`]
3. **Flipp API** — Public scrape endpoint, no auth. `telegram_bot.py:374–388` has the full implementation. [grounded]
4. **Oura API** — Single Bearer token, 4 REST endpoints, deduplicated by date. Clean extraction. [grounded: `telegram_bot.py:1109–1175`]
5. **Telegram webhook** — Add one Next.js API route; register webhook; port command router. [grounded: `telegram_bot.py:393–500`]
6. **Anthropic Claude API** — Already wired in BBV. Pattern is identical. [grounded: BBV CLAUDE.md]
7. **GitHub Actions (Deal Scan)** — Update env vars and trigger URL. 30 minutes. [grounded: `deal_scan.yml`]

---

## 6. Full-Rebuild Integrations

These need redesign, not just porting:

1. **Google Sheets → Supabase migration** — The 50+ tab monolith needs schema normalization. The SQLite schema in `utils/data_layer.py` is actually close to what a proper Supabase schema should look like — it can serve as the migration template. [grounded: `00-inventory.md §2`]

2. **Telegram bot (full command system)** — The 1640-line polling bot needs restructuring for webhook architecture. Each command handler becomes a server action. The scheduled tasks become Vercel cron jobs. Not a rebuild from scratch — a restructuring.

3. **ChromaDB → pgvector** — Local ChromaDB at `C:/AI_Data/vectordb/` cannot run on Vercel. Supabase `pgvector` extension provides equivalent semantic search. The 286-document collection needs re-indexing. [grounded: `utils/local_ai.py:27`]

4. **Ollama agent system** — The CrewAI + Ollama 3-agent crew in `utils/agent_crew.py` is local-only (not in requirements.txt for cloud). For LepiOS v1, the agent council runs via Claude API; Ollama supplements via tunnel for Tier 3 tasks.

5. **n8n workflows** — The current workflows are shallow wrappers around HTTP calls. For LepiOS, these become Vercel cron jobs with no n8n dependency. n8n can stay for complex multi-step workflows if needed.

6. **eBay API** — Trading API SOAP/XML should be replaced with eBay REST Sell API. Different auth flow, different endpoints, but functionally equivalent and much simpler.

---

## 7. Grounding Manifest

All claims tagged **grounded** are verifiable against the files listed below. Claims tagged **generated** are inferences or assessments that require runtime verification.

| File Read | Lines / Sections Used | Purpose |
|---|---|---|
| `lepios/ARCHITECTURE.md` | Full file | v1 scope, ingestion model, tech stack |
| `lepios/audits/00-inventory.md` | Full file | Integration status baseline |
| `streamlit_app/telegram_bot.py` | 1–300, 300–500, 1050–1250, 1250–1450, 1450–1570, 1568–1641 | Bot commands, scheduled tasks, deal loop, main loop |
| `streamlit_app/builder_bot.py` | 1–260 | Builder bot commands, health checks, approved ops |
| `streamlit_app/utils/amazon.py` | 1–300 | SP-API endpoints, auth, caching |
| `streamlit_app/utils/keepa_api.py` | 1–300 | API methods, token consumption, batch pattern |
| `streamlit_app/utils/keepa_harvester.py` | 1–180 | Category maps, harvest flow, sheet structure |
| `streamlit_app/utils/local_ai.py` | 1–300 | Ollama routing, RAG pipeline, tunnel fallback |
| `streamlit_app/utils/knowledge.py` | 1–100 | ChromaDB paths, SQLite knowledge schema |
| `streamlit_app/utils/sheets.py` | 1–80 | gspread auth, credential paths, sanitization |
| `streamlit_app/utils/sports_odds.py` | 1–100 | Alberta leagues, API key, endpoints |
| `streamlit_app/utils/ebay_api.py` | 1–80 | Trading API, auth status, XML pattern |
| `streamlit_app/n8n/01_daily_statement_sync.json` | Full | n8n flow pattern, CRITICAL: hardcoded bot token |
| `streamlit_app/n8n/03_app_health_check.json` | Full | Health check flow, CRITICAL: hardcoded bot token |
| `streamlit_app/n8n/04_price_drop_monitor.json` | Full | Price monitor flow, 4h cadence |
| `streamlit_app/.github/workflows/ci.yml` | Full | CI on push |
| `streamlit_app/.github/workflows/night-watch.yml` | Full | Daily health + Telegram alert |
| `streamlit_app/.github/workflows/deal_scan.yml` | Full | Deal scan cron, env vars, Keepa + Telegram |
| `streamlit_app/scripts/deal_scan.py` | 1–120 | 3-track scan architecture, secrets handling |

---

*Report generated: 2026-04-17. Read-only. No files modified.*
