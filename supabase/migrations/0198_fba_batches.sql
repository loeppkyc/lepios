-- Migration 0198: FBA Batch Manager tables (Sprint 6 Chunk D)
-- Branch: feat/sprint6-chunk-D-fba-batches
-- Depends on: 0197 (amazon_listings must exist)

CREATE TABLE IF NOT EXISTS fba_batches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- SPRINT5-GATE: replace person_handle with profiles FK
  person_handle text NOT NULL DEFAULT 'colin', -- SPRINT5-GATE
  name text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'shipped', 'closed')),
  source text,  -- e.g. 'GoodWill', 'Thrift', 'Estate'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fba_batch_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES fba_batches(id) ON DELETE CASCADE,
  scan_result_id uuid REFERENCES scan_results(id) ON DELETE SET NULL,
  amazon_listing_id uuid REFERENCES amazon_listings(id) ON DELETE SET NULL,
  sku text,  -- copied from amazon_listings.sku at time of add
  asin text NOT NULL,
  isbn text,
  title text,
  condition_code text,
  list_price_cad numeric(10,2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'listed', 'shipped')),
  added_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fba_batch_items_batch ON fba_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_fba_batches_person ON fba_batches(person_handle);

-- RLS: required per architecture invariant F-N6
ALTER TABLE public.fba_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_batch_items ENABLE ROW LEVEL SECURITY;

-- F24: required GRANTs for service_role
GRANT INSERT, UPDATE, DELETE ON fba_batches TO service_role;
GRANT INSERT, UPDATE, DELETE ON fba_batch_items TO service_role;
