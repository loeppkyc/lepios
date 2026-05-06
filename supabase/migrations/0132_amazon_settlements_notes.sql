-- 0132_amazon_settlements_notes.sql
--
-- Adds a free-text `notes` column to amazon_settlements for audit trail.
-- Use cases:
--   • Record matching Seller Central disbursement IDs
--   • Capture manual correction reasons (e.g., "matched bank deposit X on Y")
--   • Operator memos when reviewing settlement variance
--
-- Closes the audit-trail gap identified in docs/acceptance/payouts.md (the
-- Streamlit page tracks notes on each payout row; LepiOS had no equivalent).
--
-- API layer (app/api/payouts/[id]/notes/route.ts) caps length at 500 chars
-- and treats empty string as NULL — DB column is permissive (no length
-- constraint) to preserve flexibility if cap changes later.

ALTER TABLE public.amazon_settlements
  ADD COLUMN notes text NULL;

COMMENT ON COLUMN public.amazon_settlements.notes IS
  'Free-text audit trail: Seller Central disbursement IDs, manual correction reasons, operator memos. Nullable. Length cap (500 chars) enforced at API layer.';
