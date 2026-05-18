-- External Benchmarking Layer
-- Stores competitive parity scores vs named external systems.
-- Each row = one timestamped measurement for (benchmark_name, vs_system).
-- Series of parity_score over time = growth curve (F17/F18).

CREATE TABLE public.external_benchmarks (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_name TEXT          NOT NULL,
  vs_system      TEXT          NOT NULL,
  parity_score   NUMERIC(5,2)  NOT NULL CHECK (parity_score >= 0 AND parity_score <= 100),
  notes          TEXT,
  measured_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_eb_vs_system_measured ON public.external_benchmarks (vs_system, measured_at DESC);
CREATE INDEX idx_eb_measured_at ON public.external_benchmarks (measured_at DESC);

ALTER TABLE public.external_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "external_benchmarks_authenticated" ON public.external_benchmarks
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- F24 required: service_role write access
GRANT INSERT, UPDATE, DELETE ON public.external_benchmarks TO service_role;
