CREATE TABLE insurance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  policy_type TEXT NOT NULL CHECK (policy_type IN ('auto','home','life','health','dental','disability','umbrella','other')),
  policy_number TEXT,
  premium_monthly NUMERIC(10,2),
  premium_annual NUMERIC(10,2),
  renewal_date DATE,
  coverage_amount NUMERIC(12,2),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE insurance_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON insurance_policies FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON insurance_policies TO service_role;
