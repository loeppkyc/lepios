-- Migration 0060: pallet_invoices — monthly pallet purchase invoices
--
-- Tracks gross pallet spending by month for COGS visibility.
-- Separate from cogs_entries (per-ASIN unit costs) — pallets are
-- tracked at invoice level, not per-ASIN.
--
-- Access model (matches 0054 pattern):
--   service_role  → full access (BYPASSRLS)
--   authenticated → DENY (no policy granted)
--   anon          → DENY (no policy granted)

CREATE TABLE public.pallet_invoices (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_month        date        NOT NULL,           -- stored as first of month (YYYY-MM-01)
  vendor               text        NOT NULL CHECK (length(trim(vendor)) > 0),
  pallets_count        int         NOT NULL CHECK (pallets_count > 0),
  total_cost_incl_gst  numeric(12,2) NOT NULL CHECK (total_cost_incl_gst > 0),
  gst_amount           numeric(12,2) NOT NULL CHECK (gst_amount >= 0),
  notes                text        NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pallet_invoices_month_idx ON public.pallet_invoices (invoice_month DESC);

ALTER TABLE public.pallet_invoices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.pallet_invoices IS
  'Monthly pallet invoice records. One row per vendor invoice. '
  'invoice_month always stored as first-of-month date. '
  'RLS enabled — service_role only, no policies granted.';

COMMENT ON COLUMN public.pallet_invoices.total_cost_incl_gst IS
  'Total invoice amount including GST (5% CA). '
  'Pre-GST cost = total_cost_incl_gst / 1.05.';

COMMENT ON COLUMN public.pallet_invoices.gst_amount IS
  'GST component: total_cost_incl_gst / 1.05 * 0.05. Editable for invoice-exact values.';
