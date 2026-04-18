-- Migration: add win_prob_pct to bets table
-- Sprint 2 Chunk 3 follow-up — Q1 design answer
-- Colin's estimated win probability at bet time (0-100).
-- Stores calibration signal: measures whether estimates improve over time.
-- CHECK constraint: 0-100 inclusive (NULL ok — field is optional).

ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS win_prob_pct numeric(5,2) NULL
    CONSTRAINT bets_win_prob_pct_check CHECK (win_prob_pct >= 0 AND win_prob_pct <= 100);

COMMENT ON COLUMN bets.win_prob_pct IS
  'Colin''s estimated win probability at bet time (0-100). Used for calibration tracking — measures whether estimates improve over time. Set client-side in LogBetForm, stored as-is.';
