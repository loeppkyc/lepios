-- Migration 0173: scanner tier + routing columns + bbv_outbox stub
--
-- Sub-module 3: scanner revamp with tier classifier + 3-way GO/BBV/DONATE routing.
-- Adds enrichment columns to scan_results and a BBV outbox table for dual-write stub.

-- ── scan_results enrichment ───────────────────────────────────────────────
-- author: SP-API contributor field (null if unavailable)
-- binding: SP-API binding field (Paperback/Hardcover/etc.)
-- tier: COLLECTIBLE | HIGH_DEMAND | STANDARD (computed by tier-classifier.ts)
-- routing_decision: go | bbv | donate (set after user picks; null = pending)

ALTER TABLE public.scan_results
  ADD COLUMN IF NOT EXISTS author           text NULL,
  ADD COLUMN IF NOT EXISTS binding          text NULL,
  ADD COLUMN IF NOT EXISTS tier             text NULL
    CHECK (tier IN ('COLLECTIBLE', 'HIGH_DEMAND', 'STANDARD')),
  ADD COLUMN IF NOT EXISTS routing_decision text NULL
    CHECK (routing_decision IN ('go', 'bbv', 'donate'));

-- ── bbv_outbox ────────────────────────────────────────────────────────────
-- Books staged for BBV store listing.
-- Dual-write is disabled by default (bbv.dual_write_enabled = 'false' in harness_config).
-- BBV side reads and clears this table when it's ready to accept writes.

CREATE TABLE public.bbv_outbox (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_result_id   uuid         NOT NULL REFERENCES public.scan_results (id) ON DELETE CASCADE,
  isbn             text         NOT NULL,
  asin             text         NOT NULL,
  title            text         NULL,
  author           text         NULL,
  tier             text         NOT NULL CHECK (tier IN ('COLLECTIBLE', 'HIGH_DEMAND', 'STANDARD')),
  cost_paid_cad    numeric(10, 2) NULL,
  buy_box_price_cad numeric(10, 2) NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  synced_at        timestamptz  NULL  -- NULL = pending sync to BBV
);

CREATE INDEX bbv_outbox_synced_at_idx ON public.bbv_outbox (synced_at NULLS FIRST);
CREATE INDEX bbv_outbox_scan_result_id_idx ON public.bbv_outbox (scan_result_id);

ALTER TABLE public.bbv_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bbv_outbox_service_role"
  ON public.bbv_outbox
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.bbv_outbox IS
  'BBV dual-write outbox — books routed GO+BBV by the scanner. '
  'synced_at NULL = awaiting sync. Set bbv.dual_write_enabled=true in harness_config to activate. '
  'BBV side controls its own write schedule (Option B architecture).';

-- ── harness_config seed ───────────────────────────────────────────────────

INSERT INTO public.harness_config (key, value)
VALUES ('bbv.dual_write_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
