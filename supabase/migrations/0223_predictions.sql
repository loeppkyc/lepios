-- Migration 0223: predictions table (A7 — Sports Prediction Calibration Widget)
-- This is a calibration dataset builder, NOT a betting tool.
--
-- The name 'predictions' was previously claimed by migration 0142 (AI Pick Engine)
-- for a trading/sports AI pick table with a different schema. That table is verified
-- empty (0 rows, no FK inbound references) and was never connected to a UI.
-- We rename it to preserve the migration record and free the name for A7.
-- VERIFIED SAFE: 0 rows, 0 FK dependents confirmed 2026-05-16.

ALTER TABLE predictions RENAME TO ai_pick_predictions;

CREATE TABLE IF NOT EXISTS predictions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_handle TEXT        NOT NULL DEFAULT 'colin', -- SPRINT5-GATE
  sport         TEXT        NOT NULL,
  event_desc    TEXT        NOT NULL,
  prediction    TEXT        NOT NULL,
  confidence    INTEGER     NOT NULL CHECK (confidence BETWEEN 1 AND 10),
  game_date     DATE        NOT NULL,
  notes         TEXT        CHECK (char_length(notes) <= 500),
  actual_result TEXT,
  outcome       TEXT        CHECK (outcome IN ('correct', 'wrong', 'partial')),
  settled_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_predictions_person ON predictions(person_handle);
CREATE INDEX idx_predictions_sport ON predictions(sport);
CREATE INDEX idx_predictions_game_date ON predictions(game_date DESC);

-- F24: GRANT required for service_role writes from API routes
GRANT INSERT, UPDATE, DELETE ON predictions TO service_role;
