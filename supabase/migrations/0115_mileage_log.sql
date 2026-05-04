-- Migration 0115: Mileage log (CRA-compliant vehicle trip log)
-- Each row = one trip. Captures date, from/to, km, purpose.
-- round_trip doubles the km client-side; stored km is actual one-way distance.
-- Business use % for vehicle expenses = sum(km) / annual_km × 100.

CREATE TABLE public.mileage_log (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  date          DATE         NOT NULL,
  from_location TEXT         NOT NULL,
  to_location   TEXT         NOT NULL,
  km            NUMERIC(8,1) NOT NULL CHECK (km > 0),
  purpose       TEXT         NOT NULL,
  round_trip    BOOLEAN      NOT NULL DEFAULT false,
  notes         TEXT         NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mileage_log IS
  'CRA-compliant vehicle mileage log. One row per trip. '
  'km = one-way distance; round_trip flag signals client to double it. '
  'Business use % = annual logged km / total annual km (entered by user).';

CREATE INDEX mileage_log_date_idx ON public.mileage_log (date);

ALTER TABLE public.mileage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mileage_log_authenticated" ON public.mileage_log
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE TRIGGER mileage_log_updated_at
  BEFORE UPDATE ON public.mileage_log
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Rollback:
--   DROP TABLE IF EXISTS public.mileage_log;
