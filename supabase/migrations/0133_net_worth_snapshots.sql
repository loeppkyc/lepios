-- 0133_net_worth_snapshots.sql
--
-- Net Worth page (docs/acceptance/net-worth.md):
--   1. Adapt existing public.net_worth_snapshots (created out-of-band by an
--      earlier draft, 0 rows at apply time) to the snapshot model used by
--      POST /api/net-worth/snapshot. Specifically:
--        - add breakdown jsonb (per-category and per-pillar capture)
--        - drop the UNIQUE constraint on snapshot_date (we want to allow
--          multiple snapshots per day; DB shouldn't gate the UX)
--        - drop NOT NULL on person_handle (single-user app — column is
--          unused by current routes; left in place for forward compat)
--        - enable RLS + add authenticated-only policy
--        - add a non-unique index on snapshot_date DESC for trend reads
--   2. Seed personal-side rows in existing balance_sheet_entries so the
--      Net Worth page surfaces fields Colin needs to fill in (Personal
--      Chequing, Savings, FHSA, RRSP, TFSA). All seeded at $0 — placeholders
--      ready for input.

-- ── 1. Adapt existing snapshot table ─────────────────────────────────────────
ALTER TABLE public.net_worth_snapshots
  ADD COLUMN IF NOT EXISTS breakdown jsonb;

ALTER TABLE public.net_worth_snapshots
  ALTER COLUMN person_handle DROP NOT NULL;

-- Drop the constraint first (owns the underlying unique index).
ALTER TABLE public.net_worth_snapshots
  DROP CONSTRAINT IF EXISTS net_worth_snapshots_snapshot_date_key;
DROP INDEX IF EXISTS public.net_worth_snapshots_snapshot_date_key;

CREATE INDEX IF NOT EXISTS net_worth_snapshots_date_idx
  ON public.net_worth_snapshots (snapshot_date DESC);

ALTER TABLE public.net_worth_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage net worth snapshots"
  ON public.net_worth_snapshots;
CREATE POLICY "Authenticated users can manage net worth snapshots"
  ON public.net_worth_snapshots
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

COMMENT ON TABLE public.net_worth_snapshots IS
  'Point-in-time wealth snapshots. Persisted by POST /api/net-worth/snapshot using totals computed from balance_sheet_entries (assets - liabilities, equity rows excluded). Drives the trend chart on /net-worth.';

COMMENT ON COLUMN public.net_worth_snapshots.breakdown IS
  'Optional JSON: { by_category: {...}, by_pillar: { business, personal } } captured at snapshot time for historical reference.';

-- ── 2. Seed personal-side balance_sheet_entries rows ─────────────────────────
INSERT INTO public.balance_sheet_entries (name, account_type, category, balance, as_of_date, sort_order)
SELECT v.name, v.account_type, v.category, v.balance, v.as_of_date, v.sort_order
FROM (VALUES
  ('TD Personal Chequing', 'asset', 'personal_bank',       0::numeric, CURRENT_DATE, 50),
  ('Personal Savings',     'asset', 'personal_bank',       0::numeric, CURRENT_DATE, 51),
  ('FHSA',                 'asset', 'personal_investment', 0::numeric, CURRENT_DATE, 52),
  ('RRSP',                 'asset', 'personal_investment', 0::numeric, CURRENT_DATE, 53),
  ('TFSA',                 'asset', 'personal_investment', 0::numeric, CURRENT_DATE, 54)
) AS v(name, account_type, category, balance, as_of_date, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.balance_sheet_entries bse WHERE bse.name = v.name
);
