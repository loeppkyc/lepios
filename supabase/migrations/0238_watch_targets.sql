-- 0238_watch_targets.sql
-- Deal Watcher: watch_targets + watch_events tables
-- Persistent Railway polling service monitors Amazon ASINs, LEGO.ca pages,
-- and generic URLs for restock / price-drop events and fires Telegram alerts.

CREATE TABLE public.watch_targets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('amazon-asin', 'lego-ca', 'generic-url')),
  url text,                          -- full URL for lego-ca and generic-url types
  asin text,                         -- for amazon-asin type
  lego_item_number text,             -- for lego-ca type (e.g. '10317')
  check_interval_min integer NOT NULL DEFAULT 10,
  alert_on text NOT NULL DEFAULT 'in_stock' CHECK (alert_on IN ('in_stock', 'price_drop', 'any_change')),
  threshold_price numeric,           -- for price_drop alert type
  last_status text,                  -- last known status string
  last_checked_at timestamptz,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.watch_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  watch_target_id uuid NOT NULL REFERENCES public.watch_targets(id) ON DELETE CASCADE,
  event_type text NOT NULL,          -- 'in_stock' | 'price_drop' | 'status_change' | 'error'
  old_value text,
  new_value text,
  message text,
  occurred_at timestamptz DEFAULT now()
);

CREATE INDEX idx_watch_events_target ON public.watch_events (watch_target_id, occurred_at DESC);
CREATE INDEX idx_watch_targets_active ON public.watch_targets (is_active, last_checked_at);

GRANT INSERT, UPDATE, DELETE ON public.watch_targets TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.watch_events TO service_role;

ALTER TABLE public.watch_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_events ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can read/write watch_targets.
-- The Railway service uses the service_role key which bypasses RLS.
CREATE POLICY "authenticated users can manage watch_targets"
  ON public.watch_targets
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated users can manage watch_events"
  ON public.watch_events
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
