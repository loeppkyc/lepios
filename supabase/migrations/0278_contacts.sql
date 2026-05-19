-- Migration 0278: contacts — business and personal contact registry
CREATE TABLE IF NOT EXISTS contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  company     TEXT,
  type        TEXT NOT NULL DEFAULT 'personal',  -- 'business' | 'personal' | 'service' | 'family'
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  notes       TEXT,
  category    TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT INSERT, UPDATE, DELETE ON contacts TO service_role;

-- Seed: Contact Details from Masterfile
INSERT INTO contacts (name, company, type, email, phone, address, notes, category, sort_order) VALUES
  (
    'Colin Loeppky',
    'Epic Exports',
    'business',
    'epicexports2022@gmail.com',
    '1 (306) 716-9419',
    '502-8455 106A Ave Edmonton AB T5H 0X4',
    'GST: 809528318 · Type: Retail/Proprietorship · Year End: December · Shipping: 8618 106A Ave NW, Edmonton AB T5H 0S3 · Website: amazon.ca/shops/epicexports',
    'business',
    10
  ),
  (
    'Colin Loeppky',
    NULL,
    'personal',
    'loeppkycolin@gmail.com',
    '1 (306) 716-9419',
    '502-8455 106A Ave Edmonton AB T5H 0X4',
    NULL,
    'personal',
    20
  ),
  (
    'Megan Loeppky',
    'MfCleaning',
    'business',
    'Friesenm92@gmail.com',
    '1 (306) 717-0676',
    NULL,
    'Cleaning business',
    'business',
    30
  ),
  (
    'Sharon Loeppky',
    NULL,
    'family',
    'sharonloeppky@gmail.com',
    '1 (306) 933-2169',
    NULL,
    NULL,
    'family',
    40
  ),
  (
    'Toyota West Edmonton Mall',
    'Toyota',
    'service',
    NULL,
    NULL,
    NULL,
    'Service department',
    'service',
    50
  )
ON CONFLICT DO NOTHING;
