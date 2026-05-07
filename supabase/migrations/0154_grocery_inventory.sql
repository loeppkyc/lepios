-- 0154_grocery_inventory.sql
-- Diet module v1 — kitchen/pantry inventory tracking.
-- Streamlit baseline: pages/83_Grocery_Tracker.py SH_INVENTORY sheet.
-- Single-user (Colin); RLS authenticated full access.

CREATE TABLE grocery_inventory (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  item            TEXT        NOT NULL,
  category        TEXT        NOT NULL DEFAULT 'Other',
  qty             NUMERIC     NOT NULL DEFAULT 1,
  unit            TEXT        NOT NULL DEFAULT 'count',
  purchased_on    DATE        NOT NULL,
  expires_on      DATE        NULL,
  status          TEXT        NOT NULL DEFAULT 'On hand',
  notes           TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE grocery_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access on grocery_inventory"
  ON grocery_inventory FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX grocery_inventory_purchased_idx ON grocery_inventory (purchased_on DESC);
CREATE INDEX grocery_inventory_expires_idx ON grocery_inventory (expires_on)
  WHERE expires_on IS NOT NULL;
CREATE INDEX grocery_inventory_category_idx ON grocery_inventory (category);

CREATE OR REPLACE FUNCTION update_grocery_inventory_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER grocery_inventory_updated_at
  BEFORE UPDATE ON grocery_inventory
  FOR EACH ROW EXECUTE FUNCTION update_grocery_inventory_updated_at();
