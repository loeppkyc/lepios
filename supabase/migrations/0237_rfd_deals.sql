-- 0235_rfd_deals.sql
-- RFD deal watcher: stores hot deals from RedFlagDeals RSS and keyword watch list.

CREATE TABLE public.rfd_deals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rfd_guid text UNIQUE NOT NULL,
  title text NOT NULL,
  description text,
  store text,
  rfd_url text NOT NULL,
  deal_url text,
  posted_at timestamptz,
  keywords_matched text[] DEFAULT '{}',
  category text DEFAULT 'general',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_rfd_deals_posted_at ON public.rfd_deals (posted_at DESC);
CREATE INDEX idx_rfd_deals_keywords ON public.rfd_deals USING gin (keywords_matched);

CREATE TABLE public.rfd_watch_keywords (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

INSERT INTO public.rfd_watch_keywords (keyword, category) VALUES
  ('lego', 'resale'),
  ('nintendo switch', 'resale'),
  ('ipad', 'resale'),
  ('dyson', 'personal'),
  ('instant pot', 'personal'),
  ('air fryer', 'personal'),
  ('protein powder', 'personal'),
  ('ps5', 'resale'),
  ('xbox', 'resale'),
  ('costco', 'grocery'),
  ('walmart grocery', 'grocery');

GRANT INSERT, UPDATE, DELETE ON public.rfd_deals TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.rfd_watch_keywords TO service_role;
