-- Reselling cluster: repricer_rules + repricer_log
-- Replaces Google Sheets "Repricer Rules" + "Repricer Log" tabs

CREATE TABLE IF NOT EXISTS public.repricer_rules (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asin          text          NOT NULL,
  title         text,
  rule_type     text          NOT NULL DEFAULT 'margin', -- 'margin' | 'fixed' | 'competitive'
  min_price     numeric(10,2) NOT NULL,
  max_price     numeric(10,2) NOT NULL,
  target_margin numeric(5,2),                            -- e.g. 15.0 = 15%
  notes         text,
  enabled       boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.repricer_log (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id      uuid          REFERENCES public.repricer_rules(id) ON DELETE SET NULL,
  asin         text          NOT NULL,
  old_price    numeric(10,2),
  new_price    numeric(10,2) NOT NULL,
  reason       text,
  dry_run      boolean       NOT NULL DEFAULT false,
  logged_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS repricer_rules_user_idx ON public.repricer_rules(user_id);
CREATE INDEX IF NOT EXISTS repricer_rules_asin_idx ON public.repricer_rules(asin);
CREATE INDEX IF NOT EXISTS repricer_log_asin_idx   ON public.repricer_log(asin, logged_at DESC);

ALTER TABLE public.repricer_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repricer_log   ENABLE ROW LEVEL SECURITY;

CREATE POLICY repricer_rules_self
  ON public.repricer_rules FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- repricer_log: visible to owner of the rule (or any log row without a rule)
CREATE POLICY repricer_log_self
  ON public.repricer_log FOR ALL TO authenticated
  USING (
    rule_id IS NULL
    OR rule_id IN (SELECT id FROM public.repricer_rules WHERE user_id = auth.uid())
  )
  WITH CHECK (
    rule_id IS NULL
    OR rule_id IN (SELECT id FROM public.repricer_rules WHERE user_id = auth.uid())
  );

GRANT INSERT, UPDATE, DELETE ON public.repricer_rules TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.repricer_log   TO service_role;
