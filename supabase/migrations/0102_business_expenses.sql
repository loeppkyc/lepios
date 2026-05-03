-- Migration 0102: business_expenses
--
-- Business expense ledger. One row per expense entry.
-- Recurring expenses (monthly/annual) are stored as individual rows.
-- business_use_pct encodes the deductible portion (100 = fully business, 0 = personal).
--
-- Access model:
--   authenticated → full CRUD via RLS policy (auth.uid() IS NOT NULL)
--   anon          → DENY

CREATE TABLE public.business_expenses (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  date             DATE          NOT NULL,
  vendor           TEXT          NOT NULL,
  category         TEXT          NOT NULL,
  pretax           NUMERIC(10,2) NOT NULL CHECK (pretax > 0),
  tax_amount       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  payment_method   TEXT          NOT NULL,
  hubdoc           BOOLEAN       NOT NULL DEFAULT false,
  notes            TEXT          NOT NULL DEFAULT '',
  business_use_pct SMALLINT      NOT NULL DEFAULT 100
                     CHECK (business_use_pct BETWEEN 0 AND 100),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX business_expenses_date_idx     ON public.business_expenses (date DESC);
CREATE INDEX business_expenses_category_idx ON public.business_expenses (category);

ALTER TABLE public.business_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_expenses_authenticated"
  ON public.business_expenses FOR ALL
  USING  (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER business_expenses_set_updated_at
  BEFORE UPDATE ON public.business_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.business_expenses IS
  'Business expense ledger. Recurring entries stored as individual rows. '
  'business_use_pct: 100=fully deductible, 0=personal tracking only, 1-99=mixed.';
