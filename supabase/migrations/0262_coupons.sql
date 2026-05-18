CREATE TABLE coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store TEXT NOT NULL,
  description TEXT NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'pct' CHECK (discount_type IN ('pct','fixed','bogo','free-shipping','other')),
  discount_value NUMERIC(8,2),
  min_purchase NUMERIC(8,2),
  expiry_date DATE,
  code TEXT,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('grocery','electronics','clothing','home','restaurant','travel','online','general')),
  is_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON coupons FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON coupons TO service_role;
