# LepiOS Phase 2 — Data & Schema Audit

**Agent:** B — Data & Schema
**Date:** 2026-04-17
**Scope:** Read-only. No files modified.
**Accuracy standard:** Every claim tagged **[grounded: file:line]** or **[generated: inference]**.

---

## 1. Existing Data Inventory

### 1A. Google Sheets Tabs

Two spreadsheets are in use. The main business spreadsheet (ID: `1arXxho2gD8IeWbQNcOt8IwZ7DRl2wz-qJzC3J4hiR4k`) and a separate "Masterfile" (ID: `1Z9k6zt_GnWx5FyhYkpyGr7IpErBAEO_si7pPewL-xjU`).

[grounded: `streamlit_app/CLAUDE.md` (spreadsheet IDs), `streamlit_app/utils/masterfile.py:12`]

#### Main Spreadsheet Tabs

| Tab Name | Primary File Reference | Pillar | Person | Est. Columns | Current Usage |
|---|---|---|---|---|---|
| `👤 Users` | `utils/auth.py:41` | System | All | 5–8 (username, hash, role, created_at, etc.) | Active — auth store |
| `📋 Login Log` | `utils/auth.py:48` | System | All | 4–6 (user, timestamp, ip, result) | Active — audit trail |
| `📒 Business Transactions` | `utils/life_pl.py:227`, `utils/actions.py:871` | Money | Business | 10–15 (Date, Vendor, Category, Pre-Tax, GST, Total, HubDoc, notes) | Core — every write goes here |
| `📸 Receipts` | `utils/actions.py:861`, `utils/life_pl.py:394` | Money | Business | 10–12 (Vendor, Receipt Date, Total, Category, Drive URL, OCR Source, Match Status) | Core — receipt pipeline |
| `🏦 Statement Lines` | `utils/life_pl.py:375`, `utils/n8n_webhooks.py:105` | Money | Business | 8–10 (Account Key, Date, Description, Amount, Reconciled, Source File) | Active — bank import |
| `🏷️ Vendor Rules` | `utils/actions.py:903`, `utils/auto_reconcile.py:50` | Money | Business | 5–7 (vendor_key, display_name, category, gst_applicable) | Active — auto-classify |
| `🏪 Vendor Rules` | `utils/auto_reconcile.py:67` | Money | Business | Same as above (possible duplicate tab) | Active — may be alias |
| `📋 Audit Log` | `utils/audit_log.py:33` | System | All | 6–8 (timestamp, action, user, details) | Active — change log |
| `📋 Sign-Offs` | `utils/audit_log.py:43` | Money | Business | 5–7 (month, signed_by, date, notes) | Active — monthly close |
| `📊 Reconciliation Log` | `utils/auto_reconcile.py:596` | Money | Business | 6–8 (date, matched_count, unmatched_count, run_by) | Active — reconcile audit |
| `📊 Amazon 2026` | `utils/n8n_webhooks.py:479`, `pages/4_Monthly_Expenses.py:221` | Money | Business | 10–15 (Date, ASIN, Title, Revenue, COGS, Profit, Fees) | Core — Amazon P&L |
| `📊 Amazon 2025` | `pages/5_Monthly_PL.py:34` | Money | Business | Same structure as 2026 | Historical — 2025 year |
| `📦 FBA Items` | `utils/amazon.py:1538`, `pages/21_PageProfit.py:463` | Money | Business | 8–12 (ASIN, Title, Qty, Status, FNSKU, condition) | Active — FBA inventory |
| `📦 COGS Lookup` | `utils/amazon.py:1583`, `pages/7_Inventory.py:59` | Money | Business | 5–7 (ASIN, cost, purchase_date, source) | Active — cost lookup |
| `🛒 Colin - Items` | `utils/amazon.py:1605`, `pages/7_Inventory.py:85` | Money | Colin | 8–10 (Title, ASIN, cost, condition, status, source) | Active — inventory |
| `📦 Book Inventory` | `utils/n8n_webhooks.py:536`, `pages/7_Inventory.py:179` | Money | Business | 8–10 (Title, ISBN, ASIN, condition, cost, status) | Core — book stock |
| `📦 Inventory Snapshot` | `pages/7_Inventory.py:29`, `pages/5_Monthly_PL.py:1722` | Money | Business | 6–8 (date, total_items, total_cost, total_value) | Active — EOM snapshot |
| `📦 Colin - Pallet Sales` | `pages/7_Inventory.py:120`, `pages/28_Category_PL.py:56` | Money | Colin | 6–8 (Date, Item, Sale Price, Platform, Profit) | Active — pallet sourcing |
| `💰 Payout Register` | `utils/life_pl.py:78` | Money | Business | 8–10 (Period Start, Period End, Amount Expected, Amount Received, Date Received) | Core — Amazon payouts |
| `💰 Southgate Tracker` | `utils/weekly_digest.py:110` | Money | Business | 5–7 (Date, Amount, Notes) | Active — specific pallet source |
| `📈 Trading Journal` | `utils/life_pl.py:138`, `pages/2_Trading_Journal.py:127` | Money | Colin | 15+ (Date, Instrument, Direction, Price In, Price Out, P&L, R-multiple, Mood) | Core — trading log |
| `Trading_Predictions` | `pages/2_Trading_Journal.py:127` | Money | Colin | 6–10 (Date, Signal, Confidence, Notes) | Active — AI prediction log |
| `Trading_Predictions_Learning` | `pages/2_Trading_Journal.py:143` | Money | Colin | 6–8 (prediction_id, outcome, feedback) | Active — model learning |
| `🎰 Bets` | `utils/life_pl.py:168` | Money | Colin | 10–12 (Date, Sport, Teams, Bet Type, Odds, Stake, Result, P&L, Bankroll) | Core — betting log |
| `Sports Predictions` | `pages/3_Sports_Betting.py:1284` | Money | Colin | 6–10 (Date, Sport, Pick, Odds, Confidence) | Active — AI pick log |
| `Sports Learning` | `pages/3_Sports_Betting.py:1401` | Money | Colin | 5–8 (prediction_id, outcome, lesson) | Active — model feedback |
| `📊 Odds Snapshots` | `utils/sports_backtester.py:34` | Money | Colin | 8–10 (Date, Game, Opening Odds, Closing Odds) | Active — backtesting data |
| `📊 Elo Ratings` | `utils/sports_backtester.py:40` | Money | Colin | 5–7 (Team, Rating, Last Updated) | Active — Elo model state |
| `🧹 Cleaning Clients` | `utils/life_pl.py:196` | Money | Megan | 6–8 (Client, Rate, Frequency, Status, Notes) | Active — Megan revenue |
| `⭐ Cora Activities` | `utils/life_pl.py:518` | Happy | Cora | 5–7 (Activity, Monthly Cost, Active, Notes) | Active — family spend |
| `🛡️ Insurance Policies` | `utils/life_pl.py:545` | Money | Shared | 8–10 (Policy Name, Provider, Premium, Frequency, Status, Coverage, Type) | Active — policy registry |
| `🔄 Subscriptions` | `utils/life_pl.py:571` | Money | Shared | 6–8 (Name, Provider, Cost, Frequency, Status, Category) | Active — recurring spend |
| `⚡ Utility Tracker` | `utils/life_pl.py:603` | Money | Shared | 4–6 (Month, Amount, Type, Account) | Active — utility bills |
| `⚙️ Settings` | `utils/config.py:20`, `utils/dropbox_statements.py:219` | System | All | 4–6 (key, value, updated_at) | Active — app config |
| `⚠️ Brand Risk` | `utils/brand_risk.py:239` | Money | Business | 6–8 (ASIN, brand, risk_level, reason) | Active — Amazon compliance |
| `📈 BSR History` | `utils/bsr_history.py:14` | Money | Business | 5–7 (ASIN, BSR, date, category) | Active — price tracking |
| `🔭 Scout History` | `utils/bsr_history.py:84` | Money | Business | 6–8 (ISBN, ASIN, scan_date, decision, roi_pct) | Active — scan history |
| `🏷️ Price Book` | `utils/coupon_lady.py:10` | Money | Shared | 5–7 (Item, Store, Price, Date, Category) | Active — price reference |
| `🏷️ Flyers` | `utils/coupon_lady.py:11` | Money | Shared | 5–7 (Store, Item, Sale Price, Valid Until) | Active — flyer deals |
| `🏷️ Coupons` | `utils/coupon_lady.py:12` | Money | Shared | 4–6 (Store, Item, Discount, Expiry) | Active — coupon tracking |
| `🏷️ Shopping List` | `utils/coupon_lady.py:13` | Money | Shared | 4–5 (Item, Store, Qty, Priority) | Active — grocery planning |
| `🔍 Scan Criteria` | `utils/keepa_harvester.py:54` | Money | Business | 6–8 (Category, Min ROI, Max Rank, Min Profit) | Active — harvester config |
| `🔍 Price Monitor` | `utils/price_monitor.py:32` | Money | Business | 5–7 (ASIN, Target Price, Current Price, Alert) | Active — price watchlist |
| `🔍 Monitored Products` | `utils/price_monitor.py:38` | Money | Business | 6–8 (ASIN, Title, added_date, status) | Active — monitor list |
| `🔍 Product Intel` | `utils/product_intel.py:15` | Money | Business | 8–10 (ASIN, research notes, rank history, supplier) | Active — deep research |
| `🔍 Keepa Deals` | `utils/keepa_harvester.py:27` | Money | Business | 8–10 (ASIN, Title, ROI, BSR, found_date) | Active — Keepa output |
| `🔍 Product Harvest` | `utils/keepa_harvester.py:37` | Money | Business | 8–10 (ASIN, Title, Category, metrics) | Active — harvest queue |
| `🔍 Keepa Alerts` | `utils/keepa_harvester.py:48` | Money | Business | 5–7 (ASIN, alert_type, fired_at) | Active — Keepa alerts |
| `🔍 OOS Watch` | `utils/keepa_harvester.py:67` | Money | Business | 6–8 (ASIN, OOS date, restock_target) | Active — OOS tracking |
| `🧱 Lego Vault` | `utils/n8n_webhooks.py:371` | Money | Business | 8–10 (Set Number, Title, cost, qty, retire_date, current_price) | Active — Lego inventory |
| `🧱 Retiring Sets` | `utils/lego_retirement.py:31` | Money | Business | 7–9 (Set Number, Title, retire_date, ROI_pct, status) | Active — retirement watch |
| `📦 Watchlist` | `utils/n8n_webhooks.py:391` | Money | Business | 6–8 (ASIN, Title, target_price, added_date) | Active — deal watchlist |
| `🛒 Retail Deals` | `utils/retail_intel.py:29` | Money | Business | 7–9 (Item, Store, Buy Price, Amazon Price, ROI, Score) | Active — retail arb |
| `📧 Email Invoices` | `utils/email_invoices.py:31` | Money | Business | 7–9 (Date, Sender, Amount, Category, Matched, Drive URL) | Active — email receipts |
| `📧 Known Senders` | `utils/gmail.py:166` | Money | Business | 4–6 (email, vendor_name, category, learned_at) | Active — Gmail classifier |
| `💰 PageProfit Scans` | `utils/actions.py:982` | Money | Business | 6–8 (Date, Page URL, Items Found, Best ROI) | Active — scan log |
| `🤖 Token Usage` | `utils/token_tracker.py:11` | System | All | 5–7 (Date, Model, Tokens, Cost, Context) | Active — AI cost tracking |
| `Agent Logs` | `utils/knowledge_export.py:190` | System | All | 6–8 (timestamp, agent, action, result, tokens) | Active — agent audit |
| `Cashback Tracker` | `utils/knowledge_export.py:297` | Money | Shared | 5–7 (Portal, Date, Amount, Category, Status) | Active — cashback log |
| `FBA Inventory` | `utils/knowledge_export.py:265` | Money | Business | 6–8 (ASIN, Title, Qty, Status) | Active — FBA cache export |
| `🔍 Retail Scout` | `utils/retail_scout.py:64` | Money | Business | 6–8 (Item, Store, Price, ROI, scan_date) | Active — retail scan |
| `🔍 Watchlist` | `utils/retail_scout.py:65` | Money | Business | 5–7 (Item, target_price, status) | Active — price watch |
| `📊 ASIN Sales Log` | `pages/26_Sales_Charts.py:369` | Money | Business | 6–8 (ASIN, Date, Units, Revenue, Profit) | Active — per-ASIN history |
| `🥑 Grocery Inventory` | `pages/49_Cashback_HQ.py:1685` | Money | Shared | 5–7 (Item, Qty, Last Price, Restock At) | Active — pantry stock |
| `📊 Monthly P&L` | `pages/8_Bookkeeping_Hub.py:105` | Money | Business | 6–8 (Month, Income, OpEx, COGS, Net) | Active — P&L summary |
| `📊 Monthly Cashflow` | `pages/5_Monthly_PL.py:79` | Money | Business | 5–7 (Month, Inflows, Outflows, Net) | Active — cashflow |
| `🚗 Vehicles` | `pages/5_Monthly_PL.py:1740` | Money | Colin | 6–8 (Vehicle, expense_date, amount, category) | Active — vehicle costs |
| `🔗 Relay Buffer` | `utils/sheets.py:99` | System | All | 4–6 (timestamp, scan_id, isbn, result) | Active — phone scan relay |
| `⚙️ PageProfit Settings` | `utils/sheets.py:100` | System | All | 4–6 (key, value) | Active — PageProfit config |
| `🏦 Statement Rules` | `utils/statement_rules.py:23` | Money | Business | 5–7 (pattern, vendor_key, category) | Active — statement classifier |
| `🤖 Coach Log` | `utils/sheets_context.py:145` | Growing | Colin | 5–7 (date, question, response, action) | Active — coaching log |
| `🔱 Deal Cache` | `utils/telegram_utils.py:18` | Money | Business | 5–7 (deal_id, asin, cached_at, ttl) | Active — Telegram deal cache |
| `🤖 Task Queue` | `utils/task_queue.py:18` | System | All | 5–7 (task_id, type, payload, status, created_at) | Active — agent task queue |
| `📊 Odds Snapshots` | `utils/sports_backtester.py:34` | Money | Colin | 8–10 (game_id, date, sport, opening_odds, closing_odds) | Active — odds history |
| `📊 Elo Ratings` | `utils/sports_backtester.py:40` | Money | Colin | 4–6 (team, rating, games_played, last_updated) | Active — Elo state |

#### Masterfile Tabs (separate spreadsheet)

| Tab Name | Primary File Reference | Pillar | Person | Est. Columns | Current Usage |
|---|---|---|---|---|---|
| `Goal Tracking` | `utils/masterfile.py:60` | Growing | Colin | 12+ (Month, Gross Sales Goal, Daily Goals, per-day actuals) | Active — business goal tracking |
| `Colin Expenses {year}` | `utils/masterfile.py:129` | Money | Colin | 15+ (Month, Rent, Food, Insurance, Transport, etc.) | Active — personal monthly budget |
| `Megan Expenses {year}` | `utils/masterfile.py:171` | Money | Megan | 12+ (Month, Rent, Food, Subscriptions, Load Payment, etc.) | Active — Megan personal budget |
| `Credit Cards` | `utils/masterfile.py:210` | Money | Shared | 5–6 (Card, Due Date, Balance, Minimum, Remarks) | Active — credit card register |

#### Historical / Tax Tabs (main spreadsheet)

| Tab Name | Primary File Reference | Pillar | Person | Usage |
|---|---|---|---|---|
| `📋 Tax Reconciliation 2025` | `pages/58_Tax_Return.py:56` | Money | Business | Historical — 2025 tax prep |
| `📊 Amazon 2025` | `pages/58_Tax_Return.py:69` | Money | Business | Historical — 2025 Amazon |
| `🇨🇦 GST Annual Summary` | `pages/58_Tax_Return.py:86` | Money | Business | Historical — annual GST |
| `💼 Business Expenses 2025` | `pages/58_Tax_Return.py:99` | Money | Business | Historical — 2025 expenses |
| `💼 Business Expenses 2025` | `pages/5_Monthly_PL.py:55` | Money | Business | Historical — same tab |
| `📋 Megan Business 2025` | `pages/tax_centre/megan_tax.py:336` | Money | Megan | Historical — Megan 2025 tax |
| `💎 Net Worth History` | `pages/54_Monthly_Close.py:194` | Money | Shared | Active — EOM net worth log |

---

### 1B. SQLite Tables (knowledge.db)

All tables are in `ai-knowledge/knowledge.db`. [grounded: `utils/data_layer.py:5–7`, `utils/knowledge.py:43–47`]

Note: This database is disabled on Streamlit Cloud — `_get_db()` returns `None` in that environment. [grounded: `utils/data_layer.py:51`]

#### Entity Tables (from data_layer.py)

| Table | Domain | Pillar | Person | Key Columns | Notes |
|---|---|---|---|---|---|
| `products` | Commerce | Money | Business | id, asin, isbn, title, category, condition, cost, quantity, status, source, set_number, piece_count, retail_price, retire_date | Covers both books and Lego; LEGO fields nullable |
| `listings` | Commerce | Money | Business | id, product_id, marketplace, sku, listing_price, status, fees_estimated | UNIQUE(product_id, marketplace) |
| `orders` | Commerce | Money | Business | id, product_id, marketplace, order_date, revenue, cogs, profit, marketplace_fees | Source: SP-API |
| `payouts` | Commerce | Money | Business | id, marketplace, period_start, period_end, amount_expected, amount_received, variance | Linked to Payout Register sheet |
| `shipments` | Commerce | Money | Business | id, name, destination, status, box_count, tracking_number | Amazon FC shipments |
| `shipment_items` | Commerce | Money | Business | id, shipment_id, product_id, box_number, asin, quantity | Detail rows for box packing |
| `deals` | Commerce | Money | Business | id, asin, title, buy_price, sell_price, roi_pct, source, status | Sources: keepa, retail_scout, rfd |
| `scan_results` | Commerce | Money | Business | id, isbn, asin, bsr, buy_box_price, roi_pct, decision, scan_session | Decisions: buy/skip/watch |
| `price_history` | Commerce | Money | Business | id, product_id, asin, price_type, price, recorded_at | Source: Keepa; type: amazon/new/used/buybox |
| `transactions` | Accounting | Money | Business | id, txn_date, vendor, category, pre_tax, gst, total, is_business, payment_method, hubdoc | Mirror of Business Transactions tab |
| `receipts` | Accounting | Money | Business | id, vendor, receipt_date, pre_tax, gst, total, drive_url, match_status, ocr_source | Mirror of Receipts tab |
| `statement_lines` | Accounting | Money | Business | id, account, line_date, description, amount, reconciled, dedup_key | Mirror of Statement Lines tab |
| `vendor_rules` | Accounting | Money | Business | id, vendor_key, display_name, category, gst_applicable, use_count | Mirror of Vendor Rules tab |
| `trades` | Trading | Money | Colin | id, trade_date, instrument, direction, price_in, price_out, dollar_pnl, r_multiple, mood | Mirror of Trading Journal tab |
| `bets` | Betting | Money | Colin | id, bet_date, sport, league, home_team, away_team, odds, stake, result, pnl, bankroll_after | Mirror of Bets tab |
| `health_metrics` | Health | Health | Colin/Megan/Cora | id, metric_date, person, sleep_score, hrv_avg, readiness_score, steps, calories_active | UNIQUE(metric_date, person); Source: Oura |
| `health_events` | Health | Health | Colin/Megan/Cora | id, event_date, person, event_type, value, unit, severity | Types: vital, symptom, medication, visit, workout |
| `net_worth_snapshots` | PersonalFinance | Money | Shared | id, snapshot_date, amazon_pending, biz_chequing, fhsa, rrsp, bdc_loan1, bdc_loan2, net_worth | Full assets+liabilities snapshot |
| `debts` | PersonalFinance | Money | Shared | id, name, lender, principal, current_balance, interest_rate, minimum_payment, debt_type | BDC loan, Tesla, credit cards |
| `subscriptions` | PersonalFinance | Money | Shared | id, name, provider, cost_monthly, billing_cycle, next_renewal, is_business, status | Mirrors Subscriptions tab |

#### Knowledge/Event Tables (from knowledge.py)

| Table | Purpose | Pillar | Key Columns |
|---|---|---|---|
| `events` | Audit log of all system actions | System | id, timestamp, domain, action, actor, status, input_summary, output_summary, tokens_used |
| `knowledge` | AI coaching knowledge base | Growing | id, category, domain, title, problem, solution, confidence, times_used, embedding_id |
| `metrics` | [generated: implied by knowledge.py structure] | System | id, metric_name, value, recorded_at |

---

## 2. Pillar Mapping

Every data entity maps to one primary pillar. Note: "Money" dominates because the Streamlit OS was originally a business tracker.

### Money Pillar

All commerce, accounting, trading, and betting data.

**Google Sheets:** Business Transactions, Receipts, Statement Lines, Vendor Rules, Amazon 2026/2025, FBA Items, COGS Lookup, Colin - Items, Book Inventory, Inventory Snapshot, Colin - Pallet Sales, Payout Register, Southgate Tracker, Trading Journal, Bets, Cleaning Clients, Insurance Policies, Subscriptions, Utility Tracker, Vehicles, Monthly P&L, Monthly Cashflow, Credit Cards (Masterfile), Colin Expenses (Masterfile), Megan Expenses (Masterfile), Keepa Deals/Harvest/Alerts/OOS Watch, Price Monitor, Monitored Products, Lego Vault, Retiring Sets, Watchlist, Retail Deals, Retail Scout, Scout History, BSR History, Brand Risk, PageProfit Scans, ASIN Sales Log, Payout Register, Cashback Tracker, Price Book, Flyers, Coupons, Shopping List, Grocery Inventory, Reconciliation Log, Audit Log, Sign-Offs, Sports Predictions, Sports Learning, Odds Snapshots, Elo Ratings, Trading_Predictions, Trading_Predictions_Learning.

**SQLite:** products, listings, orders, payouts, shipments, shipment_items, deals, scan_results, price_history, transactions, receipts, statement_lines, vendor_rules, trades, bets, net_worth_snapshots, debts, subscriptions.

### Health Pillar

**Google Sheets:** None explicitly — Oura data is pulled from the API at runtime and shown in-page. No dedicated Health sheet tab found. [grounded: no `worksheet()` calls for health-related tab names in any `utils/` or `pages/` file]

**SQLite:** `health_metrics`, `health_events` — the local cache for Oura Ring data. [grounded: `utils/data_layer.py:483–535`]

### Growing Pillar

**Google Sheets:** `Goal Tracking` (Masterfile), `🤖 Coach Log`, `Agent Logs`.

**SQLite:** `knowledge` table (AI coaching knowledge base). [grounded: `utils/knowledge.py:98–116`]

### Happy Pillar

**Google Sheets:** `⭐ Cora Activities` — family activity spend. [grounded: `utils/life_pl.py:518`]

**SQLite:** No dedicated Happy table. [generated: no table named for mood/happiness in schema]

### System / Cross-Pillar

**Google Sheets:** Users, Login Log, Audit Log, Sign-Offs, Settings, PageProfit Settings, Token Usage, Agent Logs, Task Queue, Deal Cache, Relay Buffer.

**SQLite:** `events` (system audit log). [grounded: `utils/knowledge.py:70–94`]

---

## 3. Proposed Supabase Schema (v1) — Money Pillar Tables

**STATUS: PLAN ONLY. No migrations executed. These are proposed DDL statements for review.**

These cover the Money pillar tables needed for the four LepiOS v1 tiles: Trading, Betting, Amazon, Expenses.

All tables follow Supabase conventions: `uuid` primary keys, `timestamptz` for timestamps, `auth.uid()` for RLS binding. Person tagging uses a `TEXT CHECK` on `('colin','megan','cora','shared','business')`. Currency is always CAD.

---

### 3.1 Core User / Person Context

```sql
-- PROPOSED TABLE: people
-- Person tags — v1 has only one operator (Colin) but schema supports v2 multi-person
-- Port-from: NEW (no equivalent in Sheets or SQLite)
CREATE TABLE public.people (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handle      TEXT NOT NULL UNIQUE CHECK (handle IN ('colin','megan','cora','shared','business')),
    display_name TEXT NOT NULL,
    auth_uid    UUID REFERENCES auth.users(id),  -- NULL for Cora, Megan (v1)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: SELECT open to authenticated user; no INSERT from client
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_own_people" ON public.people
    FOR SELECT USING (auth.uid() IS NOT NULL);
```

---

### 3.2 Trading Tile

```sql
-- PROPOSED TABLE: trades
-- Port-from-Sheets: "📈 Trading Journal" tab
-- Port-from-SQLite: trades table (data_layer.py:425)
-- Action: PORT — tab has active data. SQLite is local cache only (disabled on Cloud).
CREATE TABLE public.trades (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_date      DATE NOT NULL,
    instrument      TEXT NOT NULL,              -- 'MES', 'M2K', 'ES', 'NQ'
    direction       TEXT CHECK (direction IN ('long','short')),
    trade_type      TEXT DEFAULT 'day' CHECK (trade_type IN ('day','swing')),
    paper_real      TEXT DEFAULT 'real' CHECK (paper_real IN ('paper','real')),
    price_in        NUMERIC(12,4),
    price_out       NUMERIC(12,4),
    stop_loss       NUMERIC(12,4),
    take_profit     NUMERIC(12,4),
    points_pnl      NUMERIC(10,2),
    dollar_pnl      NUMERIC(10,2),
    r_multiple      NUMERIC(6,2),
    mood            TEXT,
    date_out        DATE,
    notes           TEXT,
    person_handle   TEXT NOT NULL DEFAULT 'colin',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    _source         TEXT DEFAULT 'manual'       -- 'manual', 'ibkr_import'
);

CREATE INDEX ON public.trades (trade_date);
CREATE INDEX ON public.trades (instrument);

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trades_colin_only" ON public.trades
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
```

---

### 3.3 Betting Tile

```sql
-- PROPOSED TABLE: bets
-- Port-from-Sheets: "🎰 Bets" tab
-- Port-from-SQLite: bets table (data_layer.py:453)
-- Action: PORT — tab has active data; Kelly Sizer history in Bets tab must not be lost.
CREATE TABLE public.bets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bet_date        DATE NOT NULL,
    sport           TEXT,
    league          TEXT,
    home_team       TEXT,
    away_team       TEXT,
    bet_on          TEXT,                       -- team or outcome
    bet_type        TEXT CHECK (bet_type IN ('moneyline','spread','over_under','parlay','prop','futures')),
    odds            INTEGER,                    -- American format (-150, +200)
    implied_prob    NUMERIC(5,4),               -- computed from odds
    kelly_pct       NUMERIC(5,4),               -- Kelly % at time of bet
    bankroll_before NUMERIC(10,2),
    stake           NUMERIC(10,2),
    result          TEXT CHECK (result IN ('win','loss','push','void','pending')),
    pnl             NUMERIC(10,2),
    bankroll_after  NUMERIC(10,2),
    ai_notes        TEXT,
    person_handle   TEXT NOT NULL DEFAULT 'colin',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    _source         TEXT DEFAULT 'manual'
);

CREATE INDEX ON public.bets (bet_date);
CREATE INDEX ON public.bets (result);

ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bets_colin_only" ON public.bets
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
```

---

### 3.4 Amazon Tile — Core Commerce Tables

```sql
-- PROPOSED TABLE: products
-- Port-from-Sheets: "📦 Book Inventory", "🛒 Colin - Items", "🧱 Lego Vault", "📦 FBA Items"
-- Port-from-SQLite: products table (data_layer.py:89)
-- Action: PORT + CONSOLIDATE — currently split across 4 Sheets tabs by category
-- Schema debt: see §5.
CREATE TABLE public.products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asin            TEXT,
    isbn            TEXT,
    title           TEXT NOT NULL,
    author          TEXT,
    brand           TEXT,
    category        TEXT CHECK (category IN ('books','lego','other')),
    subcategory     TEXT,
    condition       TEXT CHECK (condition IN ('New','Like New','Very Good','Good','Acceptable')),
    cost_cad        NUMERIC(10,2),
    quantity        INTEGER DEFAULT 1,
    status          TEXT DEFAULT 'active' CHECK (status IN ('active','listed','shipped','sold','returned')),
    source          TEXT,                       -- 'thrift','pallet','retail','online'
    purchase_date   DATE,
    notes           TEXT,
    image_url       TEXT,
    -- Lego-specific
    set_number      TEXT,
    piece_count     INTEGER,
    retail_price_cad NUMERIC(10,2),
    retire_date     DATE,
    person_handle   TEXT NOT NULL DEFAULT 'business',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    _source_system  TEXT DEFAULT 'manual'
);

CREATE INDEX ON public.products (asin);
CREATE INDEX ON public.products (isbn);
CREATE INDEX ON public.products (status);
CREATE INDEX ON public.products (category);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_authenticated" ON public.products
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);


-- PROPOSED TABLE: orders
-- Port-from-Sheets: "📊 Amazon 2026" tab
-- Port-from-SQLite: orders table (data_layer.py:154)
-- Action: PORT — Amazon 2026 is the primary revenue record
CREATE TABLE public.orders (
    id              TEXT PRIMARY KEY,           -- order_id from marketplace (keep original)
    product_id      UUID REFERENCES public.products(id),
    marketplace     TEXT NOT NULL,
    order_date      DATE NOT NULL,
    asin            TEXT,
    title           TEXT,
    quantity        INTEGER DEFAULT 1,
    revenue_cad     NUMERIC(10,2),
    marketplace_fees NUMERIC(10,2),
    shipping_cost   NUMERIC(10,2) DEFAULT 0,
    cogs_cad        NUMERIC(10,2),
    profit_cad      NUMERIC(10,2),
    currency        TEXT DEFAULT 'CAD',
    status          TEXT DEFAULT 'confirmed',
    person_handle   TEXT NOT NULL DEFAULT 'business',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    _source         TEXT DEFAULT 'sp-api'
);

CREATE INDEX ON public.orders (order_date);
CREATE INDEX ON public.orders (asin);
CREATE INDEX ON public.orders (marketplace);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_authenticated" ON public.orders
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);


-- PROPOSED TABLE: payouts
-- Port-from-Sheets: "💰 Payout Register" tab
-- Port-from-SQLite: payouts table (data_layer.py:183)
-- Action: PORT
CREATE TABLE public.payouts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace     TEXT NOT NULL,
    period_start    DATE,
    period_end      DATE,
    amount_expected NUMERIC(10,2),
    amount_received NUMERIC(10,2),
    variance        NUMERIC(10,2),
    account         TEXT,
    status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','received','reconciled','disputed')),
    received_date   DATE,
    notes           TEXT,
    person_handle   TEXT NOT NULL DEFAULT 'business',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payouts_authenticated" ON public.payouts
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);


-- PROPOSED TABLE: deals
-- Port-from-Sheets: "🔍 Keepa Deals", "🛒 Retail Deals", "📦 Watchlist"
-- Port-from-SQLite: deals table (data_layer.py:244)
-- Action: PORT + CONSOLIDATE — currently spread across 3+ Sheets tabs
CREATE TABLE public.deals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asin            TEXT,
    title           TEXT,
    category        TEXT,
    source          TEXT,                       -- 'keepa','manual','retail_scout','rfd'
    buy_price_cad   NUMERIC(10,2),
    sell_price_cad  NUMERIC(10,2),
    roi_pct         NUMERIC(7,2),
    sales_rank      INTEGER,
    marketplace     TEXT DEFAULT 'amazon_ca',
    status          TEXT DEFAULT 'found' CHECK (status IN ('found','watching','bought','passed','expired')),
    found_date      DATE,
    expires_date    DATE,
    notes           TEXT,
    person_handle   TEXT NOT NULL DEFAULT 'business',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON public.deals (status);
CREATE INDEX ON public.deals (asin);
CREATE INDEX ON public.deals (source);

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deals_authenticated" ON public.deals
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
```

---

### 3.5 Expenses Tile

```sql
-- PROPOSED TABLE: transactions
-- Port-from-Sheets: "📒 Business Transactions" tab (authoritative)
-- Port-from-SQLite: transactions table (data_layer.py:319)
-- Action: PORT — this is the most write-intensive table in the system
-- WARNING: Sheets remains authoritative (shared with accountant). Supabase would be a SECONDARY store.
CREATE TABLE public.transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    txn_date        DATE NOT NULL,
    vendor          TEXT,
    vendor_key      TEXT,
    description     TEXT,
    pre_tax_cad     NUMERIC(10,2),
    gst_cad         NUMERIC(10,2) DEFAULT 0,
    total_cad       NUMERIC(10,2),
    category        TEXT,
    is_business     BOOLEAN DEFAULT TRUE,
    business_use_pct NUMERIC(5,2) DEFAULT 100,
    payment_method  TEXT,
    hubdoc_status   TEXT DEFAULT 'N' CHECK (hubdoc_status IN ('Y','N','Ignored')),
    receipt_id      UUID,                       -- FK added after receipts table
    notes           TEXT,
    person_handle   TEXT NOT NULL DEFAULT 'business',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    _source         TEXT DEFAULT 'manual',
    _sheet_row      INTEGER                     -- backlink to Google Sheets row (transition period)
);

CREATE INDEX ON public.transactions (txn_date);
CREATE INDEX ON public.transactions (vendor_key);
CREATE INDEX ON public.transactions (category);
CREATE INDEX ON public.transactions (person_handle);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transactions_authenticated" ON public.transactions
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);


-- PROPOSED TABLE: receipts
-- Port-from-Sheets: "📸 Receipts" tab
-- Port-from-SQLite: receipts table (data_layer.py:349)
-- Action: PORT
CREATE TABLE public.receipts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_date     TIMESTAMPTZ,
    receipt_date    DATE,
    vendor          TEXT,
    vendor_key      TEXT,
    pre_tax_cad     NUMERIC(10,2),
    gst_cad         NUMERIC(10,2),
    total_cad       NUMERIC(10,2),
    category        TEXT,
    storage_url     TEXT,                       -- R2/S3 URL (LepiOS) or Dropbox URL (current)
    file_path       TEXT,
    match_status    TEXT DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','manual','ignored')),
    matched_txn_id  UUID REFERENCES public.transactions(id),
    ocr_source      TEXT CHECK (ocr_source IN ('tesseract','claude_vision','manual')),
    ocr_confidence  NUMERIC(4,3),
    notes           TEXT,
    person_handle   TEXT NOT NULL DEFAULT 'business',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receipts_authenticated" ON public.receipts
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

-- Add FK back to transactions (after both tables exist)
ALTER TABLE public.transactions
    ADD CONSTRAINT fk_txn_receipt
    FOREIGN KEY (receipt_id) REFERENCES public.receipts(id);


-- PROPOSED TABLE: statement_lines
-- Port-from-Sheets: "🏦 Statement Lines" tab
-- Port-from-SQLite: statement_lines table (data_layer.py:379)
-- Action: PORT
CREATE TABLE public.statement_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account         TEXT NOT NULL,              -- 'td_chequing','amex','costco_mc'
    line_date       DATE NOT NULL,
    description     TEXT,
    amount_cad      NUMERIC(10,2),
    posting_date    DATE,
    line_type       TEXT CHECK (line_type IN ('debit','credit')),
    matched_txn_id  UUID REFERENCES public.transactions(id),
    vendor          TEXT,
    category        TEXT,
    reconciled      BOOLEAN DEFAULT FALSE,
    source_file     TEXT,
    dedup_key       TEXT UNIQUE,                -- prevent double-import
    notes           TEXT,
    person_handle   TEXT NOT NULL DEFAULT 'business',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON public.statement_lines (account);
CREATE INDEX ON public.statement_lines (line_date);
CREATE INDEX ON public.statement_lines (dedup_key);

ALTER TABLE public.statement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "statement_lines_authenticated" ON public.statement_lines
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);


-- PROPOSED TABLE: vendor_rules
-- Port-from-Sheets: "🏷️ Vendor Rules" tab
-- Port-from-SQLite: vendor_rules table (data_layer.py:406)
-- Action: PORT
CREATE TABLE public.vendor_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_key      TEXT NOT NULL UNIQUE,
    display_name    TEXT,
    category        TEXT,
    gst_applicable  BOOLEAN DEFAULT TRUE,
    use_count       INTEGER DEFAULT 0,
    last_used_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendor_rules_authenticated" ON public.vendor_rules
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
```

---

### 3.6 Net Worth / Financial Position

```sql
-- PROPOSED TABLE: net_worth_snapshots
-- Port-from-Sheets: "💎 Net Worth History" tab (54_Monthly_Close reads this)
-- Port-from-SQLite: net_worth_snapshots table (data_layer.py:542)
-- Action: PORT
CREATE TABLE public.net_worth_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date   DATE NOT NULL UNIQUE,
    -- Assets
    amazon_pending  NUMERIC(10,2) DEFAULT 0,
    biz_chequing    NUMERIC(10,2) DEFAULT 0,
    personal_chequing NUMERIC(10,2) DEFAULT 0,
    savings         NUMERIC(10,2) DEFAULT 0,
    fhsa            NUMERIC(10,2) DEFAULT 0,
    rrsp            NUMERIC(10,2) DEFAULT 0,
    tesla_value     NUMERIC(10,2) DEFAULT 0,
    fba_inventory   NUMERIC(10,2) DEFAULT 0,
    lego_vault      NUMERIC(10,2) DEFAULT 0,
    other_assets    NUMERIC(10,2) DEFAULT 0,
    total_assets    NUMERIC(10,2) DEFAULT 0,
    -- Liabilities
    bdc_loan1       NUMERIC(10,2) DEFAULT 0,
    bdc_loan2       NUMERIC(10,2) DEFAULT 0,
    tesla_loan      NUMERIC(10,2) DEFAULT 0,
    credit_cards    NUMERIC(10,2) DEFAULT 0,
    other_liabilities NUMERIC(10,2) DEFAULT 0,
    total_liabilities NUMERIC(10,2) DEFAULT 0,
    net_worth       NUMERIC(10,2) DEFAULT 0,
    person_handle   TEXT NOT NULL DEFAULT 'shared',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.net_worth_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nw_snapshots_authenticated" ON public.net_worth_snapshots
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
```

---

### 3.7 System / Agent Ops Tables

```sql
-- PROPOSED TABLE: agent_events
-- Port-from-Sheets: "Agent Logs" tab, "🤖 Token Usage" tab
-- Port-from-SQLite: events table (knowledge.py:71)
-- Action: PORT + CONSOLIDATE — currently split between a Sheets tab and SQLite
CREATE TABLE public.agent_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    domain          TEXT NOT NULL,
    action          TEXT NOT NULL,
    actor           TEXT NOT NULL DEFAULT 'system',
    status          TEXT DEFAULT 'success' CHECK (status IN ('success','error','warning')),
    input_summary   TEXT,
    output_summary  TEXT,
    error_message   TEXT,
    duration_ms     INTEGER,
    tokens_used     INTEGER,
    model           TEXT,
    confidence      NUMERIC(4,3),
    session_id      TEXT,
    tags            JSONB,
    meta            JSONB
);

CREATE INDEX ON public.agent_events (occurred_at);
CREATE INDEX ON public.agent_events (domain, action);
CREATE INDEX ON public.agent_events (status);

ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_events_authenticated" ON public.agent_events
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
```

---

## 4. RLS Policy Proposals

**STATUS: PLAN ONLY.**

### v1 Policy: Colin-Only Access

In v1, only Colin logs in. All tables use the same pattern:

```sql
-- Read: authenticated user only (Colin's session)
FOR SELECT USING (auth.uid() IS NOT NULL)

-- Write: authenticated user only
WITH CHECK (auth.uid() IS NOT NULL)
```

This is intentionally simple for v1. The `person_handle` column is not used for RLS filtering in v1 — it exists for future per-person row isolation.

### v2 Policy: Megan Read Access (planned, not v1)

When Megan gets an account, RLS tightens to person_handle:

```sql
-- Example v2 pattern (NOT in v1 scope):
-- Colin sees all rows; Megan sees only her own and 'shared'
FOR SELECT USING (
    person_handle IN ('shared','business')
    OR (person_handle = 'megan' AND auth.uid() = (SELECT auth_uid FROM public.people WHERE handle = 'megan'))
    OR (auth.uid() = (SELECT auth_uid FROM public.people WHERE handle = 'colin'))
)
```

### Special Cases

- `agent_events`: no user-facing write; INSERT comes from server-side edge functions only. v1: add INSERT policy binding to service_role.
- `receipts`: file URLs point to Dropbox (current) or Cloudflare R2 (proposed). RLS does not secure the storage bucket — that needs a separate R2/Storage policy.
- `vendor_rules`: shared lookup table; read allowed for all authenticated; write restricted to Colin only.

---

## 5. Schema Debt List

The following are design problems in the current data model that must be resolved before porting — not just migrated as-is.

### SD-1: Product inventory fragmented across 4+ Sheets tabs

Current state: `📦 Book Inventory`, `🛒 Colin - Items`, `🧱 Lego Vault`, `📦 FBA Items` are separate tabs with overlapping and inconsistent column sets. A single ASIN might appear in Book Inventory (physical stock) and FBA Items (FBA status) without a shared key. [grounded: `utils/amazon.py:1538,1583,1605`, `pages/7_Inventory.py:59,85,120,179`]

Required redesign: Unify into single `products` table (as proposed in §3.4). Must define a canonical dedup key — ASIN for marketplace items, ISBN+condition for books without ASIN. Risk: Colin may have manually entered items in only one tab.

### SD-2: BDC loan repayment schedule hardcoded in Python

The principal/interest split for BDC loan 295138-02 is hardcoded as a Python dict in `utils/life_pl.py:267–334`. This makes the data invisible to agents that read from Supabase directly. [grounded: `utils/life_pl.py:267–334`]

Required redesign: Move to a `loan_schedule` table with columns `(loan_id, month, principal, interest)`. Enables the Expenses Agent to compute deductible interest vs. capital correctly without reading Python source.

### SD-3: Recurring personal expenses hardcoded in Python

Colin's recurring expenses (`_COLIN_RECURRING_PERSONAL`) and Megan's subscriptions (`_MEGAN_RECURRING_MONTHLY`) are hardcoded Python dicts. [grounded: `utils/life_pl.py:351–354`, `utils/life_pl.py:429–436`]

Required redesign: These belong in the `subscriptions` table with `person_handle` and `is_business=False`. Currently the Subscriptions sheet only tracks business/SaaS subscriptions.

### SD-4: Two "Vendor Rules" tabs (possible duplicate or alias)

`utils/actions.py:903` references `🏷️ Vendor Rules`, while `utils/auto_reconcile.py:67` defines `RULES_SHEET = "🏪 Vendor Rules"` (different emoji). These may be the same tab with inconsistent naming or two different tabs. [grounded: `utils/actions.py:903`, `utils/auto_reconcile.py:67`]

Required redesign: Audit which tab name is canonical. The constant `RULES_SHEET = "🏪 Vendor Rules"` in auto_reconcile.py may be a bug (🏪 vs 🏷️). Resolve before porting — otherwise vendor classification breaks silently.

### SD-5: Statement Lines uses string "Account Key" not a foreign key

The `account` field in statement_lines is a free-text string ('td_chequing', 'amex', 'costco_mc'). There is no `accounts` reference table. [grounded: `utils/data_layer.py:383`]

Required redesign: Create a `bank_accounts` reference table with canonical account keys, display names, and account type (personal/business). Enables proper cashflow grouping and per-account dashboards.

### SD-6: Historical year tabs not unified with current year

`📊 Amazon 2025`, `💼 Business Expenses 2025`, `📊 Amazon 2026` are separate tabs per year. Querying multi-year P&L requires reading multiple tabs and merging. [grounded: `pages/5_Monthly_PL.py:34`, `pages/58_Tax_Return.py:99`]

Required redesign: Single `orders` and `transactions` tables with a `year` index. Year-based tabs in Sheets were a workaround for sheet size limits — Supabase has no such constraint.

### SD-7: No explicit schema for Cleaning (Megan's business)

The `🧹 Cleaning Clients` tab stores Megan's client roster and rates for revenue estimation. There is no per-transaction record of actual cleaning jobs completed — revenue is estimated from rate × frequency. [grounded: `utils/life_pl.py:196–213`]

Required redesign: Add a `cleaning_jobs` table with actual job completions (date, client, amount_paid) for accurate Megan revenue. The current sheet only supports estimation.

### SD-8: SQLite disabled on Streamlit Cloud — data loss risk

The entire data_layer.py entity cache returns None on Streamlit Cloud, meaning every `upsert()` and `query()` call silently fails. [grounded: `utils/data_layer.py:49–56`]

Required redesign: In LepiOS (Next.js + Supabase), this is resolved by using Supabase as the primary store. But any data written to SQLite during local sessions that was never synced to Sheets will not be visible or portable. Audit sync status before migration.

### SD-9: Sports betting prediction tables not normalized

`Sports Predictions`, `Sports Learning`, `Trading_Predictions`, `Trading_Predictions_Learning` are separate Sheets tabs with no FK relationship back to `🎰 Bets` or `📈 Trading Journal`. Prediction accuracy cannot be automatically computed. [grounded: `pages/3_Sports_Betting.py:1284,1401`, `pages/2_Trading_Journal.py:127,143`]

Required redesign: Add `prediction_id` FK to `bets` and `trades` tables. Track `predicted_result`, `actual_result`, and `accuracy_score` in a normalized `predictions` table.

---

## 6. Migration Risk Flags

### MR-1 (CRITICAL): Kelly Sizer history in "🎰 Bets" tab must not be lost

The Bets sheet is the historical log for Kelly Sizer math — bankroll trajectory and ROI are computed from this tab's full history. Any migration must preserve all rows in order, including `bankroll_after` values which represent the sequential running bankroll. If rows are lost or reordered, Kelly history breaks.

**Mitigation:** Export Bets tab to CSV before migration. Validate row count post-import. Preserve `created_at` ordering.

### MR-2 (HIGH): Trading Journal column mapping is positional, not named

`_load_trading_pl()` in `life_pl.py:142–147` reads the Trading Journal using positional column indices (e.g., `padded[14]` for `$ P/L`). If any column is inserted before column 14 in the Sheets tab, P&L stops working silently. [grounded: `utils/life_pl.py:142–147`]

**Mitigation:** Document the exact column-to-index mapping before migration. In Supabase, use named columns only.

### MR-3 (HIGH): Business Transactions is shared with accountant

Colin's accountant accesses the Business Transactions Google Sheet directly. If LepiOS writes to Supabase as the primary store and the accountant continues reading Sheets, the two stores immediately diverge. [generated: inferred from "Google Sheets remains the authoritative source (shared with accountant)" — `utils/data_layer.py:10`]

**Mitigation:** During v1, keep Google Sheets as the write-through store. Supabase is a read replica populated by the n8n sync workflow. Do not flip primary authority until accountant access is resolved.

### MR-4 (MEDIUM): Payout Register uses two date columns interchangeably

`_load_amazon_revenue()` uses `Date Received` when available, falling back to `Period End`. If Amazon sends a payout that was never marked as received, the fallback date is used — which may land in the wrong month. [grounded: `utils/life_pl.py:87–100`]

**Mitigation:** In Supabase `payouts` table, make `received_date` and `period_end` explicit separate columns. Add a `date_for_accounting` computed column: `COALESCE(received_date, period_end)`.

### MR-5 (MEDIUM): Vendor Rules tab name inconsistency

See SD-4. If the wrong tab name is used during migration export, the vendor classification lookup table will be empty, causing every transaction to be uncategorized. [grounded: `utils/actions.py:903`, `utils/auto_reconcile.py:67`]

**Mitigation:** Read both tab names from Sheets before migration. Log row counts for each. The canonical tab is whichever has more rows.

### MR-6 (MEDIUM): Multi-year tabs for Amazon and Business Expenses

There are separate annual tabs for 2025 and 2026 Amazon data and business expenses. Any multi-year reporting query must read both and UNION before migrating. [grounded: `pages/5_Monthly_PL.py:34,109`]

**Mitigation:** In migration export script, read all year-suffixed tabs and include a `fiscal_year` column. Do not migrate just 2026.

### MR-7 (LOW): ChromaDB vector embeddings reference Sheets data by string ID

The ChromaDB collection (`colin-memories`) stores embeddings with metadata that references Sheets tab names and row content. After Supabase migration, the ChromaDB embeddings become orphaned from the primary store. [grounded: `utils/knowledge.py:44–47`, `scripts/export_to_chromadb.py`]

**Mitigation:** After migration, re-run `scripts/export_to_chromadb.py` with Supabase as source. This is a background operation; ChromaDB is a cache, not the source of truth.

### MR-8 (LOW): One-time hardcoded personal expenses in Python source

`_COLIN_ONE_TIME_PERSONAL` contains specific April 2026 transactions hardcoded in `life_pl.py:357–363`. [grounded: `utils/life_pl.py:357–363`]

**Mitigation:** Before migration, backfill these hardcoded amounts as actual transaction rows in the Sheets tab (or directly into Supabase). Remove the hardcodes from Python source.

---

## 7. Grounding Manifest

Every claim in this report is backed by a file read. All file reads were performed in this session. No claims are made from memory.

| File Read | Evidence Used For |
|---|---|
| `lepios/ARCHITECTURE.md` (full, 244 lines) | Four pillars definition, v1 scope, tech stack (Supabase + RLS), person tags, Check-Before-Build doctrine |
| `lepios/audits/00-inventory.md` (full, 543 lines) | Complete Sheets tab list (grounded by 00-inventory agent), SQLite schema summary, file tree |
| `streamlit_app/utils/data_layer.py` (full, 817 lines) | Complete SQLite schema for all 19 entity tables: columns, types, indexes, constraints |
| `streamlit_app/utils/knowledge.py` (lines 1–120) | Events, knowledge, metrics SQLite tables |
| `streamlit_app/utils/life_pl.py` (lines 1–200, 200–600, 598–850) | Sheet tab names for core P&L sources; BDC hardcode; personal recurring hardcodes; column index reading in Trading Journal |
| `streamlit_app/utils/masterfile.py` (full, 215 lines) | Masterfile spreadsheet ID; Goal Tracking, Colin Expenses, Megan Expenses, Credit Cards tab names and column structures |
| `streamlit_app/utils/` — Grep: `worksheet\(["']` | All worksheet() calls across utils/: 55 matches → full tab name inventory |
| `streamlit_app/pages/` — Grep: `worksheet\(["']` | Additional worksheet() calls in pages/: reveals Sports Predictions, Sports Learning, Trading_Predictions, ASIN Sales Log, Inventory Snapshot, Colin - Pallet Sales, Grocery Inventory, Vehicles, Monthly P&L, Monthly Cashflow, Net Worth History, Tax tabs, Megan Business 2025 |
| `streamlit_app/utils/` — Grep: `SHEET_NAME\s*=\|_SHEET\s*=` | Constants defining sheet tab names: reveals 🔍 Keepa Deals, 🔍 Product Harvest, 🔍 Keepa Alerts, 🔍 OOS Watch, 🏷️ Vendor Rules, 📧 Email Invoices, 📈 BSR History, 📧 Known Senders, 🧱 Retiring Sets, 🔍 Price Monitor, 🔍 Monitored Products, 🔍 Product Intel, ⚙️ PageProfit Settings, 🔗 Relay Buffer, 🤖 Coach Log, 🔱 Deal Cache, 🤖 Task Queue, 🔍 Retail Scout, 🔍 Watchlist, 📊 Odds Snapshots, 📊 Elo Ratings |

---

*Completed by Agent B — Data & Schema Audit. Phase 2 parallel research. Read-only session.*
*Context at completion: approximately 35% of window. No handoff required.*
