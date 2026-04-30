-- 0056_gst_columns.sql
-- Add pretax_amount, gst_amount, is_zero_gst to utility_bills.
--
-- Backfill formula matches lib/tax/gst.ts splitGst() — backward split:
--   pretax = round(amount_cad / 1.05, 2)
--   gst    = round(amount_cad - pretax, 2)
--
-- PostgreSQL numeric arithmetic is exact decimal, so:
--   pretax_cents + gst_cents = amount_cad_cents exactly for all 2dp inputs.
--   Proof: gst = amount_cad - pretax; both are integer cents / 100; no rounding drift.
--
-- Electricity (Metergy) is GST-applicable in Alberta — is_zero_gst = false
-- for all existing rows. No utility_bills rows carry ZERO_GST categories.

ALTER TABLE utility_bills
  ADD COLUMN pretax_amount numeric(12,2),
  ADD COLUMN gst_amount    numeric(12,2),
  ADD COLUMN is_zero_gst   boolean NOT NULL DEFAULT false;

-- Backfill existing rows. gst = amount_cad - pretax (not pretax * 0.05)
-- to guarantee pretax + gst = amount_cad to the cent.
UPDATE utility_bills
SET
  pretax_amount = round(amount_cad / 1.05::numeric, 2),
  gst_amount    = round(amount_cad - round(amount_cad / 1.05::numeric, 2), 2),
  is_zero_gst   = false;

-- Promote to NOT NULL after successful backfill.
ALTER TABLE utility_bills
  ALTER COLUMN pretax_amount SET NOT NULL,
  ALTER COLUMN gst_amount    SET NOT NULL;

-- Index for ITC aggregation queries (GST return tab, annual totals).
CREATE INDEX utility_bills_gst_amount_idx ON utility_bills (gst_amount);

COMMENT ON COLUMN utility_bills.pretax_amount IS
  'Pre-GST amount in CAD. Computed from amount_cad / 1.05, rounded to 2dp.';
COMMENT ON COLUMN utility_bills.gst_amount IS
  'GST portion in CAD. = amount_cad - pretax_amount (no drift by construction).';
COMMENT ON COLUMN utility_bills.is_zero_gst IS
  'True if category is GST-exempt/zero-rated under Canadian ETA. False for electricity.';
