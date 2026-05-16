-- 0225_local_sales.sql
-- In-person sales from Square terminal, ingested via webhook.
-- One row per completed Square payment.
-- B5 acceptance doc: docs/backlog/tier-b/B5-acceptance.md

CREATE TABLE public.local_sales (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  person_handle      text          NOT NULL DEFAULT 'colin', -- SPRINT5-GATE: replace with profiles FK
  square_payment_id  text          NOT NULL UNIQUE,
  amount_cad         numeric(10,2) NOT NULL,  -- amount in CAD (Square sends in cents; converted on ingest)
  currency           text          NOT NULL DEFAULT 'CAD',
  payment_method     text,         -- CARD, CASH, OTHER (derived from Square tender type)
  location_id        text,         -- Square location ID (multi-location future-proofing)
  square_created_at  timestamptz   NOT NULL,  -- Square's payment.created_at (not our insert time)
  raw_event          jsonb,        -- full Square webhook payload for debugging/backfill
  inserted_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_local_sales_person_created ON public.local_sales(person_handle, square_created_at DESC);
CREATE INDEX idx_local_sales_square_payment_id ON public.local_sales(square_payment_id);

ALTER TABLE public.local_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "local_sales_authenticated"
  ON public.local_sales FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- F24: service_role grants required for webhook insert path (RLS bypass for webhook ingestion)
GRANT INSERT, UPDATE, DELETE ON public.local_sales TO service_role;
