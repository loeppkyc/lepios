-- 0227_food_catalog.sql
-- Master food nutrition database for the household.
-- Powers dietary tracking, blood-test nutrient correlation, and grocery price comparison.
-- Source can be Open Food Facts (auto-seeded), USDA, or manual entry.

CREATE TABLE public.food_catalog (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text          NOT NULL,
  brand               text,
  barcode             text,
  category            text          NOT NULL DEFAULT 'Other' CHECK (category IN (
                        'Produce', 'Dairy', 'Meat', 'Bakery', 'Frozen',
                        'Pantry', 'Beverage', 'Snack', 'Other'
                      )),
  serving_size        numeric(10,2),
  serving_unit        text          NOT NULL DEFAULT 'g',
  calories            numeric(8,2),
  protein_g           numeric(8,2),
  fat_g               numeric(8,2),
  saturated_fat_g     numeric(8,2),
  carbs_g             numeric(8,2),
  sugar_g             numeric(8,2),
  fiber_g             numeric(8,2),
  sodium_mg           numeric(8,2),
  cholesterol_mg      numeric(8,2),
  is_household_staple boolean       NOT NULL DEFAULT false,
  source              text          NOT NULL DEFAULT 'manual' CHECK (source IN (
                        'open_food_facts', 'manual', 'usda'
                      )),
  off_id              text,
  verified            boolean       NOT NULL DEFAULT false,
  notes               text          NOT NULL DEFAULT '',
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (name, brand)
);

ALTER TABLE public.food_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "food_catalog_authenticated"
  ON public.food_catalog FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX idx_food_catalog_name     ON public.food_catalog (name);
CREATE INDEX idx_food_catalog_category ON public.food_catalog (category);
CREATE INDEX idx_food_catalog_staple   ON public.food_catalog (is_household_staple)
  WHERE is_household_staple = true;
CREATE INDEX idx_food_catalog_barcode  ON public.food_catalog (barcode)
  WHERE barcode IS NOT NULL;

CREATE OR REPLACE FUNCTION update_food_catalog_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER food_catalog_updated_at
  BEFORE UPDATE ON public.food_catalog
  FOR EACH ROW EXECUTE FUNCTION update_food_catalog_updated_at();

GRANT INSERT, UPDATE, DELETE ON public.food_catalog TO service_role;
