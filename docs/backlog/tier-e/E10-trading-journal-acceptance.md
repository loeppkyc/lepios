# E10 — Acceptance Doc: Trading Journal Sheets Sync

task_id: f6b7bfdb-5563-40cf-b31b-17abb7b5ab3f  
Status: awaiting-colin-approval  
Written: 2026-05-17

---

## Scope

**Three deliverables in dependency order:**

### Chunk A — `trading_journal` schema + one-time backfill (migration + backfill script)
**Acceptance criterion:** 63 historical MES trades from the "Trading Journal" Google Sheet tab are present in `trading_journal` Supabase table with correct direction, prices, P&L, and mood. Zero duplicate rows.

### Chunk B — Daily Sheets sync cron (`/api/cron/trading-journal-sync`)
**Acceptance criterion:** New `/api/cron/trading-journal-sync` route runs daily, reads the Sheets tab, upserts new rows since last sync into `trading_journal`. No double-inserts. Logs sync result to `agent_events` with `rows_synced` count.

### Chunk C — IBKR Flex sync route (`/api/cron/ibkr-sync`) *(deferred — pending grounding checkpoint)*
**Acceptance criterion:** After Colin verifies IBKR Flex Query live (grounding in IBKR research doc), builder adds cron that polls IBKR Flex API and upserts fills to `trading_journal` with `_source='ibkr'`. Separate from Chunk B — does not block it.

**Note on `/api/cron/trading-score`:** The task description says "wire trading-score to upsert from Sheets" but that route's job is scoring/learning, not data ingestion. Recommendation: dedicated `trading-journal-sync` cron (separation of concerns). If Colin prefers adding a sync step to trading-score, that is a one-sentence change to scope.

---

## Out of scope (v1)

- UI changes to /trading page to show `trading_journal` data in stats (separate task — F18 surface)
- IBKR Chunk C before Colin runs grounding checkpoint on live Flex API
- `dollar_pnl → behavioral engine` wiring (separate task once schema exists)
- Dedup merging between `trades` (forward positions) and `trading_journal` (historical log)

---

## Schema — Chunk A

**New table: `trading_journal`**

```sql
CREATE TABLE trading_journal (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date      date NOT NULL,
  paper_or_real   text NOT NULL CHECK (paper_or_real IN ('paper', 'real')),
  direction       text NOT NULL CHECK (direction IN ('long', 'short')),
  ticker          text NOT NULL,
  price_in        numeric(12,4) NOT NULL,
  price_out       numeric(12,4),
  points_pl       numeric(12,4),
  dollar_pl       numeric(12,4),
  mood            text,
  comments        text,
  _source         text NOT NULL DEFAULT 'sheets',
  person_handle   text NOT NULL DEFAULT 'colin',
  external_id     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX trading_journal_external_id_idx ON trading_journal(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX trading_journal_trade_date_idx ON trading_journal(trade_date DESC);
CREATE INDEX trading_journal_source_idx ON trading_journal(_source);

GRANT INSERT, UPDATE, DELETE ON trading_journal TO service_role;
```

`external_id`: row-based dedup key. For Sheets backfill: set to `"sheets-row-{N}"` (row index). For IBKR: `"{datetime}_{symbol}_{price}_{qty}"`. Unique constraint enables safe upsert.

**Migration number: 0235** (reserved)

---

## Files expected to change

| File | Change |
|---|---|
| `supabase/migrations/0235_trading_journal.sql` | New — CREATE TABLE + GRANT |
| `scripts/backfill/e10-trading-journal.ts` | New — one-time backfill script (run once locally, not deployed) |
| `app/api/cron/trading-journal-sync/route.ts` | New — daily Sheets sync cron |
| `lib/trading/types.ts` | Add `TradingJournalRow` type |

No changes to existing `trades` table, `/api/trades`, or TradingPage.

---

## Check-Before-Build findings

- **`trades` table** exists with similar but richer schema (stop_loss/take_profit NOT NULL) — confirmed NOT the right target for Sheets historical data. Separate table is correct.
- **`lib/sheets/client.ts`** already exists — `readOsSheet(sheetName)` is the integration point. Google OAuth credentials already live in Vercel env.
- **`/api/cron/trading-score`** exists — do not modify. New dedicated sync cron.
- **No prior `trading_journal` table.** Greenfield schema.
- **Migration 0235** confirmed available via `next-migration-number.mjs`.

---

## External deps tested

| Dep | Status |
|---|---|
| Google Sheets API | Verified operational via Gmail scanner. Same OAuth app. `readOsSheet` call pattern confirmed correct. |
| IBKR Flex API | NOT tested — blocked in coordinator sandbox. Builder must verify from Vercel dev. Grounding checkpoint in research doc. |

---

## Grounding checkpoints

**Chunk A:**
```sql
SELECT COUNT(*), MIN(trade_date), MAX(trade_date), 
       SUM(CASE WHEN direction='long' THEN 1 ELSE 0 END) as longs,
       SUM(CASE WHEN direction='short' THEN 1 ELSE 0 END) as shorts
FROM trading_journal WHERE _source='sheets';
-- Expect: 63 rows, date range Sep 2025 to present, mood column non-null on most rows
```

**Chunk B:**
```sql
SELECT action, meta, occurred_at FROM agent_events 
WHERE action='trading_journal_sync' ORDER BY occurred_at DESC LIMIT 3;
-- Expect: rows_synced count, no error status
```

**Chunk C (IBKR):** Colin must manually verify Flex API live — see `E10-ibkr-research.md` §Grounding checkpoint.

---

## Open questions (require Colin answers before builder can proceed)

### OQ-1 — Sheet tab name ⚠️ BLOCKING
What is the exact name of the Google Sheet tab containing the MES trades? `readOsSheet()` takes a literal tab name. Options I'm assuming:
- "Trading Journal" (matches the task description)
- Something else?

**If the tab is not named exactly "Trading Journal", builder will fail with 400 from Sheets API.**

### OQ-2 — Dedup key for ongoing sync
For Part 2 daily sync, how do we avoid double-inserting a trade that's already in the table?
- **Option A (recommended):** Use Sheets row index as `external_id` (e.g. `"sheets-row-5"`). Stable unless rows are deleted/reordered.
- **Option B:** Composite key `(trade_date, ticker, direction, price_in)`. Fails if same instrument traded twice same day same direction same entry.
- **Option C:** Insert-only with `trade_date >= last_sync_date` filter. Simpler but can't catch edits.

### OQ-3 — UI integration
Should the /trading Stats tab show `trading_journal` data (historical + ongoing) alongside `trades` data? If yes, the Stats tab needs a second data source. That's a separate chunk — just confirming it's on the roadmap.

### OQ-4 — Scope clarification on Part 2
"wire /api/cron/trading-score to upsert new trades from Sheets" — should this literally add a step to the existing `trading-score` cron, or is a dedicated `trading-journal-sync` cron acceptable? (I'm recommending dedicated for separation of concerns.)

---

## Kill signals

- Google Sheets tab not accessible (auth revoked, tab renamed) → abort Chunk B, do Chunk A only
- `trading_journal` data is very sparse (< 30 of 63 trades have mood/price_out) → flag to Colin before building UI surface
- IBKR Flex query returns no fills for MES → verify query config before building Chunk C

---

## Cached-principle decisions

No cache-match attempted. Twin unreachable. New schema table creation with open questions → escalating to Colin per own-uncertainty escalation rule.

**Reversibility:**
- Migration 0235 (CREATE TABLE): reversible via DROP TABLE. No existing data affected.
- Backfill script: reversible via `DELETE FROM trading_journal WHERE _source='sheets'`.
- New cron route: reversible via file delete + deploy.

---

## F17 justification

`mood` column + trade outcomes feed the behavioral engine: mood-at-time-of-trade correlated with win rate is a first-order behavioral signal. This directly connects to the Happy + Money pillars.

## F18 metric

- Unit: win rate % (wins / settled trades)  
- Benchmark: paper trading baseline → target positive expectancy before live  
- Surface: `/trading` Stats tab — wins, losses, cumulative P&L, win rate %  
- Measurement: query `trading_journal WHERE _source IN ('sheets','ibkr')` grouped by month
