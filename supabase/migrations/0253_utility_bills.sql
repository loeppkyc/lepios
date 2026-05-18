CREATE TABLE utility_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  utility_type TEXT NOT NULL CHECK (utility_type IN ('electricity','gas','water','internet','cable','trash','other')),
  monthly_avg NUMERIC(8,2),
  last_bill_amount NUMERIC(8,2),
  last_bill_date DATE,
  auto_pay BOOLEAN NOT NULL DEFAULT false,
  account_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE utility_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON utility_bills FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON utility_bills TO service_role;
