-- 0267_legal_items.sql
-- Legal item tracker: contracts, disputes, filings, and compliance tasks
-- with category, status, and due date.

CREATE TYPE legal_item_category AS ENUM (
  'contract',
  'dispute',
  'filing',
  'compliance',
  'ip',
  'tax',
  'other'
);

CREATE TYPE legal_item_status AS ENUM (
  'open',
  'in_progress',
  'pending_review',
  'resolved',
  'closed'
);

CREATE TABLE legal_items (
  id          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT                NOT NULL,
  description TEXT,
  category    legal_item_category NOT NULL DEFAULT 'other',
  status      legal_item_status   NOT NULL DEFAULT 'open',
  due_date    DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  owner_id    UUID                REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX legal_items_owner_id  ON legal_items(owner_id);
CREATE INDEX legal_items_status    ON legal_items(status);
CREATE INDEX legal_items_due_date  ON legal_items(due_date);
CREATE INDEX legal_items_category  ON legal_items(category);

ALTER TABLE legal_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own legal items" ON legal_items
  FOR ALL USING (owner_id = auth.uid());

GRANT INSERT, UPDATE, DELETE ON legal_items TO service_role;
