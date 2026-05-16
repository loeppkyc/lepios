-- Migration 0221: add person_handle to business_expenses
--
-- Adds joint Colin + Megan split tracking to the expense ledger.
-- person_handle identifies who pays: 'colin' (default), 'megan', or 'shared'.
-- split_pct is only meaningful when person_handle = 'shared'; NULL otherwise.
--
-- Backward-compatible: existing rows default to person_handle = 'colin',
-- split_pct = NULL. The 'Who Pays' selector in the UI sends these values on
-- every new insert going forward.
--
-- Conditional: uses ADD COLUMN IF NOT EXISTS so re-running is safe.

ALTER TABLE public.business_expenses
  ADD COLUMN IF NOT EXISTS person_handle TEXT NOT NULL DEFAULT 'colin'
    CHECK (person_handle IN ('colin', 'megan', 'shared'));

ALTER TABLE public.business_expenses
  ADD COLUMN IF NOT EXISTS split_pct SMALLINT
    CHECK (split_pct IS NULL OR (split_pct BETWEEN 1 AND 99));

COMMENT ON COLUMN public.business_expenses.person_handle IS
  'Who pays this expense: colin (default), megan, or shared. '
  'Shared expenses use split_pct to determine Colin''s portion.';

COMMENT ON COLUMN public.business_expenses.split_pct IS
  'Colin''s percentage of a shared expense (1–99). '
  'NULL for colin-only or megan-only rows. '
  '50 = 50/50 split. Megan share = 100 - split_pct.';

CREATE INDEX IF NOT EXISTS business_expenses_person_month_idx
  ON public.business_expenses (person_handle, date_trunc('month', date));

-- F24: GRANTs for service_role
GRANT INSERT, UPDATE, DELETE ON public.business_expenses TO service_role;
