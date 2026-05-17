-- Migration 0231: FBA Batches shipment planning columns (Sprint 8 Chunk C)
-- Branch: feat/sprint-8
-- Depends on: 0198 (fba_batches must exist)
--
-- Adds shipment_plan_id and shipment_status to fba_batches.
-- shipment_plan_id: Amazon ShipmentId returned from /fba/inbound/v0/plans
-- shipment_status: open → planned → shipped (extends the existing status column)
--
-- Note: fba_batches.status has a CHECK (status IN ('open', 'shipped', 'closed')).
-- The new shipment_status column is separate to avoid altering the existing constraint
-- and to capture the SP-API inbound shipment lifecycle independently.

ALTER TABLE public.fba_batches
  ADD COLUMN IF NOT EXISTS shipment_plan_id TEXT,
  ADD COLUMN IF NOT EXISTS shipment_status TEXT NOT NULL DEFAULT 'open'
    CHECK (shipment_status IN ('open', 'planned', 'shipped'));

COMMENT ON COLUMN public.fba_batches.shipment_plan_id IS
  'Amazon ShipmentId from POST /fba/inbound/v0/plans. NULL until a plan is created.';
COMMENT ON COLUMN public.fba_batches.shipment_status IS
  'SP-API inbound shipment lifecycle: open → planned (plan created) → shipped.';

CREATE INDEX IF NOT EXISTS idx_fba_batches_shipment_status ON public.fba_batches(shipment_status);

-- F24 compliance: GRANT on existing table for service_role write access
-- (F24 applies to CREATE TABLE; included here as belt-and-suspenders since
-- 0198 already has the GRANT — re-running is safe, GRANT is idempotent)
GRANT INSERT, UPDATE, DELETE ON public.fba_batches TO service_role;
