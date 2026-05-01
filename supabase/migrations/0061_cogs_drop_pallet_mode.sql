-- Migration 0061: cogs_entries — drop pallet pricing_model constraints
--
-- pallet_invoices (0060) is now the home for pallet-level spend.
-- cogs_entries is per_unit only going forward.
--
-- NOT VALID: constraint added without validating existing rows so any
-- historical pallet entries (likely zero) remain intact.
-- The pricing_model column is kept — change only affects constraint set.

ALTER TABLE public.cogs_entries
  DROP CONSTRAINT IF EXISTS cogs_entries_pricing_model_check,
  DROP CONSTRAINT IF EXISTS cogs_unit_cost_model_check;

ALTER TABLE public.cogs_entries
  ADD CONSTRAINT cogs_pricing_per_unit_only
    CHECK (pricing_model = 'per_unit') NOT VALID;

ALTER TABLE public.cogs_entries
  ADD CONSTRAINT cogs_unit_cost_required
    CHECK (unit_cost_cad IS NOT NULL AND unit_cost_cad > 0) NOT VALID;

COMMENT ON COLUMN public.cogs_entries.pricing_model IS
  'Always per_unit as of migration 0061. pallet invoices tracked separately in pallet_invoices table.';
