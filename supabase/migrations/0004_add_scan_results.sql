-- Chunk A: PageProfit scan results.
-- One row per Amazon CA scan (ISBN → ASIN → profit calc).
-- hit_list_id FK deferred to Chunk E.
-- 'watch' decision value deferred to Chunk E when hit-list UI writes exist.

CREATE TABLE public.scan_results (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    -- SPRINT5-GATE: replace with profiles FK + RLS policy (ARCHITECTURE.md §7.3, MN-3)
    person_handle     TEXT          NOT NULL DEFAULT 'colin',
    isbn              TEXT,
    asin              TEXT,
    title             TEXT,
    cost_paid_cad     NUMERIC(10,2) NOT NULL,
    buy_box_price_cad NUMERIC(10,2),
    fba_fees_cad      NUMERIC(10,2),
    profit_cad        NUMERIC(10,2),
    roi_pct           NUMERIC(6,2),
    decision          TEXT          CHECK (decision IN ('buy', 'skip')),
    marketplace       TEXT          NOT NULL DEFAULT 'amazon_ca',
    recorded_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX ON public.scan_results (person_handle, recorded_at DESC);
CREATE INDEX ON public.scan_results (asin);
CREATE INDEX ON public.scan_results (isbn);

ALTER TABLE public.scan_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_results_authenticated" ON public.scan_results
    FOR ALL
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
