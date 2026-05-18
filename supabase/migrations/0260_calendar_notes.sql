CREATE TABLE calendar_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_date DATE NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  all_day BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE calendar_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON calendar_notes FOR ALL USING (auth.uid() = user_id);
CREATE INDEX calendar_notes_user_date ON calendar_notes (user_id, note_date);
GRANT INSERT, UPDATE, DELETE ON calendar_notes TO service_role;