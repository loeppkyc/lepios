CREATE TABLE archive_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  file_url TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE archive_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON archive_items FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON archive_items TO service_role;