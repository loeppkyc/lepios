-- Chunk B: Keepa BSR velocity fields
-- bsr_source tracks which data source populated the BSR value
ALTER TABLE public.scan_results
  ADD COLUMN IF NOT EXISTS bsr           INT,
  ADD COLUMN IF NOT EXISTS bsr_source    TEXT CHECK (bsr_source IN ('sp-api', 'keepa')),
  ADD COLUMN IF NOT EXISTS rank_drops_30 INT,
  ADD COLUMN IF NOT EXISTS monthly_sold  INT,
  ADD COLUMN IF NOT EXISTS avg_rank_90d  INT;
