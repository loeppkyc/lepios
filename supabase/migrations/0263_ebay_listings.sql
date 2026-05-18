CREATE TABLE ebay_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sku TEXT,
  listing_price NUMERIC(10,2),
  buy_it_now_price NUMERIC(10,2),
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','sold','ended','relisted')),
  ebay_item_id TEXT,
  listed_at TIMESTAMPTZ,
  sold_at TIMESTAMPTZ,
  sold_price NUMERIC(10,2),
  fees NUMERIC(8,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ebay_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON ebay_listings FOR ALL USING (auth.uid() = user_id);
GRANT INSERT, UPDATE, DELETE ON ebay_listings TO service_role;
