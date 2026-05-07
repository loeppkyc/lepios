-- 0137_vehicles.sql
--
-- Vehicles + vehicle_maintenance tables (port from streamlit_app/pages/13_Vehicles.py).
-- Seeded with Tesla + Corolla per Streamlit data + Colin's 2026-05-06 corrections.
--
-- Designed to feed:
--   - /vehicles page (cards + maintenance log + AI valuation)
--   - balance_sheet_entries sync (Tesla/Corolla book value)
--   - Net Worth + Annual Review computations

CREATE TABLE IF NOT EXISTS public.vehicles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  year                integer NOT NULL,
  make                text NOT NULL,
  model               text NOT NULL,
  trim                text,
  classification      text NOT NULL CHECK (classification IN ('business', 'personal', 'mixed')),
  business_use_pct    integer NOT NULL DEFAULT 0 CHECK (business_use_pct BETWEEN 0 AND 100),

  -- Purchase
  purchased_at        date,
  purchase_price      numeric(12,2),
  km_at_purchase      integer,

  -- Current
  current_km          integer,
  current_value_estimate numeric(12,2),
  current_value_source   text,           -- 'manual' | 'ai_estimate' | 'qb_carry'
  current_value_notes    text,
  current_value_updated_at timestamptz,

  -- Loan
  loan_status         text NOT NULL DEFAULT 'paid_off' CHECK (loan_status IN ('paid_off', 'active', 'unknown')),
  loan_paid_off_at    date,
  loan_remaining      numeric(12,2),

  -- Misc
  notes               text,
  display_order       integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicles_classification_idx ON public.vehicles (classification);

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage vehicles" ON public.vehicles;
CREATE POLICY "Authenticated users can manage vehicles"
  ON public.vehicles FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

COMMENT ON TABLE public.vehicles IS
  'Vehicle fleet metadata. Drives /vehicles page + Tesla/Corolla book value in balance_sheet_entries.';

-- Maintenance log
CREATE TABLE IF NOT EXISTS public.vehicle_maintenance (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id          uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  service_date        date NOT NULL,
  km                  integer,
  service             text NOT NULL,
  cost                numeric(10,2),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_maintenance_vehicle_date_idx
  ON public.vehicle_maintenance (vehicle_id, service_date DESC);

ALTER TABLE public.vehicle_maintenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage vehicle maintenance"
  ON public.vehicle_maintenance;
CREATE POLICY "Authenticated users can manage vehicle maintenance"
  ON public.vehicle_maintenance FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

COMMENT ON TABLE public.vehicle_maintenance IS
  'Maintenance log per vehicle. service_date + km + service description + cost.';

-- Seed: Tesla + Corolla
INSERT INTO public.vehicles (
  name, year, make, model, trim, classification, business_use_pct,
  purchased_at, purchase_price, km_at_purchase,
  current_km, current_value_estimate, current_value_source, current_value_updated_at,
  loan_status, loan_paid_off_at, loan_remaining,
  notes, display_order
)
SELECT v.name, v.year, v.make, v.model, v.trim, v.classification, v.business_use_pct,
       v.purchased_at, v.purchase_price, v.km_at_purchase,
       v.current_km, v.current_value_estimate, v.current_value_source, v.current_value_updated_at,
       v.loan_status, v.loan_paid_off_at, v.loan_remaining,
       v.notes, v.display_order
FROM (VALUES
  (
    'Tesla Model Y', 2022, 'Tesla', 'Model Y', 'Long Range AWD',
    'business'::text, 100,
    '2025-01-15'::date, 40500.00::numeric, 72000,
    112800, 39500.00::numeric, 'qb_carry'::text, '2026-03-31 00:00:00+00'::timestamptz,
    'paid_off'::text, '2026-04-13'::date, 0::numeric,
    'Tax-free purchase via Megan (First Nations). Pembridge insurance combined w/ Corolla, 60/40 Tesla-heavy split. Tesla Premium Connectivity $14/mo. Tesla Extended Warranty $80/mo on Bonvoy. FSD canceled March 2026.',
    1
  ),
  (
    'Toyota Corolla', 2021, 'Toyota', 'Corolla', 'LE',
    'personal'::text, 0,
    '2021-01-01'::date, 30000.00::numeric, 0,
    194000, NULL, NULL, NULL,
    'paid_off'::text, '2024-12-31'::date, 0::numeric,
    'Tax-free (First Nations — Megan). Personal vehicle. $150/mo non-charging parking spot (personal). Corolla insurance is the 40% portion of the combined Pembridge $334.96/mo policy.',
    2
  )
) AS v(
  name, year, make, model, trim, classification, business_use_pct,
  purchased_at, purchase_price, km_at_purchase,
  current_km, current_value_estimate, current_value_source, current_value_updated_at,
  loan_status, loan_paid_off_at, loan_remaining,
  notes, display_order
)
WHERE NOT EXISTS (
  SELECT 1 FROM public.vehicles existing
  WHERE existing.year = v.year AND existing.make = v.make AND existing.model = v.model
);
