-- 0136_savings_goals.sql
--
-- Savings Goals page: define a target ($X by date), track against current
-- balance of a linked account row in balance_sheet_entries.
--
-- linked_entry_name is the name field from balance_sheet_entries (e.g. "FHSA",
-- "RRSP", "TFSA", "Personal Savings"). Loose coupling — no FK because a name
-- might be edited and we don't want goals to cascade-delete.

CREATE TABLE IF NOT EXISTS public.savings_goals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  target_amount       numeric(14,2) NOT NULL,
  target_date         date NOT NULL,
  linked_entry_name   text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS savings_goals_target_date_idx
  ON public.savings_goals (target_date);

ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage savings goals"
  ON public.savings_goals;
CREATE POLICY "Authenticated users can manage savings goals"
  ON public.savings_goals
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

COMMENT ON TABLE public.savings_goals IS
  'User-defined savings targets. Track against linked_entry_name in balance_sheet_entries (FHSA/RRSP/TFSA/etc). Loose coupling by name, not FK.';

-- Seed a sample goal — Colin can edit/delete
INSERT INTO public.savings_goals (name, target_amount, target_date, linked_entry_name, notes)
SELECT v.name, v.target_amount, v.target_date, v.linked_entry_name, v.notes
FROM (VALUES
  ('Max FHSA contribution',    8000.00::numeric, '2026-12-31'::date, 'FHSA', 'Annual FHSA contribution limit. Currently $8k contributed; need to verify if room for more.'),
  ('Build $25k emergency fund', 25000.00::numeric, '2027-12-31'::date, 'Personal Savings', '6 months of household expenses. Currently $0 dedicated emergency fund.')
) AS v(name, target_amount, target_date, linked_entry_name, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.savings_goals g WHERE g.name = v.name
);
