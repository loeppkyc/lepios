CREATE TABLE phone_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  carrier TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  monthly_cost NUMERIC(8,2) NOT NULL,
  data_gb NUMERIC(6,1),
  renewal_date DATE,
  phone_model TEXT,
  phone_owner TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE phone_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON phone_plans FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON phone_plans TO service_role;
