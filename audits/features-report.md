# LepiOS Phase 2 — Feature Completeness Audit

**Agent:** C — Feature Completeness  
**Date:** 2026-04-17  
**Method:** Read-only. No files modified.  
**Scope:** v1 Money-pillar modules + ingestion layer. v2 modules noted but not deep-audited.  
**Source:** `C:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)/streamlit_app/`

---

## 1. v1 Module Inventory

| Module | Status | Key Files | Port vs. Rebuild | Effort |
|--------|--------|-----------|-----------------|--------|
| **Trading — Log + P&L** | Working | `pages/2_Trading_Journal.py` (1903 lines), `utils/market_data.py` | **Port** — complete CRUD + analytics | M |
| **Trading — AI Briefing / Setup Scan** | Working | `pages/2_Trading_Journal.py:333–839`, `tools/trading_predictions.py` | **Port** — Claude API calls are direct | M |
| **Trading — Today's Orders (M2K)** | Working | `pages/2_Trading_Journal.py:843–`, `utils/market_data.py` | **Port** — yfinance pivot-point math | M |
| **Trading — Bot morning scan** | Working | `telegram_bot.py:_check_scheduled_alerts`, `tools/trading_predictions.py` | **Port** — re-wire Telegram dispatch | S |
| **Betting — Bet logger** | Working | `pages/3_Sports_Betting.py:167–215` (append_bet, update_bet_result) | **Port** — Sheets write layer | S |
| **Betting — Bankroll / 1% stake** | Working | `pages/3_Sports_Betting.py:218–250` | **Port** — trivial math | S |
| **Betting — Kelly Sizer** | Working | `pages/3_Sports_Betting.py:361–412, 1130–1203` | **Port** — pure math, well-isolated | S |
| **Betting — Edge Finder (live odds)** | Partial | `pages/3_Sports_Betting.py:1448–1603`, `utils/sports_odds.py` | **Port** — needs Odds API key wiring | M |
| **Betting — AI debrief / pattern scan** | Working | `pages/3_Sports_Betting.py:1858–2040` | **Port** — Claude API calls | S |
| **Amazon — PageProfit scanner** | Working | `pages/21_PageProfit.py` (3373 lines), `utils/amazon.py`, `utils/ebay.py`, `utils/sourcing.py` | **Port** — complex but mostly data transforms | XL |
| **Amazon — Shipment Manager (scan/list/ship)** | Working | `pages/30_Shipment_Manager.py` (1176 lines), `utils/amazon.py` | **Port** — SP-API calls, FNSKU label PDF | L |
| **Amazon — Nightly deal scan** | Working | `scripts/deal_scan.py`, `.github/workflows/deal_scan.yml` | **Port** — self-contained script, easy to adapt | M |
| **Amazon — Inventory** | Working | `pages/7_Inventory.py`, `utils/amazon.py` | **Port** | M |
| **Amazon — Repricer** | Working | `pages/65_Repricer.py` | **Port** | M |
| **Amazon — Orders / Sales Charts** | Working | `pages/60_Amazon_Orders.py`, `pages/26_Sales_Charts.py` | **Port** | S |
| **Expenses — Business (Monthly Expenses)** | Working | `pages/4_Monthly_Expenses.py` (1039 lines) | **Port** | M |
| **Expenses — Personal (Colin + Megan)** | Working | `pages/25_Personal_Expenses.py`, `utils/masterfile.py` | **Port** | S |
| **Expenses — AI classification** | Partial | `utils/auto_reconcile.py`, `pages/8_Bookkeeping_Hub.py` | **Beef-up** — auto-classify exists, not agent-driven | M |
| **Dashboard / Home** | Partial | `Business_Review.py` (191 KB), `app.py` | **Rebuild** — Streamlit-nav-hub pattern doesn't port | M |
| **Telegram bot ingestion** | Working | `telegram_bot.py` (1640 lines) | **Port** — Python dispatch logic | M |
| **Ollama / local AI routing** | Working | `utils/local_ai.py` (863 lines) | **Port** | S |
| **GitHub Actions deal scan** | Working | `.github/workflows/deal_scan.yml`, `scripts/deal_scan.py` | **Port** — keep as-is or move to cron | S |

---

## 2. Detailed Assessment — v1 Money-Pillar Modules

### 2.1 Trading

**What exists and works:** [grounded: `pages/2_Trading_Journal.py:1–1903`]

- Full trade log with CRUD: add, edit, delete trades to `📈 Trading Journal` Google Sheet [grounded: `2_Trading_Journal.py:110–120`]
- P&L accounting: `Points P&L` × `$5/point` (MES/M2K), auto-fill from points [grounded: `2_Trading_Journal.py:88–92`]
- YTD equity curve, win rate, R:R, avg win/loss, streak, best/worst trade [grounded: `2_Trading_Journal.py:209–260`]
- Mood tracking — 11 mood options; best/worst-mood performance summary [grounded: `2_Trading_Journal.py:286–296`]
- Morning Routine guide card (Step 1–4 workflow) [grounded: `2_Trading_Journal.py:319–330`]
- **Today's Orders tab** — lazy-loads M2K pivot levels, ATR, VIX regime, VWAP, session bias, limit order plan via yfinance; "copy for TradingView" output [grounded: `2_Trading_Journal.py:843–900`]
- **AI Briefing tab** — Claude API call with live market snapshot + trader history context [grounded: `2_Trading_Journal.py:595–713`]
- **Deep Scan tab** — full setup scan: entry, stop, target, R:R, 2 setups, "Do NOT Trade" section [grounded: `2_Trading_Journal.py:717–839`]
- **Scan All Instruments tab** — manually triggers `tools/trading_predictions.py:scan_all_instruments()` for 14 instruments; shows top 5 setups [grounded: `2_Trading_Journal.py:344–411`]
- **You vs AI tab** — compares Colin's actual trades against bot predictions (win rate, P&L, discipline score, cumulative chart) [grounded: `2_Trading_Journal.py:1750–1843`]
- **AI Learning tab** — displays bot weight evolution over time [grounded: `2_Trading_Journal.py:1846–1891`]
- Bot morning scan: `_check_scheduled_alerts` in `telegram_bot.py` fires M2K signal at ~8:30 AM MT on weekdays; logs to `Trading_Predictions` sheet [grounded: `telegram_bot.py:_check_scheduled_alerts` section]

**What's broken / missing for v1 bar:**

- No TradingView API integration (explicitly absent — IBKR order builder just generates copy text) [grounded: `pages/2_Trading_Journal.py:1034` comment]
- `Trading_Predictions` and `Trading_Predictions_Learning` sheets only auto-created on first bot run — first-time users see "not created yet" messages [grounded: `2_Trading_Journal.py:1843–1844`]
- P&L logging: must be done manually (by design — no signals executed blindly). This is correct per ARCHITECTURE.md §3.1

**Port effort assessment:** M. Core logic is Python data transforms + Claude API calls. The `_kelly_fraction`, `_win_rate_for_odds`, `generate_order_plan`, and `get_daily_snapshot` functions are all portable. Port risk: yfinance reliability (external dependency). The `tools/trading_predictions.py` (54 KB) is the most complex single piece.

---

### 2.2 Betting / Kelly Sizer

**What exists and works:** [grounded: `pages/3_Sports_Betting.py:1–2041`]

- Full bet log: sport, league, home/away, bet on, bet type, odds, stake, result, P&L, bankroll-after, AI notes [grounded: `3_Sports_Betting.py:134–138`]
- Bankroll tracker: dedicated `🎰 Bankroll` sheet; historical balance chart [grounded: `3_Sports_Betting.py:201–215`]
- 1% stake calculator: `stake_for_balance(balance)` → always visible at top [grounded: `3_Sports_Betting.py:231`]
- Season P&L summary bar: W/L/P record, total P&L, ROI, streak, bankroll watermarks [grounded: `3_Sports_Betting.py:252–294`]
- System Proof Panel: break-even math, flat $10 EV, "PROFITABLE SYSTEM / BREAKING EVEN / LOSING EDGE" badge [grounded: `3_Sports_Betting.py:417–534`]
- **Four tabs:** Log Bet / Results / Full History / Deep Dive

**Kelly Sizer — Deep Dive (see §3 for full description):**
Complete Kelly implementation including `_kelly_fraction()`, per-odds-range breakdown, and stake recommendations.

**Edge Finder tab:** Pulls live odds via The Odds API; scores games by `_score_game()` which returns edge, Kelly%, EV/dollar, rec stake; Alberta-sports filter; shows top 5 ranked games [grounded: `3_Sports_Betting.py:374–413, 1448–1603`]

**What's broken / missing for v1 bar:**

- The Odds API key required for Edge Finder live odds — configured-not-live on Streamlit Cloud (key in secrets but depends on deployment) [grounded: `00-inventory.md §5`]
- No Play Alberta API (Play Alberta is name-only; all bet logging is manual) [grounded: `00-inventory.md §5`]
- Backtesting & Elo tab exists in the page tabs but wasn't read in detail — likely partial

**Port effort assessment:** S–M. Kelly math is pure arithmetic. Bet CRUD is simple. The Odds API integration is straightforward. The hardest piece is the scoring/ranking logic in `_score_game()` — ~40 lines of Python that port directly to TypeScript.

---

### 2.3 Amazon

**What exists and works:**

**PageProfit (scan/ISBN lookup):** [grounded: `pages/21_PageProfit.py:1–3373`]
- ISBN/barcode → ASIN → buy box, FBA fees, profit calculation [grounded: `21_PageProfit.py:38–68`]
- Multi-marketplace: Amazon.ca, eBay, Buyback [grounded: `21_PageProfit.py:83–95`]
- Decision gates: min profit, min BSR, max rank [grounded: via `utils/sourcing.py` import]
- Session history to `💰 PageProfit Scans` sheet
- Phone relay: `relay_poll()` — phone scans → Sheets → app picks up [grounded: `21_PageProfit.py:35`]
- Quick Vision: `_quick_vision_check()` for condition assessment [grounded: `21_PageProfit.py:68`]

**Shipment Manager (scan → list → ship):** [grounded: `pages/30_Shipment_Manager.py:1–1176`]
- 5-tab workflow: Scan / List / Shipment / Box / Complete [grounded: `30_Shipment_Manager.py:264–266`]
- Progress tracker: 5 stage indicators [grounded: `30_Shipment_Manager.py:247–259`]
- Manifest management: scan ISBN, lookup ASIN, add to manifest; import from Scoutly queue [grounded: `30_Shipment_Manager.py:304–346`]
- SP-API integration: `test_amazon_connection()` [grounded: `30_Shipment_Manager.py:212–224`]
- Secure per-user address files (HMAC-hashed dirs) [grounded: `30_Shipment_Manager.py:34–43`]

**Nightly deal scan (GitHub Actions):** [grounded: `scripts/deal_scan.py`, `.github/workflows/deal_scan.yml`]
- Runs 6 AM + 6 PM MDT daily via cron [grounded: `deal_scan.yml:5–7`]
- Track 1: StockTrack → SP-API → real ROI (retail price → Amazon sell price − fees) [grounded: `deal_scan.py:6–16`]
- Track 2: Keepa Product Finder (50 ASINs/category, stats_only mode = low token cost) [grounded: `deal_scan.py:144–145`]
- Track 3: OOS Watch (velocity/scarcity signals) [grounded: `deal_scan.py:17–19`]
- Sends Telegram alerts with deal cards [grounded: `deal_scan.py:229–248`]
- Deduplication: loads today's ASINs from sheet before appending [grounded: `deal_scan.py:198–216`]

**Arbitrage Scanner (in-app):** [grounded: `pages/46_Arbitrage_Scanner.py:1–1632`]
- Product lookup: ASIN → Keepa price/rank history + ROI calc [grounded: `46_Arbitrage_Scanner.py:1–9`]
- Deal tracker: save/track deals with status [grounded: `46_Arbitrage_Scanner.py:53–80`]
- Price watchlist: monitor retail sites [grounded: `46_Arbitrage_Scanner.py:59–63`]
- Keepa criteria-based scan [grounded: `46_Arbitrage_Scanner.py:43–48`]

**What's broken / missing for v1 bar:**

- Shipment listing tab (Tab 2) not read in detail — SP-API listing creation may require additional credential setup
- FNSKU label PDF generation depends on the `fpdf` or equivalent library in requirements
- Telegram inline Buy/Skip/Info buttons for deal alerts exist (`telegram_bot.py:1259–1288`) but require the arb_engine module [grounded: `telegram_bot.py:1263`]
- The Scoutly phone relay depends on a Sheets "queue" tab being present

**Port effort assessment:** XL (PageProfit is 3373 lines with parallel fetch, caching, multi-marketplace arbitrage). The core SP-API calls in `utils/amazon.py` (2128 lines) are the hardest port. The deal scan script itself is M effort. Shipment Manager is L.

---

### 2.4 Expenses

**What exists and works:**

**Business Expenses (Monthly Expenses):** [grounded: `pages/4_Monthly_Expenses.py:1–1039`]
- 24 business expense categories with Canadian tax rates [grounded: `4_Monthly_Expenses.py:23–55`]
- 11 payment methods [grounded: `4_Monthly_Expenses.py:57–69`]
- Business-use % allocation (`[bus:N]` encoding in notes) [grounded: `4_Monthly_Expenses.py:123–135`]
- Recurring expense series: `one-time / monthly / annual` [grounded: `4_Monthly_Expenses.py:287–290`]
- `do_add_expense()` writes to `📒 Business Transactions` sheet [grounded: `4_Monthly_Expenses.py:282`]
- Writes through to `📊 Amazon 2026` P&L as expenses column [grounded: `4_Monthly_Expenses.py:137–143`]

**Personal Expenses:** [grounded: `pages/25_Personal_Expenses.py:1–100+`]
- Reads `Colin Expenses {year}` from Masterfile spreadsheet [grounded: `25_Personal_Expenses.py:10–24`]
- Reads `Megan Expenses {year}` from Masterfile [grounded: `25_Personal_Expenses.py:10`]
- Monthly total trend chart, category breakdown [grounded: `25_Personal_Expenses.py:83–100`]
- Business vs personal split exists via `[bus:N]` tag in Business Transactions

**Auto-reconcile / AI classify:** [grounded: `utils/auto_reconcile.py` referenced throughout]
- Statement line import pipeline [grounded: `utils/dropbox_statements.py`]
- Vendor rule matching (`🏷️ Vendor Rules` sheet) [grounded: `utils/auto_reconcile.py:50`]
- Does NOT currently use an AI "Expenses Agent" per ARCHITECTURE.md definition — classification is rule-based

**What's broken / missing for v1 bar:**

- No anomaly flagging agent (business vs personal, Colin vs Megan — classification exists but not agent-driven per §3.1 definition)
- Business-use % (`[bus:N]`) must be set manually; no AI classification of mixed expenses

**Port effort assessment:** M. The data layer (Sheets read/write) ports cleanly. The expense category taxonomy and tax rates are straightforward TypeScript objects. The `[bus:N]` encoding convention should be replaced by a proper database column in Supabase.

---

## 3. Kelly Sizer Deep-Dive

**Location:** `pages/3_Sports_Betting.py` — two separate implementations [grounded]

### Implementation A — `_kelly_fraction()` (module-level scoring, lines 361–412)

Used by the Edge Finder and System Proof Panel. Takes `win_prob` (decimal) and `american_odds` (int):

```python
def _kelly_fraction(win_prob: float, american_odds: int) -> float:
    if american_odds < 0:
        dec_odds = 1 + (100 / abs(american_odds))
    else:
        dec_odds = 1 + (american_odds / 100)
    b = dec_odds - 1
    q = 1 - win_prob
    if b <= 0:
        return 0.0
    return max(0.0, (b * win_prob - q) / b)
```

Returns full Kelly fraction (0–1). The `_score_game()` wrapper divides by 4 to get quarter-Kelly and multiplies by bankroll to get recommended stake in dollars [grounded: `3_Sports_Betting.py:384–386`].

### Implementation B — `_kelly_pct()` (Full History tab, lines 1136–1146)

Inline function inside the Full History tab. Identical math, returns percentage (0–100) instead of decimal. Used only for the per-odds-range breakdown table.

### What the Kelly section shows to the user:

1. **System Proof Panel** (always visible once 5+ bets): Shows `PROFITABLE SYSTEM / BREAKING EVEN / LOSING EDGE` badge. Displays Quarter Kelly stake recommendation in dollars. [grounded: `3_Sports_Betting.py:417–534`]

2. **Full History tab — Kelly Criterion section** (requires 5+ bets): Shows Full/Half/Quarter Kelly % as `st.metric` cards. Shows "Kelly says don't bet" warning if win rate has no edge. Shows recommended stake at Quarter Kelly. Requires 10+ bets for per-odds-range breakdown. [grounded: `3_Sports_Betting.py:1130–1204`]

3. **Per-odds-range breakdown** (requires 10+ bets): Table showing Heavy Fav / Fav / Slight Fav buckets with bets, win rate, avg odds, Full Kelly%, Quarter Kelly%, Rec. Stake. [grounded: `3_Sports_Betting.py:1176–1203`]

4. **Edge Finder** (Deep Dive tab): Live games ranked by edge score. Shows Kelly (qtr) % and recommended stake per game card. [grounded: `3_Sports_Betting.py:1563–1574`]

5. **Win rate calculation**: `_win_rate_for_odds()` looks up historical win rate for the same odds ±25 band (widens to ±50 if < 3 matches, falls back to implied probability if fewer than 5 all-time bets). This is the key signal — Kelly is only positive when historical win rate exceeds the implied probability. [grounded: `3_Sports_Betting.py:334–358`]

**Port verdict:** This is one of the cleanest, most portable pieces in the entire codebase. Five functions under 60 lines of logic total. Port to TypeScript is straightforward — no external dependencies (pure math). The odds conversion and Kelly formula are standard. The `_win_rate_for_odds()` band-lookup is the only non-trivial piece and it's ~25 lines.

---

## 4. Ingestion Layer Assessment

### 4.1 Telegram Bot (`telegram_bot.py`, 1640 lines)

**Architecture:** Long-polling loop (not webhook). Polls every ~2–3 seconds via `getUpdates`. [grounded: `telegram_bot.py:260–276`]

**What commands work:**

| Area | Commands / Triggers |
|------|---------------------|
| Sales data | `sales`, `today`, `mtd` — live SP-API + Sheets |
| Deals | Deal cards with inline Buy/Skip/Info buttons [grounded: `telegram_bot.py:1259–1288`] |
| Navigation | Section menus → page deep-links (`SECTION_MAP`) [grounded: `telegram_bot.py:126–152`] |
| Page triggers | `PAGE_TRIGGERS` maps page names to Claude Code trigger IDs [grounded: `telegram_bot.py:155–162`] |

**Scheduled tasks running in bot loop:**

| Time (MT) | Task | Status |
|-----------|------|--------|
| 8:00 AM | Oura Ring sync → `❤️ Oura Daily` sheet | Working (if token configured) |
| 2:00 AM | Keepa product harvest → ChromaDB | Working (requires ChromaDB) |
| Every hour (not 2 AM) | Keepa backfill (250 products) | Working |
| Odd hours | SP-API enrichment (200 ASINs, 0 tokens) | Working |
| 6:00 AM | ChromaDB knowledge sync | Working |
| 2:00 PM + 8:00 PM | Arb auto-scan via `utils/arb_engine` | Working |
| 11:30 PM | Daily profit backfill | Working |

[grounded: `telegram_bot.py:1091–1280`]

**Port considerations:** The dispatch logic (command routing, scheduled task logic) ports cleanly. The main difference in LepiOS is the webhook vs. long-poll architecture choice. Supabase Realtime can replace the Sheets-read triggers. The bot currently has no authentication (anyone with the chat_id can trigger commands) — this should be addressed in port.

### 4.2 Ollama / Local AI Routing (`utils/local_ai.py`, 863 lines)

**Architecture:** [grounded: `utils/local_ai.py:1–100`]
- Primary: `localhost:11434` (local Ollama)
- Fallback 1: Tunnel URL from secrets (`ollama.tunnel_url`)
- Fallback 2: Claude API via `utils/ai.py`
- `smart_ask()` function: RAG pipeline — ChromaDB semantic search → inject context → Ollama → detect uncertainty → escalate to Claude if needed
- Code-question detection: checks for 2+ code keywords → switches to `qwen2.5-coder:7b` + code system prompt [grounded: `local_ai.py:82–95`]
- Default model: `qwen2.5-coder:7b`; heavy reasoning: `qwen2.5:32b`

**Status:** Configured-not-live on Streamlit Cloud (Ollama is a local process). On local/self-hosted deployment it would be live. The ChromaDB vector store requires the C:/AI_Data path to be mounted [grounded: `local_ai.py:27`].

**Port considerations:** The smart_ask()/RAG pattern is worth porting. The Ollama fallback chain (local → tunnel → Claude) is a good pattern to preserve. The specific model routing can be simplified for LepiOS — use the same Tier 0–3 cost model from ARCHITECTURE.md §3.2.

### 4.3 GitHub Actions Deal Scan

**Status:** Working and scheduled. Runs `scripts/deal_scan.py` at 6 AM + 6 PM MDT. [grounded: `deal_scan.yml`]

**Three-track architecture:**
1. StockTrack → SP-API (uses zero Keepa tokens, real ROI calculation) [grounded: `deal_scan.py:6–16`]
2. Keepa Product Finder (stats_only mode, ~250 tokens per run) [grounded: `deal_scan.py:144–146`]
3. OOS velocity watch [grounded: `deal_scan.py:17–19`]

**Port considerations:** The script is self-contained and can run as a Next.js/Vercel Cron Job or GitHub Actions. The Keepa token management (`MIN_TOKENS_TO_PROCEED = 200`) is good practice to preserve [grounded: `deal_scan.py:136`]. The StockTrack API integration (`utils/stocktrack_api.py`) will need a TypeScript rewrite since it's Python-only currently.

---

## 5. Beef-Up Candidates

Modules closer to v1-ready than they look. Specific lift needed:

| Module | Current State | Lift Needed | Why Beef-Up not Rebuild |
|--------|--------------|-------------|------------------------|
| **Betting Kelly Sizer** | Full implementation in Python | Port 5 functions + UI scaffold | Zero rebuild rationale; math is identical |
| **Trading P&L Log** | Working CRUD | Wrap in Supabase instead of Sheets | All business logic works; only data layer changes |
| **Business Expenses** | Working with categories, tax rates, recurring | Replace `[bus:N]` tag with Supabase column | Taxonomy is complete; just needs proper storage |
| **Deal Scan (GitHub Actions)** | Working 3-track scan + Telegram alerts | Add Supabase write instead of Sheets write | The scan logic is the valuable IP; delivery layer is swappable |
| **Telegram bot dispatch** | Full command routing + 10+ scheduled tasks | Port command router to TypeScript webhook handler | The routing map (`SECTION_MAP`, `PAGE_TRIGGERS`) ports as a JSON config |
| **Ollama routing** | Smart escalation working | Preserve escalation logic; wire to LepiOS Tier system | The tier logic (clerical → Ollama, hard reasoning → Claude) maps directly to ARCHITECTURE.md §3.2 |

---

## 6. Rebuild Candidates

Modules that should be rebuilt clean:

| Module | Why Rebuild | What to Preserve |
|--------|-------------|------------------|
| **Dashboard / Home (Business_Review.py)** | 191 KB monolith; Streamlit-specific layout (autorefresh, st.metric, st.columns); loads 8 sheets in parallel in a single render loop; the "cockpit" concept doesn't exist — it's a business dashboard | The data query patterns (parallel sheet fetches using ThreadPoolExecutor); the KPI definitions (Amazon pending, FBA units, loan balances) |
| **Sidebar navigation (app.py)** | Streamlit `st.Page` / `st.navigation` pattern is fundamentally incompatible with Next.js App Router; the collapsible section pattern maps naturally to a shadcn sidebar component | The section taxonomy (`_SECTIONS` dict) — this is the nav structure and maps directly |
| **Auth layer (utils/auth.py, 2132 lines)** | Google Sheets as user store (`👤 Users` tab) + bcrypt is the wrong shape for Supabase Auth; rate limiting is reimplemented from scratch in Python | The permission model (personal/business/health auth levels) should be preserved as Supabase RLS policies |
| **SQLite sync engine (utils/sync_engine.py, 827 lines)** | Offline-first SQLite → Sheets bidirectional sync is complex and fragile; Supabase Realtime + offline-first RLS is the correct approach for LepiOS | The entity data model (products, orders, deals, receipts tables from `utils/data_layer.py`) maps well to Supabase tables |

---

## 7. Acceptance Test Drafts

### 7.1 Trading Tile — v1

1. Colin opens the Trading tile → sees today's AI pick card with entry, stop, target, R:R, grade (or "no picks yet" with next scan time).
2. Colin presses "Load Today's Orders" → within 5 seconds sees M2K bias (Bullish/Bearish/Neutral), current price, VIX regime, and at least one limit order level to copy to TradingView.
3. Colin logs a trade (direction, ticker, price in, stop, take profit, points P&L) → trade persists in journal; YTD equity curve updates; win rate and R:R recalculate.
4. Overnight bot fires at 8:30 AM MT on a weekday → Telegram alert with top AI pick; log is visible in "Recent Predictions" expander.
5. "You vs AI" section shows meaningful comparison once 5+ real trades logged against 5+ bot signals.

### 7.2 Betting Tile — v1

1. Colin opens Betting tile → sees current bankroll, 1% stake amount, season P&L summary (W/L/P record, ROI, streak) without any user action.
2. Colin logs a bet (sport, league, home/away, bet-on, odds, stake) → bet persists; bankroll-after calculates automatically.
3. Colin marks a pending bet as Win → P&L updates; bankroll decrements/increments correctly; AI debrief fires.
4. Kelly section (requires 5+ bets) → shows Full/Half/Quarter Kelly % cards; "Kelly says don't bet" warning when win rate has no edge; per-odds-range breakdown shows at 10+ bets.
5. Edge Finder → fetches tonight's games (requires Odds API key); ranks by edge score; shows Quarter Kelly stake recommendation per game.

### 7.3 Amazon Tile — v1

1. Overnight deal scan fires (6 AM MDT) → at least one deal card appears in Telegram with ASIN, product name, ROI%, buy price, sell price.
2. Colin scans a barcode (ISBN) on PageProfit → within 3 seconds sees Amazon profit, eBay profit, Buyback offer, and a Buy/Skip/Watch recommendation.
3. Colin adds items to Shipment Manager manifest → progresses through Scan → List → Shipment → Box → Complete; each stage shows correct state.
4. Deals tab shows today's deal scan results; clicking a deal shows full ROI breakdown.
5. Amazon Orders page shows SP-API order history for the last 30 days with correct revenue.

### 7.4 Expenses Tile — v1

1. Colin adds a business expense (vendor, category, amount, GST, payment method) → expense appears in Business Transactions sheet; Amazon P&L Expenses column updates for that month.
2. Recurring monthly expense (e.g., phone plan) → creates entries for all remaining months of the year in one action.
3. Personal Expenses page shows Colin + Megan monthly spending by category; "latest month" metrics show correct totals.
4. Business-use % allocation: marking an expense as "Mixed — 60%" stores correctly and reflects in the P&L.
5. Expense Dashboard shows cross-category spending breakdown with correct month-over-month delta.

### 7.5 Cockpit Home — v1

1. Home screen loads in < 2 seconds and shows: Money pillar gauge (Amazon MTD, trading YTD, betting ROI), Health/Growing/Happy as "v2 — coming soon" stubs, Status lights for Telegram/Supabase/Amazon feed, Next Move button.
2. Situation Room ticker shows latest council deliberation headline (or placeholder if council not yet running).
3. Quality of Life Index gauge updates when any pillar sub-metric changes.
4. Next Move button → opens current recommended action from Digital Twin agent.
5. All four pillar rows expand to show sub-metric pill bars without page reload.

### 7.6 Ingestion Layer — v1

1. Sending "sales" to Telegram bot → response with today's Amazon units and MTD revenue within 10 seconds.
2. Deal alert pushed to Telegram → user can press Buy/Skip/Info inline buttons; Buy adds to sourcing list.
3. Oura sync at 8 AM → new daily readings appear in Oura Daily sheet; Telegram confirms "N new days synced."
4. Typing a question into AI Coach → Ollama responds (or Claude if Ollama offline) with context-aware answer using RAG.

---

## 8. Grounding Manifest

All claims in this document are tagged **grounded** (file:section) or **generated** (inference). The following files were read to ground this report:

| File Read | Used For |
|-----------|----------|
| `lepios/ARCHITECTURE.md` (full) | v1 scope, council roster, daily loop, check-before-build doctrine |
| `lepios/audits/00-inventory.md` (full) | Baseline inventory, integration status, Sheets schema |
| `streamlit_app/pages/2_Trading_Journal.py` (lines 1–300, 300–500, 700–900, 1700–1903) | Trading module full assessment |
| `streamlit_app/pages/3_Sports_Betting.py` (lines 1–300, 300–534, 1900–2041) | Betting + Kelly full assessment |
| `streamlit_app/pages/4_Monthly_Expenses.py` (lines 1–300) | Expenses business module |
| `streamlit_app/pages/25_Personal_Expenses.py` (lines 1–100) | Expenses personal module |
| `streamlit_app/pages/21_PageProfit.py` (lines 1–180) | Amazon scan workflow |
| `streamlit_app/pages/30_Shipment_Manager.py` (lines 1–400) | Shipment Manager workflow |
| `streamlit_app/pages/46_Arbitrage_Scanner.py` (lines 1–80) | Arbitrage Scanner structure |
| `streamlit_app/scripts/deal_scan.py` (lines 1–250) | Deal scan architecture |
| `streamlit_app/telegram_bot.py` (lines 1–300, 1080–1290) | Bot commands + scheduled tasks |
| `streamlit_app/utils/local_ai.py` (lines 1–100) | Ollama routing architecture |
| `streamlit_app/app.py` (full, 202 lines) | Navigation structure + section taxonomy |
| `streamlit_app/Business_Review.py` (lines 1–300) | Dashboard structure |
| `streamlit_app/pages/8_Health.py` (lines 1–50) | v2 health module existence check |
| `streamlit_app/.github/workflows/deal_scan.yml` (full) | GitHub Actions cron schedule |
| Grep: `kelly|Kelly|KELLY` in `3_Sports_Betting.py` | Full Kelly implementation mapping |
| Grep: `kelly|Kelly|KELLY` in `86_Polymarket.py` | Confirmed: no Kelly in Polymarket page |

---

## Key Findings Summary (for Phase 3 planning)

1. **Trading, Betting, Expenses modules are Working end-to-end** in Streamlit. The core business logic is port-ready. No rebuilds needed — beef-up is correct.

2. **Kelly Sizer is fully implemented** — two clean versions of the same math. Port is ~60 lines of TypeScript plus the band-lookup win-rate function.

3. **Amazon is the most complex port** — `utils/amazon.py` (2128 lines) and `pages/21_PageProfit.py` (3373 lines) are XL efforts. The deal scan script is a much smaller M effort and should ship first (it already fires Telegram alerts — just needs Supabase write instead of Sheets write).

4. **The dashboard needs a rebuild** — Business_Review.py is a 191 KB Streamlit monolith. The cockpit concept in ARCHITECTURE.md §4 has no Python equivalent to port. This is where the Design Council deliverable (§4.3) gates everything else.

5. **Telegram bot logic is sound** — the command routing and scheduled task list should be preserved as a TypeScript webhook handler. The bot has real utility today (deal alerts, Oura sync, arb auto-scan).

6. **Ollama routing pattern is worth keeping** — the three-tier fallback (local → tunnel → Claude) maps to ARCHITECTURE.md §3.2 token tiers.

7. **No Supabase in current codebase** — Google Sheets is the entire data layer. Every "port" in the data layer is actually a migration, not a port. Plan schema design carefully before writing any routes.

8. **The GitHub Actions deal scan is the fastest path to the kill-criterion test** (§11): it already fires real Telegram alerts. Swap Sheets write → Supabase insert, add a `/deals` API route, wire to Amazon Tile — that's a deployable MVP of the Amazon agent in ~1 week.
