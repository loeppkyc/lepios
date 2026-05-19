-- Migration 0277: account_vault — service credential registry (no passwords stored)
CREATE TABLE IF NOT EXISTS account_vault (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service      TEXT NOT NULL,
  username     TEXT,
  url          TEXT,
  notes        TEXT,
  category     TEXT NOT NULL DEFAULT 'other',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT INSERT, UPDATE, DELETE ON account_vault TO service_role;

-- Seed: 40+ service logins from Masterfile (usernames only, no passwords)
INSERT INTO account_vault (service, username, url, notes, category, sort_order) VALUES
  -- Email
  ('Gmail — Epic Exports',    'epicexports2022@gmail.com',         'https://mail.google.com', 'Business account',                  'email',          10),
  ('Gmail — Colin Personal',  'loeppkycolin@gmail.com',            'https://mail.google.com', 'Personal account',                  'email',          20),
  ('Gmail — Colin Alt',       'colinloeppky@gmail.com',            'https://mail.google.com', 'Alt account',                       'email',          30),
  -- Amazon
  ('Amazon Seller Central',   NULL,                                'https://sellercentral.amazon.ca', 'Reimbursements, main account', 'amazon',        10),
  ('Amazon Business',         NULL,                                'https://business.amazon.ca',      NULL,                          'amazon',        20),
  -- Amazon Tools
  ('Keepa',                   'loeppkycolin@gmail.com',            'https://keepa.com',               'Online Arbitrage / OA',       'amazon_tools',  10),
  ('Keepa (Epic Exports)',    'epicexports2022@gmail.com',         'https://keepa.com',               NULL,                          'amazon_tools',  20),
  ('AZInsight',               'cagungonsarah@gmail.com',           'https://app.azinsight.com',       'Chrome ext, ASIN profitability', 'amazon_tools', 30),
  ('StockTrack',              NULL,                                 NULL,                              'Check which stores have inventory on hand', 'amazon_tools', 40),
  ('Tactical Arbitrage',      'cagungonsarah_gmail_com_8411',      'https://app.tacticalarbitrage.com', NULL,                        'amazon_tools',  50),
  ('sellerboard',             'cagungonsarah@gmail.com',           'https://app.sellerboard.com',     NULL,                          'amazon_tools',  60),
  ('Threecolts',              'cagungonsarah@gmail.com',           'https://app.threecolts.com',      NULL,                          'amazon_tools',  70),
  -- Business Tools
  ('Dropbox',                 'loeppkycolin@gmail.com',            'https://dropbox.com',             'File storage for reports',    'business_tools', 10),
  ('Hubdoc',                  'hubdoc.loeppkycolin.runldc88@app.hubdoc.com', 'https://app.hubdoc.com', 'Input receipts to bookkeeper', 'business_tools', 20),
  ('MileIQ',                  'loeppkycolin@gmail.com',            'https://app.mileiq.com',          NULL,                          'business_tools', 30),
  ('SalesGazer',              'loeppkycolin@gmail.com',            NULL,                              'Email businesses for upcoming sales', 'business_tools', 40),
  ('Ticket Flipping',         'loeppkycolin@gmail.com',            NULL,                              'Ticket Flipping Broker Course', 'business_tools', 50),
  ('Personal VA',             'cagungonsarah@gmail.com',           NULL,                              NULL,                           'business_tools', 60),
  ('Whop',                    'loeppkycolin@gmail.com',            'https://whop.com',                NULL,                           'business_tools', 70),
  -- Logistics
  ('Ebb & Flow Logistics',    'cagungonsarah@gmail.com',           NULL,                              '3PL prep center',              'logistics',      10),
  -- Social
  ('Facebook',                'epicexports2022@gmail.com',         'https://facebook.com',            'Loeppky Holdings page',        'social',         10),
  -- Retail
  ('Walmart',                 'loeppkycolin@gmail.com',            'https://walmart.ca',              NULL,                           'retail',         10),
  ('Walmart (Epic Exports)',  'epicexports2022@gmail.com',         'https://walmart.ca',              NULL,                           'retail',         20),
  ('Costco',                  'loeppkycolin@gmail.com',            'https://costco.ca',               NULL,                           'retail',         30),
  ('Home Depot',              'loeppkycolin@gmail.com',            'https://homedepot.ca',            NULL,                           'retail',         40),
  ('The Source',              'loeppkycolin@gmail.com',            'https://thesource.ca',            NULL,                           'retail',         50),
  ('IKEA',                    '3067169419',                        'https://ikea.com/ca',             'Username is phone number',     'retail',         60),
  ('LEGO',                    'loeppkycolin@gmail.com',            'https://lego.com/en-ca',          NULL,                           'retail',         70),
  ('Sport Chek',              'loeppkycolin@gmail.com',            'https://sportchek.ca',            NULL,                           'retail',         80),
  ('PetSmart',                'loeppkycolin@gmail.com',            'https://petsmart.ca',             NULL,                           'retail',         90),
  ('Toys"R"Us',               'loeppkycolin@gmail.com',            'https://toysrus.ca',              NULL,                           'retail',        100),
  ('Staples',                 'loeppkycolin@gmail.com',            'https://staples.ca',              NULL,                           'retail',        110),
  ('Indigo',                  'loeppkycolin@gmail.com',            'https://indigo.ca',               NULL,                           'retail',        120),
  ('Home Hardware',           'loeppkycolin@gmail.com',            'https://homehardware.ca',         NULL,                           'retail',        130),
  ('Cabela''s',               'loeppkycolin@gmail.com',            'https://cabelas.ca',              NULL,                           'retail',        140),
  ('Memory Express',          'loeppkycolin@gmail.com',            'https://memoryexpress.com',       NULL,                           'retail',        150),
  ('Bath & Body Works',       'loeppkycolin@gmail.com',            'https://bathandbodyworks.com/ca', NULL,                           'retail',        160),
  ('Denon',                   'loeppkycolin@gmail.com',            'https://denon.com',               NULL,                           'retail',        170),
  ('Dell',                    'loeppkycolin@gmail.com',            'https://dell.com/en-ca',          NULL,                           'retail',        180),
  ('MEC',                     'loeppkycolin@gmail.com',            'https://mec.ca',                  NULL,                           'retail',        190),
  ('Columbia',                'loeppkycolin@gmail.com',            'https://columbia.com/en-ca',      NULL,                           'retail',        200),
  ('London Drugs',            'loeppkycolin@gmail.com',            'https://londondrugs.com',         NULL,                           'retail',        210),
  ('Visions Electronics',     'loeppkycolin@gmail.com',            'https://visions.ca',              'Account may be disabled/locked', 'retail',      220),
  ('CMS FamousToys',          'loeppkyc',                          NULL,                              NULL,                           'retail',        230),
  ('Elite Tools',             'epicexports2022@gmail.com',         NULL,                              'Account closed',               'retail',        240)
ON CONFLICT DO NOTHING;
