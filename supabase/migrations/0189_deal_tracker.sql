-- MID batch 3: deal watchlist — replaces Google Sheets "Deal Tracker" + "Price History" tabs

CREATE TABLE IF NOT EXISTS public.deal_tracker_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product      text        NOT NULL,
  url          text,
  store        text,
  target_price numeric(10,2) NOT NULL,
  current_price numeric(10,2),
  last_checked_at timestamptz,
  alert_sent   boolean     NOT NULL DEFAULT false,
  added_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.deal_price_history (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id   uuid        NOT NULL REFERENCES public.deal_tracker_items(id) ON DELETE CASCADE,
  price     numeric(10,2) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_tracker_items_user_idx ON public.deal_tracker_items(user_id);
CREATE INDEX IF NOT EXISTS deal_price_history_item_idx ON public.deal_price_history(item_id, recorded_at DESC);

ALTER TABLE public.deal_tracker_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY deal_tracker_items_self
  ON public.deal_tracker_items FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY deal_price_history_self
  ON public.deal_price_history FOR ALL TO authenticated
  USING (item_id IN (SELECT id FROM public.deal_tracker_items WHERE user_id = auth.uid()))
  WITH CHECK (item_id IN (SELECT id FROM public.deal_tracker_items WHERE user_id = auth.uid()));

GRANT INSERT, UPDATE, DELETE ON public.deal_tracker_items TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.deal_price_history TO service_role;
