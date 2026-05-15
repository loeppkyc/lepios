-- 0206_elo_ratings.sql
-- Sports Intel Chunk B — NHL Elo rating system
-- Creates elo_ratings table + adds ai_debrief column to sports_picks
-- Task: 1fb9151e-7739-4fa5-9720-7f56b9b5b141

-- ── ai_debrief column on sports_picks ────────────────────────────────────────
-- Structure: { summary: string, factors: string[], lesson: string, quality_rating: int }
ALTER TABLE public.sports_picks ADD COLUMN IF NOT EXISTS ai_debrief jsonb;

-- ── elo_ratings ──────────────────────────────────────────────────────────────
CREATE TABLE public.elo_ratings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport         text NOT NULL DEFAULT 'nhl',
  team          text NOT NULL,
  elo           numeric(7,2) NOT NULL DEFAULT 1500,
  wins          integer NOT NULL DEFAULT 0,
  losses        integer NOT NULL DEFAULT 0,
  games_played  integer NOT NULL DEFAULT 0,
  last_game_at  date,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sport, team)
);

GRANT INSERT, UPDATE, DELETE ON public.elo_ratings TO service_role;

ALTER TABLE public.elo_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON public.elo_ratings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX elo_ratings_sport_elo_idx ON public.elo_ratings (sport, elo DESC);
