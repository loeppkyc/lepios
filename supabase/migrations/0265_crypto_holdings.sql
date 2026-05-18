CREATE TABLE crypto_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT,
  quantity NUMERIC(20,8) NOT NULL DEFAULT 0,
  avg_cost_cad NUMERIC(14,4),
  wallet_or_exchange TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crypto_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON crypto_holdings FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON crypto_holdings TO service_role;
