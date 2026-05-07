-- 0155_grocery_receipts.sql
-- Diet module v1 — grocery receipts (per-line-item).
-- Streamlit baseline: pages/83_Grocery_Tracker.py SH_RECEIPT sheet (12 cols).
-- Discount rows = negative price (Streamlit convention preserved).
-- Receipt OCR via Claude Vision deferred to v1.1.

CREATE TABLE grocery_receipts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  purchased_on    DATE        NOT NULL,
  store           TEXT        NOT NULL,
  item            TEXT        NOT NULL,
  price           NUMERIC     NOT NULL,
  category        TEXT        NOT NULL DEFAULT 'Other',
  qty             NUMERIC     NOT NULL DEFAULT 1,
  unit            TEXT        NOT NULL DEFAULT 'count',
  calories        INT         NULL,
  protein_g       INT         NULL,
  carbs_g         INT         NULL,
  fat_g           INT         NULL,
  notes           TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE grocery_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on grocery_receipts"
  ON grocery_receipts FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX grocery_receipts_purchased_idx ON grocery_receipts (purchased_on DESC);
CREATE INDEX grocery_receipts_store_idx ON grocery_receipts (store);
CREATE INDEX grocery_receipts_category_idx ON grocery_receipts (category);

CREATE OR REPLACE FUNCTION update_grocery_receipts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER grocery_receipts_updated_at
  BEFORE UPDATE ON grocery_receipts
  FOR EACH ROW EXECUTE FUNCTION update_grocery_receipts_updated_at();
