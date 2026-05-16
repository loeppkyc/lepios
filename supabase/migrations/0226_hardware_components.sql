-- 0226_hardware_components.sql
-- PC build component tracker. One row per hardware component in Colin's build.

CREATE TABLE public.hardware_components (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  person_handle text          NOT NULL DEFAULT 'colin', -- SPRINT5-GATE
  name          text          NOT NULL,                          -- e.g. "RTX 4070 Ti Super"
  category      text          NOT NULL CHECK (category IN (
                  'CPU', 'GPU', 'RAM', 'Storage', 'Cooling',
                  'Chassis', 'PSU', 'Motherboard', 'Peripherals', 'Other'
                )),
  status        text          NOT NULL DEFAULT 'planned' CHECK (status IN (
                  'planned', 'ordered', 'received', 'installed'
                )),
  budget_cad    numeric(10,2),                                   -- planned spend
  actual_cad    numeric(10,2),                                   -- what was paid
  product_url   text,                                            -- link to product page
  notes         text,
  added_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_hardware_components_person ON public.hardware_components(person_handle);
CREATE INDEX idx_hardware_components_category ON public.hardware_components(category);

ALTER TABLE public.hardware_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hardware_components_authenticated"
  ON public.hardware_components FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

GRANT INSERT, UPDATE, DELETE ON public.hardware_components TO service_role;
