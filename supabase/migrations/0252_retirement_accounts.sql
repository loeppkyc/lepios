CREATE TABLE retirement_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('RRSP','TFSA','LIRA','RESP','Pension','401k','IRA','other')),
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  annual_contribution NUMERIC(10,2),
  employer_match_pct NUMERIC(5,2),
  target_retirement_age INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE retirement_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON retirement_accounts FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON retirement_accounts TO service_role;
