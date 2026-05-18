CREATE TABLE printer_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'printing', 'done', 'failed', 'paused')),
  material TEXT,
  filament_used_g NUMERIC(8,2),
  print_time_min INT,
  notes TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE printer_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON printer_projects FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON printer_projects TO service_role;