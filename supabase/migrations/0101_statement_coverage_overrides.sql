CREATE TABLE public.statement_coverage_overrides (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    account_key TEXT        NOT NULL,
    year_month  TEXT        NOT NULL,   -- 'YYYY-MM'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_key, year_month)
);

ALTER TABLE public.statement_coverage_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "statement_coverage_overrides_authenticated"
    ON public.statement_coverage_overrides
    FOR ALL
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
