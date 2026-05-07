-- 0135_life_milestones.sql
--
-- Annual Review (docs/acceptance/annual-review.md):
--   life_milestones table — major quality-of-life events that don't show
--   up in P&L but matter for Colin's actual life-progress measurement.
--   Drives the milestones timeline on /annual-review.
--
-- Categories are gated by CHECK constraint to keep filtering predictable.

CREATE TABLE IF NOT EXISTS public.life_milestones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_date date NOT NULL,
  category       text NOT NULL CHECK (category IN ('housing','vehicle','debt','family','business','health','other')),
  title          text NOT NULL,
  description    text,
  money_impact   numeric(14,2),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS life_milestones_date_idx
  ON public.life_milestones (milestone_date DESC);

ALTER TABLE public.life_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage life milestones"
  ON public.life_milestones;
CREATE POLICY "Authenticated users can manage life milestones"
  ON public.life_milestones
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

COMMENT ON TABLE public.life_milestones IS
  'Major quality-of-life events. Powers /annual-review milestone timeline. money_impact: positive = wealth gain (e.g. debt eliminated), negative = wealth loss, NULL = non-financial milestone.';

COMMENT ON COLUMN public.life_milestones.category IS
  'Constrained to: housing, vehicle, debt, family, business, health, other.';

-- Seed known milestones from 2026-05-06 session
INSERT INTO public.life_milestones (milestone_date, category, title, description, money_impact)
SELECT v.milestone_date, v.category, v.title, v.description, v.money_impact
FROM (VALUES
  ('2024-12-31'::date, 'debt',     'Corolla loan paid off',                'Eliminated ~$15k of vehicle debt at end of 2024.', 15000::numeric),
  ('2025-10-15'::date, 'business', 'Started book pallet sourcing (Polar HQ)', 'Began buying book pallets from Polar HQ — shifted inventory mix from non-book retail arbitrage to book FBA. Books cash-basis: pallet payment = expense at purchase.', NULL),
  ('2026-04-13'::date, 'debt',     'Tesla loan paid off',                  'Eliminated ~$40k of vehicle debt. Both household vehicles now paid off.', 40000::numeric),
  ('2026-04-30'::date, 'debt',     'BDC loan paid down (~$100k → $11k)',   '~$89k of business debt eliminated through inventory liquidation.', 89000::numeric),
  ('2026-05-06'::date, 'debt',     'GST + 2025 income tax fully cleared',  '2025 GST and personal income tax remitted in full. No CRA balance owing.', NULL),
  ('2026-05-06'::date, 'family',   '2 paid-off vehicles + nice apartment', 'Quality-of-life milestone: moved from basement suite → nice apartment, 2 paid-off cars (Tesla + 2nd). Lifestyle compounding even when cash position is flat year-over-year.', NULL)
) AS v(milestone_date, category, title, description, money_impact)
WHERE NOT EXISTS (
  SELECT 1 FROM public.life_milestones m
  WHERE m.milestone_date = v.milestone_date AND m.title = v.title
);
