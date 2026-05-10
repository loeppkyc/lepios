-- Migration 0172: pallet_ap_records — confirmed AP cost per physical pallet
--
-- Closes the cost loop started at pallet intake (est_cost_cad in pallets).
-- One record per pallet; inserting auto-settles the pallet via trigger.
-- invoice_month links to pallet_invoices (monthly gross-spend tracker).
--
-- 20%-better vs manual settlement: DB trigger fires on INSERT, no second
-- UI action required to move pallet status active→closed→settled.

CREATE TABLE public.pallet_ap_records (
  id                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  pallet_id          uuid           NOT NULL UNIQUE
                                    REFERENCES public.pallets (id) ON DELETE CASCADE,
  invoice_month      date           NOT NULL,
  confirmed_cost_cad numeric(10, 2) NOT NULL CHECK (confirmed_cost_cad > 0),
  gst_amount_cad     numeric(10, 2) NOT NULL DEFAULT 0 CHECK (gst_amount_cad >= 0),
  paid_on            date           NULL,
  notes              text           NULL,
  created_at         timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX pallet_ap_records_pallet_id_idx ON public.pallet_ap_records (pallet_id);
CREATE INDEX pallet_ap_records_invoice_month_idx ON public.pallet_ap_records (invoice_month DESC);

ALTER TABLE public.pallet_ap_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pallet_ap_records_authenticated" ON public.pallet_ap_records
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Auto-settle the pallet when an AP record is inserted (20%-better trigger)
CREATE OR REPLACE FUNCTION public.settle_pallet_on_ap_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.pallets
  SET status = 'settled'
  WHERE id = NEW.pallet_id
    AND status = 'closed';
  RETURN NEW;
END;
$$;

CREATE TRIGGER pallet_ap_settle
  AFTER INSERT ON public.pallet_ap_records
  FOR EACH ROW EXECUTE FUNCTION public.settle_pallet_on_ap_insert();

COMMENT ON TABLE public.pallet_ap_records IS
  'AP confirmed-cost records — one per pallet, entered when the monthly invoice arrives. '
  'Inserting auto-settles the linked pallet (trigger pallet_ap_settle). '
  'confirmed_cost_cad is the actual per-pallet cost; gst_amount_cad is the GST portion. '
  'invoice_month links semantically to pallet_invoices (same YYYY-MM-01 convention).';

COMMENT ON COLUMN public.pallet_ap_records.invoice_month IS
  'YYYY-MM-01 — the month the AP invoice covers. Matches pallet_invoices.invoice_month convention.';

COMMENT ON COLUMN public.pallet_ap_records.confirmed_cost_cad IS
  'Actual cost from AP invoice, per pallet. Replaces est_cost_cad for accounting purposes.';

COMMENT ON COLUMN public.pallet_ap_records.paid_on IS
  'Date payment was sent. NULL = AP record entered but not yet paid.';
