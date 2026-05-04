-- Migration 0114: recurring_expense_templates
--
-- Stores subscription/recurring expense definitions that auto-generate
-- business_expenses rows each month on demand.
-- business_expenses.recurring_template_id links generated rows back to their template
-- so re-generation is idempotent (no double-entries).

CREATE TABLE public.recurring_expense_templates (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor           TEXT          NOT NULL,
  category         TEXT          NOT NULL,
  pretax           NUMERIC(10,2) NOT NULL CHECK (pretax > 0),
  tax_amount       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  payment_method   TEXT          NOT NULL,
  day_of_month     SMALLINT      NOT NULL DEFAULT 1
                     CHECK (day_of_month BETWEEN 1 AND 28),
  frequency        TEXT          NOT NULL DEFAULT 'monthly'
                     CHECK (frequency IN ('monthly', 'annual')),
  annual_month     SMALLINT      CHECK (annual_month BETWEEN 1 AND 12),
  notes            TEXT          NOT NULL DEFAULT '',
  business_use_pct SMALLINT      NOT NULL DEFAULT 100
                     CHECK (business_use_pct BETWEEN 0 AND 100),
  active           BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- annual templates must specify which month they fire
  CONSTRAINT annual_requires_month CHECK (
    frequency = 'monthly' OR annual_month IS NOT NULL
  )
);

ALTER TABLE public.recurring_expense_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recurring_templates_authenticated"
  ON public.recurring_expense_templates FOR ALL
  USING  (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE TRIGGER recurring_templates_set_updated_at
  BEFORE UPDATE ON public.recurring_expense_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Link generated expense rows back to the template (SET NULL on template delete
-- so the expense row is kept but unlinked).
ALTER TABLE public.business_expenses
  ADD COLUMN recurring_template_id UUID
    REFERENCES public.recurring_expense_templates(id) ON DELETE SET NULL;

CREATE INDEX recurring_expense_templates_active_idx
  ON public.recurring_expense_templates (active);

CREATE INDEX business_expenses_recurring_template_idx
  ON public.business_expenses (recurring_template_id)
  WHERE recurring_template_id IS NOT NULL;

COMMENT ON TABLE public.recurring_expense_templates IS
  'Subscription / recurring expense definitions. Use POST /api/expenses/recurring/generate '
  'to materialise rows into business_expenses for a given month. Idempotent: existing rows '
  'for a (template, month) pair are not re-inserted.';
