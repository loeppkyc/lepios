CREATE TABLE cashback_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,
  portal TEXT,
  cashback_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  pending_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_earned_ytd NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE cashback_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON cashback_accounts FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON cashback_accounts TO service_role;
