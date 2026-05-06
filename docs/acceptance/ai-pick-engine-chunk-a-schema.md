# Acceptance Doc — AI Pick Engine Chunk A: Schema + Paper Mode

**Sibling:** `ai-pick-engine-overview.md` (read first)
**Depends on:** Nothing — first chunk, schema-only.
**Blocks:** Chunks B, C, D.
**Builder window estimate:** 1.5–2 hours (one session).

---

## What ships

A single migration file (next available number, currently `0131_ai_pick_engine_schema.sql`) creating four schema additions:

1. `trades` table (new)
2. `predictions` table (new)
3. `mode` column on `bets` (alter) and `trades` (default)
4. `trust_state` table (new)

Plus RLS policies, indexes, and a regenerated `lib/db/types.ts`. **No app code, no UI, no API routes.**

---

## Builder pre-flight (mandatory)

Before writing the migration, builder runs:

```bash
# Confirm migration number is unused
ls supabase/migrations/ | grep ^0131

# Confirm tables don't already exist
grep -r "CREATE TABLE.*trades\b" supabase/migrations/
grep -r "CREATE TABLE.*predictions\b" supabase/migrations/
grep -r "CREATE TABLE.*trust_state\b" supabase/migrations/

# Confirm bets schema (we ALTER it)
grep -A 50 "CREATE TABLE.*bets" supabase/migrations/0001*.sql
```

Per F-L3: never write a table or column name from memory. Per F-L1: builder operates on a feature branch (`harness/ai-pick-engine-chunk-a`), not main.

---

## Migration content

### A.1 — `trades` table

Mirrors the Streamlit Trading Journal schema (`streamlit_app/pages/2_Trading_Journal.py` line 29) but normalized for Postgres.

```sql
CREATE TABLE trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date date NOT NULL,
  mode text NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper', 'live')),
  horizon text NOT NULL CHECK (horizon IN ('day', 'swing')),
  direction text NOT NULL CHECK (direction IN ('long', 'short')),
  ticker text NOT NULL,
  instrument_type text NOT NULL CHECK (instrument_type IN ('future', 'stock', 'commodity', 'index')),
  price_in numeric(12,4) NOT NULL,
  stop_loss numeric(12,4) NOT NULL,
  take_profit numeric(12,4) NOT NULL,
  position_size numeric(12,4) NULL,         -- contracts/shares
  date_out date NULL,
  price_out numeric(12,4) NULL,
  stopped_out boolean NULL,                  -- TRUE if exited at stop
  points_pnl numeric(12,4) NULL,
  dollar_pnl numeric(12,2) NULL,
  r_multiple numeric(8,4) NULL,              -- realized R (pnl / planned risk)
  mood text NULL,                            -- Calm/Confident/Anxious/etc — port from Streamlit
  comments text NULL,
  ai_notes jsonb NULL,                       -- coach output stored as JSONB
  prediction_id uuid NULL REFERENCES predictions(id), -- if originated from AI pick
  person_handle text NOT NULL DEFAULT 'colin', -- SPRINT5-GATE
  _source text NOT NULL DEFAULT 'lepios',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trades_date_idx ON trades(trade_date);
CREATE INDEX trades_ticker_idx ON trades(ticker);
CREATE INDEX trades_mode_idx ON trades(mode);
CREATE INDEX trades_prediction_idx ON trades(prediction_id) WHERE prediction_id IS NOT NULL;

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY trades_authenticated_all ON trades
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE TRIGGER trades_updated_at BEFORE UPDATE ON trades
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

**Notes:**

- `prediction_id` FK is forward-declared; `predictions` table is created in A.2 below — order matters in the migration file (A.2 first, then A.1).
- RLS is **permissive** (any authenticated user) until SPRINT5-GATE (§7.3). Mirrors current `bets` policy. MN-3 will tighten later.
- `instrument_type` enum aligns with Streamlit's `MARKET_INSTRUMENTS` map (`tools/trading_predictions.py` line 21–38).

### A.2 — `predictions` table (one row per AI pick — sport OR trade)

Single table for both domains. Discriminator column.

```sql
CREATE TABLE predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL CHECK (domain IN ('trading', 'sports')),
  pick_date date NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),

  -- shared fields
  grade text NOT NULL CHECK (grade IN ('A', 'B+', 'B', 'C')),
  confidence numeric(4,2) NOT NULL CHECK (confidence BETWEEN 0 AND 10),
  reason text NOT NULL,                       -- Claude's prose explanation
  tier text NULL,                              -- 'green' / 'red' for sports; null for trading

  -- trading-specific (NULL for sports)
  ticker text NULL,
  direction text NULL CHECK (direction IS NULL OR direction IN ('long', 'short')),
  entry_price numeric(12,4) NULL,
  stop_price numeric(12,4) NULL,
  target_price numeric(12,4) NULL,
  atr numeric(12,4) NULL,
  risk_reward numeric(8,4) NULL,
  raw_score numeric(8,4) NULL,                -- pre-weight score from scanner
  weighted_score numeric(8,4) NULL,           -- post-weight score
  weights_snapshot jsonb NULL,                -- weights used at generation time

  -- sports-specific (NULL for trading)
  sport text NULL,
  league text NULL,
  game_id text NULL,                          -- The Odds API game id
  home_team text NULL,
  away_team text NULL,
  bet_on text NULL,                           -- team picked
  odds integer NULL,                          -- American odds at pick time
  closing_odds integer NULL,                  -- captured later for closing-line value
  implied_prob numeric(5,2) NULL,
  ai_rating numeric(4,2) NULL,                -- Claude 1-10 rating on bet quality

  -- outcome (NULL until settled)
  resolved_at timestamptz NULL,
  won boolean NULL,
  actual_pnl numeric(12,2) NULL,
  exit_price numeric(12,4) NULL,              -- trading
  actual_result text NULL,                    -- 'win'/'loss'/'push'/'void' for sports

  -- linkage
  bet_id uuid NULL REFERENCES bets(id),       -- if Colin acted on a sports pick
  trade_id uuid NULL REFERENCES trades(id),   -- if Colin acted on a trade pick
  mode text NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper', 'live')),

  person_handle text NOT NULL DEFAULT 'colin',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX predictions_domain_date_idx ON predictions(domain, pick_date DESC);
CREATE INDEX predictions_unresolved_idx ON predictions(domain, generated_at)
  WHERE resolved_at IS NULL;
CREATE INDEX predictions_grade_idx ON predictions(grade, domain);
CREATE INDEX predictions_mode_idx ON predictions(mode);

-- Validate domain-specific NOT NULL constraints
ALTER TABLE predictions ADD CONSTRAINT predictions_trading_fields_chk
  CHECK (
    domain != 'trading' OR (
      ticker IS NOT NULL AND direction IS NOT NULL
      AND entry_price IS NOT NULL AND stop_price IS NOT NULL
      AND target_price IS NOT NULL AND raw_score IS NOT NULL
    )
  );

ALTER TABLE predictions ADD CONSTRAINT predictions_sports_fields_chk
  CHECK (
    domain != 'sports' OR (
      sport IS NOT NULL AND league IS NOT NULL AND home_team IS NOT NULL
      AND away_team IS NOT NULL AND bet_on IS NOT NULL AND odds IS NOT NULL
    )
  );

ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY predictions_authenticated_all ON predictions
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TRIGGER predictions_updated_at BEFORE UPDATE ON predictions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### A.3 — Add `mode` to `bets`

```sql
ALTER TABLE bets ADD COLUMN mode text NOT NULL DEFAULT 'paper'
  CHECK (mode IN ('paper', 'live'));

CREATE INDEX bets_mode_idx ON bets(mode);
```

**Migration safety:** All existing `bets` rows backfill to `mode = 'paper'`. This is intentional — Colin has not flipped to live yet; treat all historical Sprint-2 bets as paper-equivalent for calibration purposes. (Existing bets pre-date the AI engine so they have no `prediction_id` link; they're real money but not engine-attributable. Acceptable for v1; revisit if it muddies calibration.)

### A.4 — `trust_state` table

```sql
CREATE TABLE trust_state (
  domain text PRIMARY KEY CHECK (domain IN ('trading', 'sports')),
  current_mode text NOT NULL DEFAULT 'paper' CHECK (current_mode IN ('paper', 'live')),
  flipped_to_live_at timestamptz NULL,
  flipped_to_live_by text NULL,                  -- audit trail

  -- thresholds (editable from UI)
  min_sample_size integer NOT NULL,
  win_rate_threshold numeric(4,2) NOT NULL,      -- e.g. 0.55
  secondary_metric_key text NOT NULL,            -- 'avg_r_multiple' | 'roi_pct'
  secondary_metric_threshold numeric(8,4) NOT NULL,
  calibration_grade text NOT NULL,               -- 'A' for trading, '7+' for sports
  calibration_threshold numeric(4,2) NOT NULL,
  max_drawdown_threshold numeric(4,2) NOT NULL,

  -- rolling stats (recomputed on every prediction resolve)
  current_sample_size integer NOT NULL DEFAULT 0,
  current_win_rate numeric(4,2) NULL,
  current_secondary_metric numeric(8,4) NULL,
  current_calibration_rate numeric(4,2) NULL,
  current_drawdown numeric(4,2) NULL,
  last_recomputed_at timestamptz NULL,

  -- gate state
  gate_status text NOT NULL DEFAULT 'closed' CHECK (gate_status IN ('closed', 'open')),
  gate_failures jsonb NULL,                       -- which thresholds are not yet met

  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trust_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY trust_state_authenticated_all ON trust_state
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Seed both domains with proposed defaults from overview doc
INSERT INTO trust_state (
  domain, min_sample_size, win_rate_threshold,
  secondary_metric_key, secondary_metric_threshold,
  calibration_grade, calibration_threshold,
  max_drawdown_threshold
) VALUES
  ('trading', 30, 0.55, 'avg_r_multiple', 0.5, 'A', 0.65, 0.15),
  ('sports', 50, 0.62, 'roi_pct', 0.03, '7+', 0.65, 0.20);

CREATE TRIGGER trust_state_updated_at BEFORE UPDATE ON trust_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### A.5 — `prediction_weights` table (auto-tuning history)

Trading-only for v1 (sports learning loop is chunk C scope but uses the same table).

```sql
CREATE TABLE prediction_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL CHECK (domain IN ('trading', 'sports')),
  weights jsonb NOT NULL,                  -- { trend: 1.0, rsi: 1.0, ... }
  generated_by text NOT NULL,              -- 'seed' | 'analyze_and_learn' | 'manual'
  reasoning text NULL,                     -- Claude's explanation when auto-tuned
  sample_window integer NOT NULL,          -- last N trades analyzed
  win_rate_at_generation numeric(4,2) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX prediction_weights_one_active_per_domain_idx
  ON prediction_weights(domain) WHERE is_active = true;

CREATE INDEX prediction_weights_domain_created_idx
  ON prediction_weights(domain, created_at DESC);

ALTER TABLE prediction_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY prediction_weights_authenticated_all ON prediction_weights
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Seed initial weights from Streamlit defaults
INSERT INTO prediction_weights (domain, weights, generated_by, sample_window, is_active) VALUES
  ('trading', '{
    "trend_weight": 1.0,
    "rsi_weight": 1.0,
    "volume_weight": 1.0,
    "momentum_weight": 1.0,
    "level_weight": 1.0,
    "atr_stop_mult": 1.5,
    "atr_target_mult": 3.0,
    "min_score_threshold": 5.0
  }'::jsonb, 'seed', 0, true),
  ('sports', '{
    "max_odds": -150,
    "tier_green_max": -150,
    "min_implied_prob": 0.60,
    "ai_rating_min": 7.0
  }'::jsonb, 'seed', 0, true);
```

---

## Acceptance criteria

### AC-A1: Migration applies cleanly

```bash
npx supabase db push
```

Returns success. No errors. Idempotent (re-running fails gracefully or is a no-op).

### AC-A2: Constraints enforce domain integrity

Builder runs in psql or test:

```sql
-- Should FAIL (trading row without ticker)
INSERT INTO predictions (domain, pick_date, grade, confidence, reason)
VALUES ('trading', CURRENT_DATE, 'B', 6.0, 'test');

-- Should SUCCEED
INSERT INTO predictions (
  domain, pick_date, grade, confidence, reason,
  ticker, direction, entry_price, stop_price, target_price, raw_score
) VALUES ('trading', CURRENT_DATE, 'B', 6.0, 'test', 'ES=F', 'long', 5800, 5780, 5840, 7.5);
```

### AC-A3: trust_state seeded with proposed defaults

```sql
SELECT domain, min_sample_size, win_rate_threshold FROM trust_state ORDER BY domain;
-- sports | 50 | 0.62
-- trading | 30 | 0.55
```

### AC-A4: prediction_weights seeded as active

```sql
SELECT domain, weights->>'trend_weight' FROM prediction_weights WHERE is_active = true;
-- trading | 1.0
```

### AC-A5: Existing bets table backfilled to mode='paper'

```sql
SELECT mode, count(*) FROM bets GROUP BY mode;
-- paper | <existing count>
```

### AC-A6: TypeScript types regenerated

`lib/db/types.ts` includes `predictions`, `trades`, `trust_state`, `prediction_weights` definitions. Build passes (`npm run typecheck`).

### AC-A7: No conflicts with existing schema

```bash
npm run test -- --testPathPattern=architecture
```

F-N5 architecture tests still pass; no new auth surface introduced.

### AC-A8: RLS smoke test

Builder confirms via Supabase MCP `execute_sql` that an unauthenticated query against `predictions` returns 0 rows / permission denied.

---

## Handoff JSON (builder writes on completion)

`docs/sprint-{N}/chunk-ai-pick-engine-a-handoff.json` — standard format:

- Migration file path
- Migration applied confirmation (production DB)
- Tables created (list)
- Indexes created (list)
- Seed rows count
- Tests run + pass count
- Outstanding follow-ups (e.g., "MN-3 SPRINT5-GATE still hardcoded `colin`")
