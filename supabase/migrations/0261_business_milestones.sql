CREATE TABLE business_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  milestone_date DATE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('revenue','acquisition','launch','team','partnership','legal','financial','personal','general')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE business_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON business_milestones FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON business_milestones TO service_role;
