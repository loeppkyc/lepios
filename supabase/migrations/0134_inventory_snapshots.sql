-- 0134_inventory_snapshots.sql
--
-- Periodic inventory COGS for Life P&L (docs/acceptance/life-pnl-real-cogs.md):
--   1. New table inventory_snapshots — one row per (snapshot_date) capturing
--      inventory value at end-of-day. Drives periodic COGS:
--        Period COGS = beginning_inventory + purchases - ending_inventory + fba_fees
--   2. Seed two anchor snapshots:
--        2026-03-31: $153,403.87 (QB-as-of-Mar-31, Colin-confirmed authoritative)
--        2026-05-06: $10,000.00  (Colin's estimate 2026-05-06 session)
--
-- The unique constraint on snapshot_date prevents accidental duplicates;
-- Colin's UI uses POST for new dates and PATCH to revise existing.

CREATE TABLE IF NOT EXISTS public.inventory_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  value_at_cost numeric(14,2) NOT NULL,
  source        text NOT NULL DEFAULT 'manual',
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_snapshots_date_unique UNIQUE (snapshot_date)
);

CREATE INDEX IF NOT EXISTS inventory_snapshots_date_idx
  ON public.inventory_snapshots (snapshot_date DESC);

ALTER TABLE public.inventory_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage inventory snapshots"
  ON public.inventory_snapshots
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

COMMENT ON TABLE public.inventory_snapshots IS
  'Inventory-at-cost snapshots powering periodic COGS recognition in Life P&L. snapshot_date represents end-of-day value. UNIQUE on date — use PATCH to revise. Drives /api/pnl periodic-inventory math: COGS_month = β + Purchases − E + FBA fees.';

COMMENT ON COLUMN public.inventory_snapshots.source IS
  'Origin of value: manual (user entry), qb_import (QuickBooks balance sheet), computed (derived later).';

-- Seed anchor snapshots
INSERT INTO public.inventory_snapshots (snapshot_date, value_at_cost, source, notes)
SELECT v.snapshot_date, v.value_at_cost, v.source, v.notes
FROM (VALUES
  ('2026-03-31'::date, 153403.87::numeric, 'qb_import', 'QuickBooks balance sheet — Inventory On Hand (Estimated). Colin-confirmed authoritative as Q1 close.'),
  ('2026-05-06'::date,  10000.00::numeric, 'manual',    'Colin estimate at 2026-05-06: "I only have about 10k in inventory left."')
) AS v(snapshot_date, value_at_cost, source, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.inventory_snapshots s WHERE s.snapshot_date = v.snapshot_date
);
