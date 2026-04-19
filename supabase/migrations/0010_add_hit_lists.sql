-- 0010_add_hit_lists.sql

CREATE TABLE public.hit_lists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_handle TEXT NOT NULL DEFAULT 'colin',  -- SPRINT5-GATE: replace with profiles FK + RLS
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.hit_list_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hit_list_id    UUID NOT NULL REFERENCES public.hit_lists(id) ON DELETE CASCADE,
  isbn           TEXT NOT NULL,
  cost_paid_cad  NUMERIC(8,2),                  -- nullable; populated at batch scan time (E.3)
  status         TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'scanned' | 'skipped'
  scan_result_id UUID REFERENCES public.scan_results(id) ON DELETE SET NULL,
  added_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  scanned_at     TIMESTAMPTZ,
  UNIQUE (hit_list_id, isbn)
);

CREATE INDEX ON public.hit_list_items (hit_list_id, status);
CREATE INDEX ON public.hit_list_items (scan_result_id);

ALTER TABLE public.hit_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hit_list_items ENABLE ROW LEVEL SECURITY;

-- SPRINT5-GATE: policy currently allows any authenticated user read/write access
-- (fine for single-operator today). Tighten to profiles.id when multi-user auth
-- lands per ARCHITECTURE.md §7.3 hard gate.
CREATE POLICY "hit_lists_authenticated" ON public.hit_lists
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "hit_list_items_authenticated" ON public.hit_list_items
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
