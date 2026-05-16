-- 0224_arb_decisions.sql
-- Arbitrage training corpus: every scan decision captured for future LoRA fine-tune (B3).
-- One row per scan decision event. NOT a replacement for scan_results — a training shadow.

CREATE TABLE public.arb_decisions (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_result_id    uuid          REFERENCES public.scan_results(id) ON DELETE SET NULL,
  person_handle     text          NOT NULL DEFAULT 'colin', -- SPRINT5-GATE: tie to user profile FK
  asin              text          NOT NULL,
  isbn              text,
  title             text,
  decision          text          NOT NULL CHECK (decision IN ('buy', 'skip', 'unsure')),
  confidence_pct    integer       CHECK (confidence_pct BETWEEN 0 AND 100),
  -- Scan context snapshot (denormalized so training rows are self-contained)
  cost_paid_cad     numeric(10,2),
  buy_box_price_cad numeric(10,2),
  profit_cad        numeric(10,2),
  roi_pct           numeric(6,2),
  bsr               integer,      -- BSR at time of scan (from Keepa/SP-API)
  tier              text          CHECK (tier IN ('COLLECTIBLE', 'HIGH_DEMAND', 'STANDARD')),
  notes             text,         -- freeform context (e.g. "condition issue", "price dropped")
  -- Outcome tracking (populated by arb-outcome-backfill cron)
  outcome           text          CHECK (outcome IN ('sold_attempted', 'no_listing', 'pending')),
  outcome_checked_at timestamptz,
  decided_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_arb_decisions_asin ON public.arb_decisions(asin);
CREATE INDEX idx_arb_decisions_person_decided ON public.arb_decisions(person_handle, decided_at DESC);
CREATE INDEX idx_arb_decisions_outcome_null ON public.arb_decisions(outcome) WHERE outcome IS NULL;

ALTER TABLE public.arb_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "arb_decisions_authenticated"
  ON public.arb_decisions FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

GRANT INSERT, UPDATE, DELETE ON public.arb_decisions TO service_role;
