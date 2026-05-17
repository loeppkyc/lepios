# E10 — Trading Journal Sheets Sync + IBKR P&L Research
## Phase 1a Study

task_id: f6b7bfdb-5563-40cf-b31b-17abb7b5ab3f  
Completed: 2026-05-17

---

## What the task asks

Three parts:

1. **Backfill** 63 historical MES trades (Sep 2025–present) from "Trading Journal" Google Sheet tab into a `trading_journal` Supabase table.  
   Requested schema: `date, paper_or_real, direction, ticker, price_in, price_out, points_pl, dollar_pl, mood, comments`

2. **Wire `/api/cron/trading-score`** to upsert new trades from Sheets automatically (ongoing sync).

3. **Research IBKR Flex Query API** — Colin uses IBKR for real trades. Determine polling vs webhook. Output: recommendation doc.

F17 signal: trades + mood feed behavioral engine.  
F18 surface: win rate + cumulative P&L on /trading page.

---

## What already exists

### `trades` table (existing, empty today)

| column | type | nullable | notes |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| trade_date | date | NO | |
| mode | text | NO | 'paper'/'live' |
| horizon | text | NO | 'day'/'swing' |
| direction | text | NO | 'long'/'short' |
| ticker | text | NO | |
| instrument_type | text | NO | |
| price_in | numeric | NO | |
| **stop_loss** | **numeric** | **NO** | **NOT NULL — sheets data won't have this** |
| **take_profit** | **numeric** | **NO** | **NOT NULL — sheets data won't have this** |
| price_out | numeric | YES | |
| points_pnl | numeric | YES | |
| dollar_pnl | numeric | YES | |
| mood | text | YES | |
| comments | text | YES | |
| _source | text | NO | default 'lepios' |
| person_handle | text | NO | default 'colin' |

The `trades` table is designed for forward-looking positions with stop/target metadata. The task explicitly names a separate simpler `trading_journal` table — this is the right split.

### `trading_sessions` table (existing)

Session-level journal (session_date, ticker, strategy_name, outcome, net_pnl). Not the right fit for individual trade backfill.

### Google Sheets client (`lib/sheets/client.ts`)

`readOsSheet(sheetName, maxRows?)` already implemented. Uses same Google OAuth2 (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN) as Gmail. Spreadsheet ID: `1arXxho2gD8IeWbQNcOt8IwZ7DRl2wz-qJzC3J4hiR4k`. OAuth credentials already in Vercel env (verified via Gmail scanner operational).

### `/app/(cockpit)/trading/page.tsx`

Full Trading Journal UI with four tabs: Journal, AI Engine, Stats, Backtest. Loads from `trades` table only via `/api/trades`. No `trading_journal` source currently.

### `/api/cron/trading-score` (existing)

Calls `/api/trading/score` (14 instruments) + `/api/trading/learn` (weight tune). Schedule: `0 13 * * *` (7am MT). No Sheets sync step today.

### `/api/cron/trading-picks-scan` (existing)

Separate daily cron at 7am MT weekdays. Delegates to same `/api/trading/score` + sends Telegram picks.

---

## Domain rules embedded in task

1. `paper_or_real` maps to `mode` = 'paper'/'live' in the existing trading schema
2. `ticker` for MES trades = 'ES=F' (S&P 500 Micro E-mini futures)
3. All 63 historical trades are MES (futures), so `instrument_type` = 'future'
4. `points_pl` = price delta in points; `dollar_pl` = points × $5 (MES point value)
5. F17: `mood` column feeds behavioral engine — must be preserved exactly as entered in Sheets
6. F18: win rate and cumulative P&L are the surfacing metrics for this module

---

## Open questions requiring Colin input

### OQ-1: Sheet tab name
Is the Google Sheet tab exactly named `"Trading Journal"`? (The `readOsSheet` function takes a literal tab name.) If different (e.g. "MES Journal", "Trade Log"), builder will fail.

### OQ-2: Upsert dedup key
For the ongoing sync (Part 2), what is the uniqueness key to prevent double-inserting?
Options:
- (a) `date + ticker + direction + price_in` — most natural, but two trades same ticker same day same direction same entry are ambiguous
- (b) Add a `sheets_row_id` or `external_id` column to `trading_journal` and use row index from Sheets as dedup key
- (c) Insert-only, no dedup — rely on idempotent timestamp filter

### OQ-3: UI integration
Should the 63 historical trades + future Sheets-synced trades appear in the /trading page Stats tab alongside `trades` data? Or is `trading_journal` a separate data source with its own view?

### OQ-4: IBKR data destination
Part 3 is research. After the research: should IBKR real trades eventually land in `trading_journal` (with `_source='ibkr'`) or in `trades` (with full stop/target metadata from IBKR fill data)?

---

## 20% Better opportunities

| Category | Streamlit baseline | LepiOS improvement |
|---|---|---|
| Correctness | Manual backfill (one-time script) | Automated daily sync with dedup |
| Performance | No Sheets integration yet | Daily cron reuses existing OAuth session |
| UX | No historical P&L visible in UI | Stats tab shows win rate + cumulative $ from day 1 |
| Observability | No error tracking | `agent_events` row on each sync run with rows_synced, rows_skipped |
| Data model | Flat Sheets row | typed schema with person_handle for future Megan/Cora expansion |

---

## Twin Q&A — blocked (endpoint unreachable)

Twin is not accessible from coordinator sandbox (host not in allowlist). All 4 open questions go directly to Colin.

---

## IBKR Flex Query research (Part 3)

See `E10-ibkr-research.md` in this directory — full recommendation doc.
