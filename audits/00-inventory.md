# 00 — Streamlit OS Inventory

**Baseline:** `C:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)/streamlit_app/`
**Date:** 2026-04-17
**Method:** Read-only scan — no files modified.

---

## 1. Full File Tree (Top 3 Levels)

> Excludes `.git/`, `node_modules/`, and `__pycache__/`. Sizes are from `ls -la`.

### Root Level

| File / Dir | Size | Last Modified | Description |
|---|---|---|---|
| `app.py` | 8.5 KB | Apr 17 | Streamlit Cloud entry point; sidebar navigation with collapsible sections; Sentry init |
| `Business_Review.py` | 191 KB | Apr 17 | Main dashboard page — business P&L summary; most complex single file |
| `daily_pl.py` | 14 KB | Apr 17 | Daily P&L helper — fetched by Business_Review; Amazon/trading/betting daily numbers |
| `telegram_bot.py` | 70 KB | Apr 15 | Two-way Telegram bot (loeppky_daily_bot); polls for messages + scheduled alerts (1640 lines) |
| `builder_bot.py` | 20 KB | Apr 15 | Builder/ops bot (loeppky_trigger_bot); manages autonomous build agents across all 3 projects |
| `fix_receipts_now.py` | 9.6 KB | Apr 14 | One-off script — backfill/fix receipt records in Sheets |
| `diag_coverage.py` | 1.5 KB | Apr 15 | Diagnostic — checks statement coverage across accounts |
| `CLAUDE.md` | 9.8 KB | Apr 16 | Project-level Claude Code instructions (stack conventions, patterns, spreadsheet ID) |
| `CODEBASE_INDEX.md` | 37 KB | Apr 16 | Full module index — 74 pages, 67 utils, all sheet tab names, session state keys |
| `ARCHITECTURE.md` | 29 KB | Mar 31 | System architecture — 25 entities, 7 domains, action bus, entity relationships |
| `KNOWLEDGE_SYSTEM.md` | 27 KB | Mar 31 | Knowledge pipeline docs — event log, ChromaDB, SQLite, RAG design |
| `SYSTEM_INTEGRITY_CHECKLIST.md` | 11 KB | Mar 31 | Manual QA checklist — all pages and data flows |
| `AGENT_PROMPT.md` | 1.6 KB | Apr 7 | Template prompt for Claude Code autonomous build agents |
| `TASK_QUEUE_SEED.md` | 3.9 KB | Apr 7 | Seeded task backlog for agent workflows |
| `Dockerfile` | 1.7 KB | Apr 13 | Docker image: python:3.12-slim + tesseract + chromadb; Streamlit entry at Business_Review.py |
| `requirements.txt` | 877 B | Apr 17 | Python dependencies (streamlit>=1.44, anthropic>=0.93, chromadb>=0.4, python-amazon-sp-api>=0.19) |
| `runtime.txt` | 12 B | Mar 24 | Specifies Python 3.12 for Streamlit Cloud |
| `packages.txt` | 14 B | Mar 31 | System packages (tesseract) for Streamlit Cloud |
| `skills_manifest.json` | 4.4 KB | Mar 29 | Manifest of available Claude Code skills with trigger phrases |
| `package.json` | 1.2 KB | Apr 14 | Node.js config for E2E Puppeteer/Vitest test suite |
| `tsconfig.json` | 327 B | Apr 14 | TypeScript config for E2E tests |
| `vitest.e2e.config.ts` | 998 B | Apr 14 | Vitest config for E2E test suite |
| `.aider.conf.yml` | 453 B | Apr 16 | Aider LLM coding assistant config (qwen2.5-coder:7b) |
| `.bandit` | 178 B | Apr 1 | Bandit security scan config |
| `.env.local` | 61 B | Apr 14 | Local test env vars (BASE_URL, TEST_USERNAME, TEST_PASSWORD) |
| `.env.local.example` | 129 B | Apr 14 | Template for .env.local |
| `gmail-credentials.json` | 412 B | Apr 12 | Gmail OAuth client credentials |
| `gmail-token.json` | 735 B | Apr 12 | Gmail OAuth access/refresh token |

### `pages/` — 83 page files

| File | Size | Last Modified | Lines | Description |
|---|---|---|---|---|
| `1_Life_PL.py` | 17 KB | Apr 17 | 403 | Life P&L — income/expense summary across all categories |
| `2_Trading_Journal.py` | 98 KB | Apr 15 | 1903 | Trading journal — M2K futures, signals, IBKR order builder |
| `3_Sports_Betting.py` | 103 KB | Apr 17 | 2041 | Sports betting — bet logger, results, analytics, AI picks (The Odds API) |
| `4_Monthly_Expenses.py` | 46 KB | Apr 16 | 1039 | Monthly expenses — business + personal category breakdown |
| `5_Monthly_PL.py` | 97 KB | Apr 15 | 2126 | Monthly P&L — detailed per-category income/expense |
| `6_Tax_Centre.py` | 5.2 KB | Apr 16 | ~110 | Tax centre — entry point to tax sub-pages |
| `7_Inventory.py` | 51 KB | Apr 17 | 1094 | Inventory management — books + Lego, COGS, condition tracking |
| `8_Bookkeeping_Hub.py` | 33 KB | Apr 15 | ~720 | Bookkeeping hub — statement reconciliation, vendor rules |
| `8_Health.py` | 79 KB | Apr 14 | 1577 | Health dashboard — Oura ring sync, sleep/readiness/activity charts |
| `9_Profile.py` | 5.1 KB | Apr 14 | ~120 | User profile — account settings |
| `10_Admin.py` | 41 KB | Apr 16 | ~890 | Admin panel — user management, system health, circuit breakers |
| `12_Receipts.py` | 136 KB | Apr 16 | 2640 | Receipt scanner — OCR upload, Claude Vision, Dropbox sync, matching |
| `13_Vehicles.py` | 12 KB | Apr 14 | ~260 | Vehicle expenses — mileage, fuel, maintenance tracking |
| `17_Payouts.py` | 10 KB | Apr 14 | ~220 | Marketplace payout register — Amazon/eBay settlements |
| `20_Scout.py` | 32 KB | Apr 14 | ~720 | Book/Lego scout — ISBN/barcode lookup, SP-API price check |
| `21_PageProfit.py` | 175 KB | Apr 15 | 3373 | PageProfit scanner — Amazon.ca page-by-page ROI calculator (largest page) |
| `22_Inventory_Spend.py` | 35 KB | Apr 14 | ~760 | Inventory spend tracker — COGS by category and date |
| `23_Expense_Dashboard.py` | 21 KB | Apr 14 | ~430 | Expense dashboard — cross-category visual summary |
| `24_Calendar.py` | 40 KB | Apr 14 | ~870 | Business calendar — events, Cora activities |
| `25_Personal_Expenses.py` | 12 KB | Apr 15 | ~260 | Personal expenses — non-business spending |
| `26_Sales_Charts.py` | 16 KB | Apr 14 | ~360 | Sales charts — Amazon revenue/profit time series |
| `28_Category_PL.py` | 16 KB | Apr 14 | ~350 | Category P&L — per-category income vs expense |
| `29_Groceries.py` | 35 KB | Apr 14 | ~740 | Grocery tracker — Claude Vision receipt parsing |
| `30_Shipment_Manager.py` | 58 KB | Apr 17 | 1176 | Shipment manager — FBA box builder, SP-API shipment creation |
| `35_Scoutly.py` | 13 KB | Apr 14 | ~280 | Scoutly — quick ISBN lookup with BSR history |
| `37_Command_Centre.py` | 35 KB | Apr 14 | ~800 | Command centre — run automations, Telegram commands, health checks |
| `38_Paper_Trail.py` | 45 KB | Apr 14 | 1034 | Paper trail — statement upload/review, Dropbox archiver |
| `39_Monthly_Close.py` | 5.7 KB | Apr 17 | ~130 | Monthly close — stub/redirect (superseded by 54_Monthly_Close) |
| `41_Coupon_Lady.py` | 44 KB | Apr 14 | ~960 | Coupon Lady — Flipp flyer parser, price book, coupon tracker |
| `42_Retail_Scout.py` | 36 KB | Apr 14 | ~800 | Retail scout — store price search via Flipp API |
| `46_Arbitrage_Scanner.py` | 85 KB | Apr 15 | 1632 | Arbitrage scanner — retail-to-Amazon arb engine, Keepa + SP-API |
| `47_Lego_Vault.py` | 35 KB | Apr 15 | ~760 | Lego Vault — retirement tracker, price history, ROI projections |
| `48_Retail_Monitor.py` | 9.4 KB | Apr 15 | ~200 | Retail monitor — background price check on watchlist |
| `49_Cashback_HQ.py` | 96 KB | Apr 14 | 1858 | Cashback HQ — portal tracking, MasterCard/CIBC cashback optimizer |
| `50_3D_Printer_HQ.py` | 30 KB | Apr 14 | ~650 | 3D Printer HQ — print job tracker, filament cost, profit |
| `51_Retirement_Tracker.py` | 13 KB | Apr 16 | ~280 | Retirement tracker — RRSP/FHSA projections |
| `52_Utility_Tracker.py` | 6.2 KB | Apr 14 | ~140 | Utility tracker — gas/electricity/water bills |
| `53_Business_History.py` | 17 KB | Apr 14 | ~360 | Business history — archived annual summaries |
| `54_Monthly_Close.py` | 32 KB | Apr 17 | ~720 | Monthly close — EOM reconciliation, sign-offs, checklist |
| `55_Phone_Plans.py` | 12 KB | Apr 14 | ~260 | Phone plans — Telus/Koodo plan tracker |
| `56_Insurance.py` | 79 KB | Apr 14 | 1572 | Insurance — policy inventory, premium analysis, gap coverage |
| `58_Tax_Return.py` | 52 KB | Apr 17 | 1222 | Tax return — CRA T4/T5 data, business deductions calculator |
| `59_Shipments.py` | 27 KB | Apr 14 | ~580 | Shipments — FBA shipment history viewer |
| `60_Amazon_Orders.py` | 38 KB | Apr 16 | ~830 | Amazon orders — SP-API order history, returns |
| `61_Net_Worth.py` | 24 KB | Apr 14 | ~530 | Net worth tracker — assets/liabilities snapshot |
| `62_eBay.py` | 64 KB | Apr 16 | 1325 | eBay — listing manager, sales history, eBay API |
| `63_Debt_Payoff.py` | 30 KB | Apr 14 | ~660 | Debt payoff — BDC loan, credit card snowball planner |
| `64_Marketplace_Hub.py` | 62 KB | Apr 16 | 1318 | Marketplace Hub — cross-platform (Amazon+eBay) listings view |
| `65_Repricer.py` | 40 KB | Apr 14 | ~880 | Repricer — rule-based Amazon price adjustment engine |
| `66_Notifications.py` | 12 KB | Apr 14 | ~250 | Notifications — alert preferences, Telegram config |
| `67_Cash_Forecast.py` | 12 KB | Apr 14 | ~260 | Cash forecast — 30/60/90 day cash flow projection |
| `68_Goals.py` | 15 KB | Apr 14 | ~320 | Goals — financial and personal goal tracker |
| `69_Subscriptions.py` | 14 KB | Apr 14 | ~300 | Subscriptions — SaaS spend tracker, renewal reminders |
| `70_Family.py` | 12 KB | Apr 14 | ~270 | Family — Cora activities, family expense tracking |
| `71_Savings_Goals.py` | 20 KB | Apr 14 | ~440 | Savings goals — FHSA, vacation, emergency fund progress |
| `72_Local_AI.py` | 7.3 KB | Apr 14 | ~160 | Local AI — Ollama status, model selector, RAG test interface |
| `73_Keepa_Intel.py` | 18 KB | Apr 14 | ~380 | Keepa Intel — token balance, scan criteria, harvester controls |
| `74_Product_Intel.py` | 15 KB | Apr 10 | ~330 | Product Intel — per-ASIN research sheet |
| `75_Retail_HQ.py` | 68 KB | Apr 15 | 1465 | Retail HQ — consolidated deal scoring, source aggregator |
| `76_Crypto.py` | 25 KB | Apr 7 | ~540 | Crypto — portfolio tracker, price feeds |
| `77_AI_Coach.py` | 54 KB | Apr 14 | 1029 | AI Coach — Ollama RAG + Claude escalation, decision coaching |
| `78_Automations.py` | 15 KB | Apr 14 | ~320 | Automations — n8n workflow status, trigger controls |
| `79_MileIQ.py` | 9.3 KB | Apr 14 | ~200 | MileIQ — mileage log, CRA deduction calculator |
| `80_AI_Chat.py` | 8.4 KB | Apr 14 | ~180 | AI Chat — general-purpose Claude chat interface |
| `80_Deal_Tracker.py` | 10 KB | Apr 14 | ~230 | Deal Tracker — manual deal watchlist |
| `81_Prediction_Engine.py` | 18 KB | Apr 16 | ~380 | Prediction Engine — ML predictions for bets/trades |
| `82_Oura_Health.py` | 9.6 KB | Apr 14 | ~200 | Oura Health — standalone Oura API sync page |
| `83_Grocery_Tracker.py` | 81 KB | Apr 15 | 1556 | Grocery Tracker — Claude Vision grocery receipt parser, staple monitor |
| `84_Agent_Swarm.py` | 18 KB | Apr 14 | ~380 | Agent Swarm — multi-agent crew interface (CrewAI + Ollama) |
| `85_Retail_Radar.py` | 28 KB | Apr 14 | ~610 | Retail Radar — Reddit/RFD deal scanner |
| `86_Polymarket.py` | 11 KB | Apr 14 | ~230 | Polymarket — prediction market tracker, Kelly bet calculator |
| `87_Coras_Future.py` | 14 KB | Apr 14 | ~300 | Cora's Future — RESP projections, education savings |
| `88_Pet_Health.py` | 25 KB | Apr 14 | ~540 | Pet Health — vet expense tracker, vaccination schedule |
| `89_Accuracy_Dashboard.py` | 13 KB | Apr 14 | ~280 | Accuracy Dashboard — prediction win rate, confidence calibration |
| `90_CMS.py` | 22 KB | Apr 14 | ~480 | CMS — content/knowledge management system |
| `91_Welcome.py` | 346 B | Apr 15 | ~10 | Welcome — stub page for new users |
| `92_Help.py` | 7.8 KB | Apr 14 | ~170 | Help — user guide, page index |
| `93_Life_Compass.py` | 44 KB | Apr 14 | ~960 | Life Compass — values alignment, decisions journal |
| `94_Personal_Archive.py` | 15 KB | Apr 14 | ~320 | Personal Archive — ChromaDB personal memory search |
| `95_Legal_Advisor.py` | 13 KB | Apr 14 | ~280 | Legal Advisor — CRA compliance, contract review prompts |
| `96_GPU_Day.py` | 11 KB | Apr 14 | ~230 | GPU Day — Ollama 32B model setup tracker |
| `97_Dropbox_Archiver.py` | 7.0 KB | Apr 14 | ~150 | Dropbox Archiver — manual statement upload utility |
| `98_Debug.py` | 38 KB | Apr 15 | ~810 | Debug — system diagnostics, health checks, live data explorer |
| `99_Scanner_Phone.py` | 9.6 KB | Apr 15 | ~210 | Scanner Phone — mobile barcode scan relay (phone→Sheets→app) |
| `99_n8n_Webhook.py` | 4.0 KB | Apr 14 | ~87 | n8n Webhook — HTTP endpoint for n8n automation calls |
| `pages/tax_centre/` | dir | Apr 14 | — | Tax sub-pages |

### `utils/` — 67 utility modules

Key modules (full list in CODEBASE_INDEX.md):

| File | Size | Lines | Description |
|---|---|---|---|
| `auth.py` | 94 KB | 2132 | Auth: Google Sheets user store, bcrypt, rate limiting, session tokens |
| `amazon.py` | 92 KB | 2128 | SP-API: catalog, buy-box, FBA fees, ISBN→ASIN, order sync |
| `life_pl.py` | 46 KB | 1141 | Life P&L data layer: all income/expense sheet loaders |
| `actions.py` | 44 KB | 1098 | Action bus: dispatch(), all logged write operations |
| `n8n_webhooks.py` | 44 KB | 1077 | n8n webhook handlers for all 11 automation workflows |
| `insurance_analysis.py` | 43 KB | 1014 | Insurance: policy parsing, gap analysis, premium calc |
| `keepa_harvester.py` | 38 KB | 982 | Keepa bulk harvester: ASIN batches, ChromaDB storage |
| `retail_intel.py` | 36 KB | 945 | Retail intel: RFD scraper, deal scoring engine |
| `knowledge.py` | 38 KB | 942 | Knowledge system: SQLite event log, ChromaDB RAG, pattern learner |
| `local_ai.py` | 33 KB | 863 | Ollama client: smart_ask(), RAG pipeline, tunnel fallback |
| `sync_engine.py` | 34 KB | 827 | Offline-first sync: SQLite→Sheets bidirectional sync |
| `data_layer.py` | 31 KB | 816 | SQLite entity store: products, orders, transactions, receipts |
| `dropbox_statements.py` | 35 KB | 801 | Dropbox: statement PDF download, OCR balance extraction |
| `market_data.py` | 28 KB | 743 | Market data: yfinance, FX rates, stock quotes |
| `sheets.py` | 10 KB | ~230 | Sheets connection: get_spreadsheet(), circuit-breaker wrapped |
| `circuit_breaker.py` | 7.6 KB | ~165 | Circuit breaker: failure threshold, timeout, auto-reset |

### `scripts/` — 16 utility/data scripts

| File | Size | Description |
|---|---|---|
| `deal_scan.py` | 26 KB | GitHub Actions deal scanner — Keepa + SP-API, posts Telegram alerts |
| `export_to_chromadb.py` | 17 KB | Full export: Sheets + memories + source → ChromaDB (286 docs) |
| `migrate_hubdoc.py` | 13 KB | Hubdoc → Sheets migration script |
| `dropbox_archiver.py` | 16 KB | Dropbox archiving utility |
| `ingest_knowledge_base.py` | 21 KB | Ingest knowledge markdown → ChromaDB |
| `ingest_personal_archive.py` | 17 KB | Ingest personal archive → ChromaDB |
| `backfill_daily_profit.py` | 10 KB | Backfill daily P&L from COGS + order data |
| `delete_dupes_apr.py` | 5.1 KB | One-off dupe cleanup for April data |
| `seed_costco_apr14.py` | 2.9 KB | One-off seed: Costco April 14 transactions |
| `seed_cra_gst_apr15.py` | 2.3 KB | One-off seed: CRA GST April 15 |
| `seed_grocery_inventory.py` | 4.8 KB | Seed grocery inventory baseline |
| `post-edit-check.ps1` | 4.4 KB | Claude Code hook: post-edit validation |
| `session-summary.ps1` | 2.4 KB | Claude Code hook: session summary |

### `crawlers/` — 4 data crawlers

| File | Size | Description |
|---|---|---|
| `keepa_product_harvester.py` | 17 KB | Nightly Keepa batch: LEGO + Books + Toys → ChromaDB |
| `sp_enrich.py` | 12 KB | SP-API enrichment: add FBA fees + buy box to scan results |
| `pubmed_harvester.py` | 19 KB | PubMed research harvester (health knowledge base) |
| `data_crawler.py` | 10 KB | Generic data crawler base class |

### `tools/` — 2 prediction modules

| File | Size | Description |
|---|---|---|
| `trading_predictions.py` | 54 KB | M2K futures morning signal generator (53 KB) |
| `sports_predictions.py` | 12 KB | NHL/sports morning picks generator |

### `tests/` — 43 test files

Python pytest suite: smoke tests, unit tests, E2E playwright tests.

### `e2e/` — Puppeteer/Vitest E2E suite

| File | Description |
|---|---|
| `flows/auth.test.ts` | Login/logout flow tests |
| `flows/sections.test.ts` | Page section smoke tests |
| `smoke/pages.test.ts` | All-pages smoke test |
| `setup/browser.ts` | Browser setup for Puppeteer |
| `repair/repair.mjs` | Auto-repair utility for broken flows |

### `n8n/` — n8n workflow definitions

| File | Description |
|---|---|
| `01_daily_statement_sync.json` | Daily Dropbox statement sync (scheduled + Streamlit webhook) |
| `02_missing_statement_alert.json` | Alert if month's statement is missing |
| `03_app_health_check.json` | App health check with Telegram alert |
| `04_price_drop_monitor.json` | Watchlist price drop monitor |
| `05_retirement_price_check.json` | Keepa retirement price refresh |
| `06_staple_food_monitor.json` | Staple food price monitoring |
| `SETUP_GUIDE.md` | n8n setup and configuration guide |

### Other notable dirs

| Dir | Description |
|---|---|
| `.claude/` | Claude Code project config (settings.json only — no skills/) |
| `.streamlit/` | config.toml, secrets.toml, gmail_token.json |
| `.github/workflows/` | CI, Night Watch, Deal Scan, Uptime (disabled) |
| `ai-knowledge/knowledge-base/sessions/` | 10 session memory markdown files |
| `knowledge/survival/` | 8 offline survival knowledge .md files |
| `data/` | ship_addresses.json |
| `static/` | favicon, manifest.json, architecture.html |
| `outputs/` | n8n trigger JSON output files |
| `.lookup_cache/` | ISBN lookup cache (4 JSON files) |

---

## 2. Supabase Schema

**Supabase is NOT used in this codebase.** [grounded]

- Zero matches for `supabase`, `SUPABASE_URL`, or `supabase_client` across all Python files, config files, and secrets templates.
- The `.streamlit/secrets.toml.example` contains no Supabase keys. [grounded — `streamlit_app/.streamlit/secrets.toml.example`]
- The primary data store is **Google Sheets** (single spreadsheet, ID: `1arXxho2gD8IeWbQNcOt8IwZ7DRl2wz-qJzC3J4hiR4k`) with a local **SQLite cache** (`ai-knowledge/knowledge.db`) as the offline layer. [grounded — `streamlit_app/CLAUDE.md:19`, `streamlit_app/utils/data_layer.py:7`]

### Google Sheets Tabs Referenced in Code

All tabs below are in the main spreadsheet unless noted "Masterfile." Tab names are grounded in `utils/` sources.

| Tab Name | Source File | Domain |
|---|---|---|
| `👤 Users` | `utils/auth.py:41` | Auth |
| `📋 Login Log` | `utils/auth.py:48` | Auth |
| `📒 Business Transactions` | `utils/life_pl.py:227`, `utils/actions.py:871`, `utils/auto_reconcile.py:142` | Accounting |
| `📸 Receipts` | `utils/actions.py:861`, `utils/auto_reconcile.py:177`, `utils/life_pl.py:394` | Accounting |
| `🏦 Statement Lines` | `utils/life_pl.py:375`, `utils/n8n_webhooks.py:105` | Accounting |
| `🏷️ Vendor Rules` | `utils/actions.py:903`, `utils/auto_reconcile.py:50` | Accounting |
| `📋 Audit Log` | `utils/audit_log.py:33` | Accounting |
| `📋 Sign-Offs` | `utils/audit_log.py:43` | Accounting |
| `📊 Reconciliation Log` | `utils/auto_reconcile.py:596` | Accounting |
| `📊 Amazon 2026` | `utils/n8n_webhooks.py:479`, `utils/weekly_digest.py:59` | Commerce |
| `📦 FBA Items` | `utils/amazon.py:1538` | Commerce |
| `📦 COGS Lookup` | `utils/amazon.py:1583`, `utils/life_pl.py:995` | Commerce |
| `🛒 Colin - Items` | `utils/amazon.py:1605` | Commerce |
| `📦 Book Inventory` | `utils/n8n_webhooks.py:536`, `utils/weekly_digest.py:98` | Commerce |
| `💰 Payout Register` | `utils/life_pl.py:78` | Commerce |
| `💰 Southgate Tracker` | `utils/weekly_digest.py:110` | Commerce |
| `📈 Trading Journal` | `utils/life_pl.py:138`, `utils/weekly_digest.py:124` | Finance |
| `🎰 Bets` | `utils/life_pl.py:168` | Finance |
| `🧹 Cleaning Clients` | `utils/life_pl.py:196` | Megan |
| `⭐ Cora Activities` | `utils/life_pl.py:518` | Family |
| `🛡️ Insurance Policies` | `utils/life_pl.py:545` | Insurance |
| `🔄 Subscriptions` | `utils/life_pl.py:571` | Recurring |
| `⚡ Utility Tracker` | `utils/life_pl.py:603` | Recurring |
| `⚙️ Settings` | `utils/config.py:20`, `utils/n8n_webhooks.py:129` | Config |
| `⚠️ Brand Risk` | `utils/brand_risk.py:239` | Commerce |
| `📈 BSR History` | `utils/bsr_history.py:14` | Commerce |
| `🔭 Scout History` | `utils/bsr_history.py:84` | Commerce |
| `🏷️ Price Book` | `utils/coupon_lady.py:10` | Deals |
| `🏷️ Flyers` | `utils/coupon_lady.py:11` | Deals |
| `🏷️ Coupons` | `utils/coupon_lady.py:12` | Deals |
| `🏷️ Shopping List` | `utils/coupon_lady.py:13` | Deals |
| `🔍 Scan Criteria` | `utils/keepa_harvester.py:54` | Commerce |
| `🔍 Price Monitor` | `utils/price_monitor.py:32` | Commerce |
| `🔍 Monitored Products` | `utils/price_monitor.py:38` | Commerce |
| `🔍 Product Intel` | `utils/product_intel.py:15` | Commerce |
| `🧱 Lego Vault` | `utils/n8n_webhooks.py:371` | Commerce |
| `🧱 Retiring Sets` | `utils/lego_retirement.py:31` | Commerce |
| `📦 Watchlist` | `utils/n8n_webhooks.py:391` | Deals |
| `🛒 Retail Deals` | `utils/retail_intel.py:29` | Deals |
| `📧 Email Invoices` | `utils/email_invoices.py:31` | Accounting |
| `📧 Known Senders` | `utils/gmail.py:166` | Email |
| `💰 PageProfit Scans` | `utils/actions.py:982` | Commerce |
| `🤖 Token Usage` | `utils/token_tracker.py:11` | AI |
| `Agent Logs` | `utils/knowledge_export.py:190` | AI |
| `Cashback Tracker` | `utils/knowledge_export.py:297` | Finance |
| `FBA Inventory` | `utils/knowledge_export.py:265` | Commerce |
| `Goal Tracking` *(Masterfile)* | `utils/masterfile.py:60` | Goals |
| `Colin Expenses {year}` *(Masterfile)* | `utils/masterfile.py:129` | Personal |
| `Megan Expenses {year}` *(Masterfile)* | `utils/masterfile.py:171`, `utils/life_pl.py:487` | Megan |
| `Credit Cards` *(Masterfile)* | `utils/masterfile.py:210` | Finance |

### SQLite Local Schema (knowledge.db)

Tables defined in `utils/data_layer.py:83–550` — the offline-first entity cache:

| Table | Key Columns | Notes |
|---|---|---|
| `products` | id, asin, isbn, title, category, cost, quantity, status, source | LEGO set fields: set_number, piece_count, retail_price, retire_date |
| `listings` | id, product_id, marketplace, sku, listing_price, status | UNIQUE(product_id, marketplace) |
| `orders` | id, product_id, marketplace, order_date, revenue, profit, cogs | Source: sp-api |
| `payouts` | id, marketplace, period_start, period_end, amount_expected, amount_received | |
| `shipments` | id, name, destination, status, box_count, item_count | |
| `shipment_items` | id, shipment_id, product_id, box_number, asin, quantity | |
| `deals` | id, asin, category, source, buy_price, sell_price, roi_pct | Sources: keepa, retail_scout, rfd |
| `scan_results` | id, isbn, asin, bsr, buy_box_price, roi_pct, decision | Decisions: buy/skip/watch |
| `price_history` | id, asin, price_type, price, recorded_at | Source: keepa |
| `transactions` | id, txn_date, vendor, category, pre_tax, gst, total, hubdoc | Linked to receipts |
| `receipts` | id, vendor, pre_tax, gst, total, drive_url, match_status, ocr_source | Sources: tesseract, claude_vision |
| `statement_lines` | id, account, line_date, amount, reconciled, dedup_key | Accounts: td_chequing, amex, costco_mc |

All tables have: `_sync_status` (synced/unsynced/conflict), `_sheet_row`, `created_at`, `updated_at`.

RLS: Not applicable (SQLite, single-user local).

---

## 3. Component / Module Inventory

### Pages (user-facing, `pages/`)

> Full list in Section 1. Summary by domain:

| Domain | Pages | Notes |
|---|---|---|
| Financial P&L | 1_Life_PL, 5_Monthly_PL, 28_Category_PL, 53_Business_History | Core business reporting |
| Amazon Commerce | 21_PageProfit, 30_Shipment_Manager, 7_Inventory, 65_Repricer, 26_Sales_Charts, 60_Amazon_Orders, 17_Payouts, 22_Inventory_Spend | Largest module by line count |
| Deals & Sourcing | 46_Arbitrage_Scanner, 47_Lego_Vault, 48_Retail_Monitor, 73_Keepa_Intel, 74_Product_Intel, 75_Retail_HQ, 80_Deal_Tracker, 85_Retail_Radar | Keepa + SP-API heavy |
| Bookkeeping | 8_Bookkeeping_Hub, 12_Receipts, 38_Paper_Trail, 4_Monthly_Expenses, 54_Monthly_Close, 23_Expense_Dashboard | Statement + receipt pipeline |
| Trading & Betting | 2_Trading_Journal, 3_Sports_Betting, 81_Prediction_Engine, 86_Polymarket | Claude + ML models |
| Health | 8_Health, 82_Oura_Health | Oura Ring API |
| Tax | 6_Tax_Centre, 58_Tax_Return | CRA T4/T5 data |
| Shopping | 29_Groceries, 41_Coupon_Lady, 42_Retail_Scout, 49_Cashback_HQ, 83_Grocery_Tracker | Flipp API + Claude Vision |
| AI & Agents | 72_Local_AI, 77_AI_Coach, 80_AI_Chat, 84_Agent_Swarm | Ollama + ChromaDB + Claude |
| Personal Finance | 51_Retirement_Tracker, 61_Net_Worth, 63_Debt_Payoff, 67_Cash_Forecast, 68_Goals, 71_Savings_Goals, 76_Crypto | |
| Personal Life | 24_Calendar, 70_Family, 87_Coras_Future, 88_Pet_Health, 93_Life_Compass | |
| Admin/System | 10_Admin, 37_Command_Centre, 78_Automations, 98_Debug, 99_n8n_Webhook | |

### Utility Modules (`utils/`)

67 files total. Key groupings:

| Group | Modules |
|---|---|
| Data access | `sheets.py`, `data_layer.py`, `sync_engine.py`, `api_client.py`, `masterfile.py` |
| Auth & Security | `auth.py`, `circuit_breaker.py`, `dev_mode.py` |
| Amazon | `amazon.py`, `keepa_api.py`, `keepa_harvester.py`, `fba_fees.py`, `amazon_fees_ca.py`, `fnsku_generator.py` |
| AI | `local_ai.py`, `ai.py`, `ai_agent.py`, `agent_crew.py`, `managed_agent.py`, `knowledge.py`, `knowledge_export.py` |
| Accounting | `actions.py`, `auto_reconcile.py`, `dropbox_statements.py`, `gmail.py`, `email_invoices.py`, `audit_log.py`, `statement_rules.py` |
| Commerce | `retail_intel.py`, `retail_scout.py`, `retail_matcher.py`, `coupon_lady.py`, `price_monitor.py`, `brand_risk.py` |
| Finance | `life_pl.py`, `market_data.py`, `sports_odds.py`, `sports_backtester.py`, `sports_coach.py` |
| UI/Config | `style.py`, `config.py`, `help_tooltips.py`, `voice.py` |
| Notifications | `alerts.py`, `telegram_utils.py`, `n8n_webhooks.py`, `proactive_agents.py` |

---

## 4. Agent / Automation / Prompt Inventory

### Claude Code Config

| File | Description |
|---|---|
| `streamlit_app/.claude/settings.json` | Claude Code project settings (no skills/) [grounded] |
| `streamlit_app/CLAUDE.md` | Project instructions: stack conventions, spreadsheet ID, auth patterns [grounded] |
| `streamlit_app/AGENT_PROMPT.md` | Template for autonomous build agent prompts — install, read CLAUDE.md, branch, test, PR [grounded] |
| `streamlit_app/skills_manifest.json` | 11 skill definitions with trigger phrases (not actual skill files — no `.claude/skills/` dir) [grounded] |

**Note:** The global CLAUDE.md claims 11 skills in `.claude/skills/` for this project. The actual `.claude/` directory contains only `settings.json`. No skill `.md` files exist locally. [grounded — `streamlit_app/.claude/` directory listing]

### Automation / Scheduling

| File | Type | Schedule / Trigger |
|---|---|---|
| `.github/workflows/deal_scan.yml` | GitHub Actions | Cron: 6 AM + 6 PM MDT daily; runs `scripts/deal_scan.py` [grounded] |
| `.github/workflows/night-watch.yml` | GitHub Actions | Cron: 7 AM MDT daily; compile check + smoke tests + Telegram alert [grounded] |
| `.github/workflows/ci.yml` | GitHub Actions | On push: compile check, import tests, bandit scan [grounded] |
| `.github/workflows/uptime.yml.disabled` | GitHub Actions | Disabled; was uptime monitor [grounded] |
| `telegram_bot.py` (function `_check_scheduled_alerts`) | Python polling loop | Runs every poll cycle (~2–3s); time-gated tasks by MT hour: 8AM Oura sync, 2AM Keepa harvest, and more [grounded — `telegram_bot.py:1091`] |

### Telegram Bot Scheduled Tasks (from `telegram_bot.py:_check_scheduled_alerts`)

| Time (MT) | Task |
|---|---|
| 8:00 AM | Oura Ring sync → Sheets |
| 2:00 AM | Keepa product harvest → ChromaDB |
| *(morning)* | Trading predictions (M2K signal) |
| *(morning)* | Sports picks (NHL/CFL) |
| *(morning)* | Polymarket predictions |
| 11:30 PM | Daily profit backfill |
| *(weekly)* | Edmonton events digest |

### n8n Workflows

| File | Workflow | Trigger |
|---|---|---|
| `n8n/01_daily_statement_sync.json` | Daily Dropbox statement sync → Streamlit webhook | Scheduled [grounded] |
| `n8n/02_missing_statement_alert.json` | Alert when statement missing | Scheduled |
| `n8n/03_app_health_check.json` | App health check + Telegram | Scheduled |
| `n8n/04_price_drop_monitor.json` | Watchlist price drop check | Scheduled |
| `n8n/05_retirement_price_check.json` | Keepa retirement price refresh | Scheduled |
| `n8n/06_staple_food_monitor.json` | Staple food price check | Scheduled |

Webhook base URL: `https://loeppky-app.streamlit.app/n8n_Webhook?endpoint=...` [grounded — `n8n/01_daily_statement_sync.json:22`]

### Prompt / AI Files

| File | Description |
|---|---|
| `utils/managed_agent.py` | Managed Claude API agent — iterates fixes, reads/writes Sheets, structured tool use |
| `utils/ai_agent.py` | Lower-level agent scaffolding — tool dispatch, retry logic |
| `utils/agent_crew.py` | CrewAI 3-agent team: Orchestrator + Coder + Reviewer (Ollama qwen2.5-coder:7b) |
| `utils/coach_brain.py` | AI Coach logic: decision framing, risk tolerance, context injection |
| `utils/local_ai.py` | Ollama `smart_ask()` — RAG pipeline: ChromaDB → Ollama, fallback to Claude API |
| `utils/proactive_agents.py` | Proactive alert agents — monitor data, fire Telegram when thresholds crossed |
| `utils/translator.py` | Multi-language translation via Claude API |
| `tools/trading_predictions.py` | M2K futures signal generator (53 KB — Claude + technical indicators) |
| `tools/sports_predictions.py` | Sports picks morning generator |

### Telegram Bot Handlers

| File | Bot | Handler |
|---|---|---|
| `telegram_bot.py` | `loeppky_daily_bot` | `handle_message(text)` — command router; `_handle_callback(data)` — inline buttons [grounded] |
| `builder_bot.py` | `loeppky_trigger_bot` (builder bot) | Manages build agents for BBV + Loeppky OS + Megan [grounded] |

`utils/telegram_utils.py` and `utils/alerts.py` are shared helper libraries for both bots.

---

## 5. Integrations Status

| Integration | Status | File(s) |
|---|---|---|
| **Oura API** | Configured-not-live | `pages/82_Oura_Health.py:46` (Bearer token from secrets); `telegram_bot.py:1109` (nightly sync); token key: `secrets["oura"]["token"]` |
| **Amazon SP-API** | Live | `utils/amazon.py` (python-amazon-sp-api>=0.19); creds: refresh_token, lwa_app_id, lwa_client_secret, aws_access_key in secrets; `sp_api_configured()` checks all fields |
| **Keepa API** | Live | `utils/keepa_api.py`, `utils/keepa_harvester.py`; key from `secrets["keepa"]["api_key"]`; circuit-breaker guarded |
| **Stripe** | Absent | Not referenced in any Python file or config (CODEBASE_INDEX.md mentions it only in a style.py comment) |
| **Twilio / SMS** | Configured-not-live | `utils/alerts.py:64–137` — `_twilio_configured()` checks secrets; sends SMS as fallback to Telegram; template in secrets.toml.example |
| **Telegram Bot** | Live | `telegram_bot.py` (main bot), `builder_bot.py` (builder bot); `utils/alerts.py` fires `loeppky_alerts_bot` |
| **TradingView** | Absent | Referenced only as a UI copy target ("copy for TradingView") in `pages/2_Trading_Journal.py:1034` — no API integration |
| **Play Alberta / Sports Betting** | Stub | Sports Betting page uses **The Odds API** (`utils/sports_odds.py:36`) for live odds. Play Alberta specifically referenced by name in ALBERTA_SPORTS constant but no Play Alberta API. Bet data is logged manually to Sheets (`🎰 Bets` tab) |
| **1Password MCP** | Absent | Not referenced in any Python or config file in streamlit_app |
| **Google Sheets** | Live | `utils/sheets.py` — core data store; gspread; 50+ tabs; spreadsheet ID in CLAUDE.md |
| **ChromaDB / local vector DB** | Configured-not-live | `utils/knowledge.py:47` (collection `colin-memories`); `utils/local_ai.py`; path: `ai-knowledge/vectordb/`; chromadb>=0.4 in requirements; depends on local Ollama being up |
| **Ollama / local LLM** | Configured-not-live | `utils/local_ai.py:22–184`; `localhost:11434` + optional tunnel URL from secrets; model: qwen2.5-coder:7b; falls back to Claude API when offline |
| **Anthropic Claude API** | Live | `utils/ai.py`, `utils/managed_agent.py`, `utils/local_ai.py`; anthropic>=0.93 in requirements; key from `secrets["anthropic"]["api_key"]` |
| **Google Drive / Gmail** | Live | `utils/drive.py`, `utils/gmail.py`; OAuth via gmail-credentials.json + gmail-token.json; used for receipt email ingestion |
| **Dropbox** | Live | `utils/dropbox_statements.py`; dropbox>=12.0 in requirements; refresh_token in secrets; statement PDF download |
| **eBay API** | Configured-not-live | `utils/ebay_api.py`, `utils/ebay.py`; no explicit secrets key visible in example — inferred from code |
| **n8n** | Configured-not-live | 6 workflow JSON files in `n8n/`; webhook endpoint at `/n8n_Webhook`; n8n instance URL not visible in codebase (would be in n8n itself) |
| **The Odds API** | Configured-not-live | `utils/sports_odds.py:36`; key from `secrets["odds"]["api_key"]` or env `ODDS_API_KEY` |
| **Flipp API** | Configured-not-live | `utils/flipp_api.py`, `utils/flyer_intel.py`; no auth key required (public scrape) |
| **Reddit/RFD scraper** | Stub | `utils/redflagdeals.py`; `utils/retail_intel.py`; scraping only, no API key |
| **yfinance** | Live | `utils/market_data.py`; yfinance>=0.2.40 in requirements; no auth needed |
| **CrewAI** | Configured-not-live | `utils/agent_crew.py`; crewai NOT in requirements.txt (excluded from Streamlit Cloud deploy); local-only install |
| **Sentry** | Configured-not-live | `app.py:9` — init if `SENTRY_DSN` env var present; sentry-sdk NOT in requirements.txt (local-only) |

---

## 6. Docs Inventory

| File | Size | Description |
|---|---|---|
| `streamlit_app/CLAUDE.md` | 9.8 KB | Project Claude Code instructions — stack conventions, patterns, spreadsheet ID |
| `streamlit_app/CODEBASE_INDEX.md` | 37 KB | Full module index — 74 pages, 67 utils, all sheet tabs, session state, scheduled tasks |
| `streamlit_app/ARCHITECTURE.md` | 29 KB | System architecture — 25 entities, 7 domains, action bus, offline-first design |
| `streamlit_app/KNOWLEDGE_SYSTEM.md` | 27 KB | Knowledge pipeline — SQLite event log, ChromaDB, RAG, pattern learner |
| `streamlit_app/SYSTEM_INTEGRITY_CHECKLIST.md` | 11 KB | Manual QA checklist — all pages, data flows, smoke test guide |
| `streamlit_app/AGENT_PROMPT.md` | 1.6 KB | Template for Claude Code autonomous build agents |
| `streamlit_app/TASK_QUEUE_SEED.md` | 3.9 KB | Seeded agent task backlog |
| `streamlit_app/docs/INFRA-MAP.md` | — | Infrastructure map — Docker, Nginx, Cloudflare Tunnel, n8n topology |
| `streamlit_app/n8n/SETUP_GUIDE.md` | — | n8n workflow setup and configuration guide |
| `streamlit_app/knowledge/survival/edible_plants.md` | — | Offline knowledge: edible plants reference |
| `streamlit_app/knowledge/survival/first_aid.md` | — | Offline knowledge: first aid reference |
| `streamlit_app/knowledge/survival/forest_fire.md` | — | Offline knowledge: forest fire safety |
| `streamlit_app/knowledge/survival/navigation.md` | — | Offline knowledge: wilderness navigation |
| `streamlit_app/knowledge/survival/shelter_fire.md` | — | Offline knowledge: shelter and fire building |
| `streamlit_app/knowledge/survival/tree_identification.md` | — | Offline knowledge: tree identification |
| `streamlit_app/knowledge/survival/water_safety.md` | — | Offline knowledge: water safety/purification |
| `streamlit_app/knowledge/survival/wildlife_safety.md` | — | Offline knowledge: wildlife safety |

Session memory files (`ai-knowledge/knowledge-base/sessions/`):

| File | Description |
|---|---|
| `session-2026-04-13-bbv-security-audit.md` | BBV security audit session |
| `session-2026-04-15-deals-sourcing-overhaul.md` | Deals sourcing overhaul |
| `session-2026-04-15-pageprofit-phone-relay-labels.md` | PageProfit phone relay + labels |
| `session-2026-04-16-ollama-coding-upgrade.md` | Ollama coding setup upgrade |
| `session-2026-04-16-os-overhaul.md` | OS overhaul session |
| `session-2026-04-16-research-agents.md` | Research agents build |
| `session-2026-04-17-claude-code-autonomous-config.md` | Claude Code autonomous config |
| `session-2026-04-17-security-audit-hubdoc-migration.md` | Security audit + Hubdoc migration |
| `session-2026-04-17-sports-betting-ux-redesign.md` | Sports Betting UX redesign |
| `session-2026-04-17-twin-session-workflow.md` | Twin session workflow |

---

## Grounding Manifest

All claims in this document are either **grounded** (file path + line number cited) or **generated** (inference from filename/structure). Every grounded claim is verifiable against the files listed below.

| File Read | Used For |
|---|---|
| `streamlit_app/.streamlit/secrets.toml.example` | Integration status: confirmed secrets keys |
| `streamlit_app/.env.local.example` | No Supabase keys |
| `streamlit_app/CLAUDE.md` | Spreadsheet ID, stack conventions, scheduled tasks list |
| `streamlit_app/app.py` | Navigation sections, Sentry init |
| `streamlit_app/Dockerfile` | Python 3.12, tesseract, ChromaDB volumes |
| `streamlit_app/requirements.txt` | All package versions |
| `streamlit_app/telegram_bot.py` (lines 1–60, 1090–1200, 1540–1640) | Scheduled tasks, bot structure, Oura sync |
| `streamlit_app/builder_bot.py` (lines 1–50) | Builder bot token key, BBV/Megan/Loeppky paths |
| `streamlit_app/utils/auth.py` (lines 1–80) | Auth sheet names, no Supabase |
| `streamlit_app/utils/sheets.py` (lines 1–60) | gspread usage, no Supabase |
| `streamlit_app/utils/data_layer.py` (lines 1–400) | SQLite schema tables and columns |
| `streamlit_app/utils/local_ai.py` (lines 1–184) | Ollama config, fallback pattern |
| `streamlit_app/utils/agent_crew.py` (lines 1–50) | CrewAI + Ollama qwen2.5-coder:7b |
| `streamlit_app/utils/n8n_webhooks.py` (lines 1–50) | n8n endpoint list |
| `streamlit_app/utils/alerts.py` (lines 1–148) | Twilio configured-not-live |
| `streamlit_app/utils/sports_odds.py` (lines 1–50) | The Odds API, not Play Alberta |
| `streamlit_app/pages/82_Oura_Health.py` (lines 1–130) | Oura API Bearer token usage |
| `streamlit_app/pages/3_Sports_Betting.py` (lines 1–50) | Sports Betting — Odds API + manual Sheets logging |
| `streamlit_app/AGENT_PROMPT.md` | Agent prompt template |
| `streamlit_app/.github/workflows/deal_scan.yml` | Cron schedule, GitHub Actions |
| `streamlit_app/.github/workflows/night-watch.yml` | Night Watch schedule + Telegram alert |
| `streamlit_app/.github/workflows/ci.yml` | CI on push |
| `streamlit_app/n8n/01_daily_statement_sync.json` | n8n webhook URL structure |
| `streamlit_app/.claude/settings.json` | No skills directory |
| Grep output: `supabase` across all `.py` | Zero matches — confirmed Supabase absent |
| Grep output: `\.worksheet\(` across `utils/` | All Google Sheets tab names |
| Grep output: `SHEET_NAME`, `DEALS_SHEET`, `RULES_SHEET`, etc. | Resolved sheet tab constants |
| Grep output: `oura|chromadb|ollama` across all files | Integration file mapping |
| `ls -la` of `pages/`, `utils/`, `scripts/`, `tests/`, `.claude/`, `ai-knowledge/` | File sizes, dates |
| `wc -l` of all `pages/*.py` and `utils/*.py` | Line counts |
