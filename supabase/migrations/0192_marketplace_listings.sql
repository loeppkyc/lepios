-- Reselling cluster: marketplace_listings
-- Replaces Google Sheets "Marketplace Hub" tab (eBay / FB / Kijiji cross-listing tracker)

CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sku             text,
  title           text          NOT NULL,
  source          text          NOT NULL DEFAULT 'amazon', -- 'amazon' | 'books' | 'manual'
  asin            text,
  isbn            text,
  list_price      numeric(10,2),
  -- per-channel status: 'none' | 'active' | 'sold' | 'ended'
  ebay_status     text          NOT NULL DEFAULT 'none',
  ebay_listed_at  timestamptz,
  ebay_sold_at    timestamptz,
  ebay_sold_price numeric(10,2),
  fb_status       text          NOT NULL DEFAULT 'none',
  fb_listed_at    timestamptz,
  fb_sold_at      timestamptz,
  fb_sold_price   numeric(10,2),
  kijiji_status   text          NOT NULL DEFAULT 'none',
  kijiji_listed_at timestamptz,
  kijiji_sold_at  timestamptz,
  kijiji_sold_price numeric(10,2),
  notes           text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_listings_user_idx ON public.marketplace_listings(user_id);
CREATE INDEX IF NOT EXISTS marketplace_listings_sku_idx  ON public.marketplace_listings(sku);
CREATE INDEX IF NOT EXISTS marketplace_listings_asin_idx ON public.marketplace_listings(asin);

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketplace_listings_self
  ON public.marketplace_listings FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT INSERT, UPDATE, DELETE ON public.marketplace_listings TO service_role;
