-- 0205_manual_assets.sql
-- manual_assets: non-API wealth items Colin updates manually (vehicles, real estate, etc.)
-- Consumed by GET /api/net-worth/manual-assets and the /net-worth ManualAssetsSection UI.

CREATE TABLE IF NOT EXISTS public.manual_assets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text        NOT NULL,
  asset_class text        NOT NULL CHECK (asset_class IN (
    'vehicle', 'real_estate', 'cash', 'investment', 'other'
  )),
  value_cad   numeric(14, 2) NOT NULL DEFAULT 0,
  notes       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- F24: service_role grants for all write operations
GRANT INSERT, UPDATE, DELETE ON public.manual_assets TO service_role;

-- RLS: Colin-only (authenticated read; service_role writes via cron/API)
ALTER TABLE public.manual_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY manual_assets_authenticated_read ON public.manual_assets
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY manual_assets_authenticated_write ON public.manual_assets
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

COMMENT ON TABLE public.manual_assets IS
  'Non-API wealth items updated manually (vehicles, real estate equity, etc.). '
  'Part of T-005 Net Worth pipeline. Seeded with Colin''s known assets.';

-- Seed Colin's known assets (idempotent — ON CONFLICT DO NOTHING on label)
INSERT INTO public.manual_assets (label, asset_class, value_cad)
SELECT v.label, v.asset_class, v.value_cad
FROM (VALUES
  ('Vehicle #1 (primary)',  'vehicle',     20000::numeric),
  ('Vehicle #2',            'vehicle',     15000::numeric),
  ('Real Estate Equity',    'real_estate',     0::numeric)
) AS v(label, asset_class, value_cad)
WHERE NOT EXISTS (
  SELECT 1 FROM public.manual_assets ma WHERE ma.label = v.label
);
