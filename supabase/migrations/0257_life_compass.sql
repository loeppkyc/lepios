CREATE TABLE life_compass (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area TEXT NOT NULL,
  current_score NUMERIC(3,1) NOT NULL DEFAULT 5.0 CHECK (current_score >= 0 AND current_score <= 10),
  target_score NUMERIC(3,1) NOT NULL DEFAULT 8.0 CHECK (target_score >= 0 AND target_score <= 10),
  vision TEXT,
  actions TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, area)
);
ALTER TABLE life_compass ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON life_compass FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON life_compass TO service_role;