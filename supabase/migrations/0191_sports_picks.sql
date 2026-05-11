-- Sports Intel MID cluster: sports_picks table
-- Replaces Google Sheets Sports_Picks_Log from tools/sports_predictions.py
-- Ports: utils/sports_odds.py, utils/sports_coach.py, tools/sports_predictions.py

CREATE TABLE IF NOT EXISTS sports_picks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  picked_on    DATE        NOT NULL,
  sport_key    TEXT        NOT NULL,
  league       TEXT        NOT NULL,
  game_id      TEXT        NOT NULL,
  home         TEXT        NOT NULL,
  away         TEXT        NOT NULL,
  favorite     TEXT        NOT NULL,
  fav_odds     INT         NOT NULL,
  dog_odds     INT         NOT NULL,
  implied_prob NUMERIC(5,1),
  commence_str TEXT,
  tier         TEXT        NOT NULL DEFAULT 'red' CHECK (tier IN ('green', 'red')),
  winner       TEXT,
  fav_won      BOOLEAN,
  pnl          NUMERIC(8,2),
  updated_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique per game per day (idempotent log_picks equivalent)
CREATE UNIQUE INDEX IF NOT EXISTS sports_picks_game_day_uidx
  ON sports_picks (game_id, picked_on);

CREATE INDEX IF NOT EXISTS sports_picks_picked_on_idx
  ON sports_picks (picked_on DESC);

CREATE INDEX IF NOT EXISTS sports_picks_league_idx
  ON sports_picks (league);

ALTER TABLE sports_picks ENABLE ROW LEVEL SECURITY;

GRANT INSERT, UPDATE, DELETE ON sports_picks TO service_role;
