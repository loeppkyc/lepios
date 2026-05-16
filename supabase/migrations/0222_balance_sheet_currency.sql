-- 0222_balance_sheet_currency.sql
-- Adds currency column to balance_sheet_entries.
-- Default: CAD. Only CAD and USD supported in v1.
-- C6 acceptance doc: docs/backlog/tier-c/C6-acceptance.md

ALTER TABLE public.balance_sheet_entries
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CAD'
  CHECK (currency IN ('CAD', 'USD'));

COMMENT ON COLUMN public.balance_sheet_entries.currency IS
  'ISO 4217 currency code for the balance value. Supported: CAD (default), USD. '
  'CAD rows are displayed as-is. USD rows are converted to CAD at display time '
  'using the Bank of Canada FXUSDCAD daily rate. Source balance is stored in native currency.';

-- Mark the TD USD Chequing row (and any other USD-named rows) as USD.
-- Targets rows with 'USD' or 'U.S.' in the name.
-- Builder note: coordinator confirmed via acceptance doc that ILIKE '%USD%' OR ILIKE '%U.S.%' is the right filter.
UPDATE public.balance_sheet_entries
  SET currency = 'USD'
  WHERE name ILIKE '%USD%' OR name ILIKE '%U.S.%';

-- F24: balance_sheet_entries already has GRANT INSERT, UPDATE, DELETE from migration 0213.
-- No new grant needed here.
-- AD7-exempt: additive column only, grants inherited from 0213.
