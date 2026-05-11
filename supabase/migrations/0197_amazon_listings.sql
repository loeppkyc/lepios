-- Migration 0197: amazon_listings table for List on Amazon feature (Sprint 6 Chunk A)
-- Branch: feat/sprint6-chunk-A-list-on-amazon

CREATE TABLE IF NOT EXISTS amazon_listings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- SPRINT5-GATE: replace person_handle with profiles FK
  person_handle text NOT NULL DEFAULT 'colin', -- SPRINT5-GATE
  scan_result_id uuid REFERENCES scan_results(id) ON DELETE SET NULL,
  sku text NOT NULL UNIQUE,
  asin text NOT NULL,
  isbn text,
  title text,
  condition_code text NOT NULL CHECK (condition_code IN ('like_new','very_good','used_good','acceptable')),
  condition_note text CHECK (char_length(condition_note) <= 1000),
  list_price_cad numeric(10,2) NOT NULL CHECK (list_price_cad > 0),
  sp_api_status text, -- ACCEPTED | VALID | INVALID | ERROR
  sp_api_issues jsonb,
  listed_at timestamptz DEFAULT now()
);

CREATE INDEX idx_amazon_listings_scan_result ON amazon_listings(scan_result_id);
CREATE INDEX idx_amazon_listings_asin ON amazon_listings(asin);
CREATE INDEX idx_amazon_listings_person ON amazon_listings(person_handle);

-- RLS: required per architecture invariant F-N6
ALTER TABLE public.amazon_listings ENABLE ROW LEVEL SECURITY;

-- F24: required GRANT for service_role
GRANT INSERT, UPDATE, DELETE ON amazon_listings TO service_role;
