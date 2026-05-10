-- MID batch 2: phone relay for Scanner Phone → PageProfit desktop

CREATE TABLE IF NOT EXISTS public.phone_relay_scans (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_code text        NOT NULL,
  isbn         text        NOT NULL,
  scanned_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS phone_relay_scans_session_idx
  ON public.phone_relay_scans(session_code, scanned_at DESC);

-- Sessions expire after 2 hours — allow unauthenticated inserts from phone
-- (session_code is the shared secret for that scan session)
ALTER TABLE public.phone_relay_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY phone_relay_insert_anon
  ON public.phone_relay_scans FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY phone_relay_select_authenticated
  ON public.phone_relay_scans FOR SELECT TO authenticated
  USING (true);

GRANT INSERT, UPDATE, DELETE ON public.phone_relay_scans TO service_role;
