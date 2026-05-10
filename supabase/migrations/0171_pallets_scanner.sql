-- Migration 0171: pallets — individual physical pallet records for scanner
--
-- Distinct from pallet_invoices (monthly AP gross-spend tracker).
-- pallets = one row per physical pallet received; linked to scans via FK.
-- Pallet cost is estimated at intake; confirmed by AP table (sub-module 2, 0172).
--
-- Access: authenticated users full access (single-operator now;
--   SPRINT5-GATE: tighten to profiles.id per ARCHITECTURE.md §7.3).
--
-- Also adds scan_results.pallet_id FK so every scan can be attributed
-- to the pallet it came from.

CREATE TABLE public.pallets (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text          NOT NULL CHECK (length(trim(source)) > 0),
  intake_date  date          NOT NULL DEFAULT CURRENT_DATE,
  est_cost_cad numeric(10, 2) NULL,
  status       text          NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'closed', 'settled')),
  notes        text          NULL,
  created_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX pallets_status_intake_idx ON public.pallets (status, intake_date DESC);

ALTER TABLE public.pallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pallets_authenticated" ON public.pallets
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON TABLE public.pallets IS
  'Physical pallet records. One row per pallet received at intake. '
  'status: active (scanning in progress) | closed (done scanning) | settled (AP payment confirmed). '
  'est_cost_cad is estimated at intake; AP table (0172) holds the confirmed invoice cost.';

COMMENT ON COLUMN public.pallets.est_cost_cad IS
  'Estimated cost at intake. May be null if unknown. '
  'Confirmed cost lives in the AP table (sub-module 2).';

-- Link scan results to the pallet they were sourced from.
ALTER TABLE public.scan_results
  ADD COLUMN IF NOT EXISTS pallet_id uuid REFERENCES public.pallets (id) ON DELETE SET NULL;

CREATE INDEX scan_results_pallet_id_idx ON public.scan_results (pallet_id);
