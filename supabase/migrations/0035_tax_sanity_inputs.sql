-- Tax sanity-check input snapshots.
-- Stores the latest known YTD tax figures for guard-rail comparison against
-- baseline ratios (GST 2.5% of sales, CPP+income tax 0.2625% of sales).
-- Populated manually or by a future tax-import chunk.

CREATE TABLE tax_sanity_inputs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  total_sales   numeric(14,2) NOT NULL,
  gst_net_of_itcs numeric(12,2) NOT NULL,
  cpp_income_tax  numeric(12,2) NOT NULL,
  notes         text,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tax_sanity_inputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only"
  ON tax_sanity_inputs
  USING (auth.role() = 'service_role');

COMMENT ON TABLE tax_sanity_inputs IS
  'YTD tax input snapshots for guard-rail drift detection. Baseline: GST 2.5%, CPP+tax 0.2625% of sales.';
