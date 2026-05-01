-- Migration 0054: cogs_entries — per-transaction COGS ledger + per-ASIN aggregate view
--
-- Three models audited in life_pl.py; this table owns Model 1 (per-ASIN unit cost).
-- Model 2 (daily non-book from Amazon sheet) and Model 3 (Business Transactions
-- inventory purchases) remain in Streamlit baseline for now.
--
-- Access model (matches 0052 pattern):
--   service_role  → full access (BYPASSRLS)
--   authenticated → DENY (no policy granted)
--   anon          → DENY (no policy granted)
--
-- Writers: app/api/cogs (POST), app/(cockpit)/cogs (server action)
-- Readers: cogs_per_asin_view (orders-sync COGS lookup), /cogs UI

-- ── 1. cogs_entries ──────────────────────────────────────────────────────────

CREATE TABLE public.cogs_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asin           text NOT NULL,
  pricing_model  text NOT NULL DEFAULT 'per_unit'
                   CHECK (pricing_model IN ('per_unit', 'pallet')),
  unit_cost_cad  numeric(10,2) NULL,
  quantity       int  NOT NULL DEFAULT 1 CHECK (quantity > 0),
  -- NULL when pricing_model='pallet' (unit cost unknown; tracked at pallet level)
  total_cost_cad numeric(12,2) GENERATED ALWAYS AS (unit_cost_cad * quantity) STORED,
  purchased_at   date NOT NULL,
  vendor         text NULL,
  notes          text NULL,
  source         text NOT NULL DEFAULT 'manual'
                   CHECK (source IN ('manual', 'sellerboard_import', 'receipt_ocr')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text NOT NULL DEFAULT 'manual',

  -- per_unit entries must have a positive cost; pallet entries leave it NULL
  CONSTRAINT cogs_unit_cost_model_check CHECK (
    (pricing_model = 'per_unit' AND unit_cost_cad IS NOT NULL AND unit_cost_cad > 0)
    OR (pricing_model = 'pallet')
  )
);

CREATE INDEX cogs_entries_asin_idx        ON public.cogs_entries (asin);
CREATE INDEX cogs_entries_purchased_at_idx ON public.cogs_entries (purchased_at DESC);

ALTER TABLE public.cogs_entries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.cogs_entries IS
  'Per-transaction COGS ledger. One row per purchase batch for an ASIN. '
  'RLS enabled 2026-04-30 (migration 0054). No policies — service_role only. '
  'See cogs_per_asin_view for aggregated per-ASIN weighted-average cost.';

-- ── 2. cogs_per_asin_view ────────────────────────────────────────────────────
--
-- Used by orders-sync.ts at ingest time to set orders.cogs_cad.
-- weighted_avg_unit_cost = sum(unit_cost * qty) / sum(qty) — per_unit entries only.
-- latest_unit_cost       = most recent per_unit entry (by purchased_at DESC).
-- has_pallet_entries     = true when ANY entry for this ASIN is pricing_model='pallet'.
--
-- security_invoker = true: view runs with caller's privileges so RLS on
-- cogs_entries is enforced for anon/authenticated callers (same as 0053).

CREATE VIEW public.cogs_per_asin_view
WITH (security_invoker = true) AS
WITH latest AS (
  SELECT DISTINCT ON (asin)
    asin,
    unit_cost_cad AS latest_unit_cost
  FROM public.cogs_entries
  WHERE pricing_model = 'per_unit'
    AND unit_cost_cad IS NOT NULL
  ORDER BY asin, purchased_at DESC, created_at DESC
)
SELECT
  e.asin,
  ROUND(
    SUM(e.unit_cost_cad * e.quantity)
      FILTER (WHERE e.pricing_model = 'per_unit' AND e.unit_cost_cad IS NOT NULL)
    / NULLIF(
        SUM(e.quantity)
          FILTER (WHERE e.pricing_model = 'per_unit' AND e.unit_cost_cad IS NOT NULL),
        0
      ),
    2
  )                              AS weighted_avg_unit_cost,
  l.latest_unit_cost,
  SUM(e.quantity)::int           AS total_quantity_purchased,
  BOOL_OR(e.pricing_model = 'pallet') AS has_pallet_entries,
  COUNT(*)::int                  AS entry_count
FROM public.cogs_entries e
LEFT JOIN latest l ON l.asin = e.asin
GROUP BY e.asin, l.latest_unit_cost;

COMMENT ON VIEW public.cogs_per_asin_view IS
  'Per-ASIN COGS aggregate. weighted_avg_unit_cost is the source of truth for '
  'orders.cogs_cad at sync time. Inherits RLS from cogs_entries via security_invoker.';

-- ── 3. orders.cogs_source — honest profit reporting (Q4 answer) ──────────────
--
-- Marks whether an order row''s cogs_cad came from per-unit lookup or is
-- pallet-sourced (exact unit cost unknown). NULL = no COGS data available.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cogs_source text
    CHECK (cogs_source IN ('per_unit', 'pallet'));

COMMENT ON COLUMN public.orders.cogs_source IS
  'Source of cogs_cad value: per_unit = looked up from cogs_per_asin_view, '
  'pallet = ASIN has pallet entries only (unit cost unknown), NULL = no lookup hit.';
