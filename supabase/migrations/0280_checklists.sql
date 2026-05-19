-- Migration 0280: checklists — end-of-month checklist, address change checklist, chores

-- Monthly checklist: items to complete before each month closes (personal, not bookkeeping)
CREATE TABLE IF NOT EXISTS monthly_checklist_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  category    TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monthly_checklist_completions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID NOT NULL REFERENCES monthly_checklist_items(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,  -- 'YYYY-MM'
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, month)
);

GRANT INSERT, UPDATE, DELETE ON monthly_checklist_items TO service_role;
GRANT INSERT, UPDATE, DELETE ON monthly_checklist_completions TO service_role;

-- Address change checklist: places to notify when moving
CREATE TABLE IF NOT EXISTS address_change_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place       TEXT NOT NULL,
  category    TEXT,
  url         TEXT,
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT INSERT, UPDATE, DELETE ON address_change_items TO service_role;

-- Chores: recurring household tasks
CREATE TABLE IF NOT EXISTS chores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  frequency   TEXT,  -- 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'as_needed'
  assigned_to TEXT,
  last_done   DATE,
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT INSERT, UPDATE, DELETE ON chores TO service_role;

-- Seed: starter items for monthly checklist
INSERT INTO monthly_checklist_items (name, category, sort_order) VALUES
  ('File bank statements to Dropbox',     'Banking',    10),
  ('Reconcile credit cards',              'Banking',    20),
  ('Review and categorize expenses',      'Bookkeeping', 30),
  ('Close month in LepiOS',               'Bookkeeping', 40),
  ('Review Amazon payouts',               'Amazon',     50),
  ('Check Amazon inventory levels',       'Amazon',     60),
  ('Send GST amounts to accountant',      'Tax',        70),
  ('Review monthly P&L',                  'Review',     80),
  ('Update net worth snapshot',           'Review',     90),
  ('Weekly review completed',             'Review',     100)
ON CONFLICT DO NOTHING;

-- Seed: address change checklist
INSERT INTO address_change_items (place, category, url, notes, sort_order) VALUES
  ('Service Canada / CRA',       'Government', 'https://canada.ca',              'Update mailing address for tax notices',  10),
  ('Alberta Health',             'Government', 'https://alberta.ca',             'Health card address',                     20),
  ('Service Alberta',            'Government', 'https://servicealberta.gov.ab.ca', "Driver's license / registry",            30),
  ('Canada Post (mail forward)', 'Government', 'https://canadapost.ca',          'Set up mail forwarding',                  40),
  ('TD Bank',                    'Banking',    'https://td.com',                 'Chequing + savings accounts',             50),
  ('CIBC',                       'Banking',    'https://cibc.com',               NULL,                                      60),
  ('Capital One',                'Banking',    'https://capitalone.ca',          NULL,                                      70),
  ('Amex',                       'Banking',    'https://americanexpress.com/ca', NULL,                                      80),
  ('Canadian Tire MC',           'Banking',    'https://triangle.com',           NULL,                                      90),
  ('Amazon Seller Central',      'Business',   'https://sellercentral.amazon.ca', 'Business address + return address',      100),
  ('CRA Business Account',       'Tax',        'https://canada.ca/cra',          'GST/HST business address',               110),
  ('Ebb & Flow Logistics',       'Business',   NULL,                             'Notify 3PL of new address',              120),
  ('Insurance policies',         'Insurance',  NULL,                             'Auto + renter's insurance',              130),
  ('Vehicle registration',       'Government', NULL,                             'Both vehicles',                          140),
  ('Dropbox',                    'Services',   'https://dropbox.com',            'Billing address if needed',              150),
  ('Amazon (personal)',          'Services',   'https://amazon.ca',              'Default shipping address',               160),
  ('Sellerboard',                'Business',   NULL,                             NULL,                                     170),
  ('Walmart',                    'Services',   'https://walmart.ca',             'Delivery address',                       180),
  ('Costco',                     'Services',   'https://costco.ca',              'Membership address',                     190)
ON CONFLICT DO NOTHING;
