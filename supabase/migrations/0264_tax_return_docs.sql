CREATE TABLE tax_return_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tax_year INTEGER NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('T4','T4A','T5','T3','RRSP-receipt','medical','charitable','tuition','business-income','business-expense','rental','foreign','other')),
  description TEXT NOT NULL,
  amount NUMERIC(12,2),
  file_url TEXT,
  is_confirmed BOOLEAN NOT NULL DEFAULT false,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tax_return_docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON tax_return_docs FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON tax_return_docs TO service_role;
