-- 0039_utility_bills.sql
-- Creates utility_bills table for Utility Tracker (Sprint 5 port from Streamlit).
-- Service-role-only RLS policy: standard LepiOS pattern.

CREATE TABLE utility_bills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month       text NOT NULL UNIQUE,  -- YYYY-MM; UNIQUE constraint enforces upsert key
  kwh         numeric(8,2) NOT NULL CHECK (kwh >= 0),
  amount_cad  numeric(8,2) NOT NULL CHECK (amount_cad >= 0),
  provider    text NOT NULL DEFAULT 'Metergy',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE utility_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON utility_bills
  USING (auth.role() = 'service_role');

-- Index for chronological display
CREATE INDEX utility_bills_month_idx ON utility_bills (month DESC);
