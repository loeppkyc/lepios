-- 0220_lego_vault.sql
-- E2 — Lego Vault + Buy & Hold Radar
-- Tables: lego_vault, lego_price_history, lego_retiring_sets, lego_theme_config

CREATE TABLE lego_vault (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  set_number          TEXT        NOT NULL,
  name                TEXT        NOT NULL DEFAULT '',
  asin                TEXT        NOT NULL DEFAULT '',
  theme               TEXT        NOT NULL DEFAULT '',
  paid_cad            NUMERIC(8,2) NULL,
  target_sell_cad     NUMERIC(8,2) NULL,
  current_amazon_cad  NUMERIC(8,2) NULL,
  status              TEXT        NOT NULL DEFAULT 'in_vault_sealed'
                                  CHECK (status IN (
                                    'in_vault_sealed',
                                    'in_vault_opened',
                                    'long_term_hold',
                                    'ready_to_ship',
                                    'shipped_to_fba',
                                    'live_on_amazon',
                                    'sold',
                                    'personal_collection'
                                  )),
  location            TEXT        NOT NULL DEFAULT '',
  qty                 INTEGER     NOT NULL DEFAULT 1 CHECK (qty > 0),
  alert_sent          BOOLEAN     NOT NULL DEFAULT FALSE,
  last_price_check    TIMESTAMPTZ NULL,
  notes               TEXT        NOT NULL DEFAULT '',
  date_added          DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lego_price_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id    UUID        NOT NULL REFERENCES lego_vault(id) ON DELETE CASCADE,
  price_cad   NUMERIC(8,2) NOT NULL,
  checked_at  DATE        NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE lego_retiring_sets (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  set_number       TEXT        NOT NULL UNIQUE,
  name             TEXT        NOT NULL DEFAULT '',
  theme            TEXT        NOT NULL DEFAULT '',
  pieces           INTEGER     NULL,
  retail_price_cad NUMERIC(8,2) NULL,
  asin             TEXT        NOT NULL DEFAULT '',
  amazon_price_cad NUMERIC(8,2) NULL,
  discount_pct     NUMERIC(5,1) NULL,
  sales_rank       INTEGER     NULL,
  profit_score     INTEGER     NULL,
  retire_date_est  DATE        NULL,
  status           TEXT        NOT NULL DEFAULT 'watching',
  last_checked     TIMESTAMPTZ NULL,
  notes            TEXT        NOT NULL DEFAULT ''
);

-- 20% improvement: store theme multipliers in DB so Colin can update without a deploy
CREATE TABLE lego_theme_config (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  theme       TEXT    NOT NULL UNIQUE,
  multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.10,
  notes       TEXT    NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE lego_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE lego_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE lego_retiring_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE lego_theme_config ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "authenticated full access" ON lego_vault
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access" ON lego_price_history
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access" ON lego_retiring_sets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access" ON lego_theme_config
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- F24: service_role grants
GRANT INSERT, UPDATE, DELETE ON lego_vault TO service_role;
GRANT INSERT, UPDATE, DELETE ON lego_price_history TO service_role;
GRANT INSERT, UPDATE, DELETE ON lego_retiring_sets TO service_role;
GRANT INSERT, UPDATE, DELETE ON lego_theme_config TO service_role;

-- Seed theme multipliers (BrickLink-derived historical averages, from Streamlit source)
-- TODO: tune with real data — these are 2024 BrickLink averages
INSERT INTO lego_theme_config (theme, multiplier, notes) VALUES
  ('Star Wars', 1.45, 'High collector demand, consistent appreciation'),
  ('Icons', 1.35, 'Architecture / Creator Expert sets'),
  ('Creator Expert', 1.35, 'Legacy name for Icons predecessor'),
  ('Technic', 1.25, 'Mechanical sets, strong secondary market'),
  ('City', 1.10, 'Popular but high supply'),
  ('Harry Potter', 1.40, 'Strong IP licensing, limited reprints'),
  ('Ideas', 1.38, 'Fan-designed, limited production'),
  ('Art', 1.20, 'Display pieces, niche demand'),
  ('Architecture', 1.30, 'Collectors, travel/souvenir market'),
  ('Marvel', 1.30, 'MCU licensing drives demand'),
  ('DC', 1.25, 'Smaller market than Marvel'),
  ('Ninjago', 1.15, 'Kids theme, moderate appreciation'),
  ('Friends', 1.08, 'High supply, lower appreciation'),
  ('Botanical', 1.42, 'Home decor crossover, very strong appreciation'),
  ('Speed Champions', 1.18, 'Car licenses, moderate appreciation'),
  ('Minecraft', 1.12, 'Game tie-in, moderate'),
  ('Disney', 1.32, 'Strong IP, good appreciation'),
  ('Lord of the Rings', 1.50, 'Discontinued license — high appreciation');

-- Seed 19 known retiring sets (from Streamlit lego_retirement.py)
-- Retire dates are estimates; amazon_price_cad/discount_pct are NULL until first price check
INSERT INTO lego_retiring_sets (set_number, name, theme, pieces, retail_price_cad, asin, retire_date_est) VALUES
  ('10311', 'Orchid', 'Botanical', 608, 64.99, 'B09BNMTHRS', '2026-06-01'),
  ('10281', 'Bonsai Tree', 'Botanical', 878, 64.99, 'B08R3SDGR3', '2026-06-01'),
  ('10280', 'Flower Bouquet', 'Botanical', 756, 64.99, 'B08R3QCGTV', '2026-06-01'),
  ('10278', 'Police Station', 'Creator Expert', 2923, 249.99, 'B08R3Q7BFV', '2026-06-01'),
  ('21324', 'Space Shuttle Discovery', 'Ideas', 2354, 249.99, 'B08WNX6G5K', '2026-06-01'),
  ('75192', 'Millennium Falcon', 'Star Wars', 7541, 999.99, 'B07FGGCR7F', '2027-06-01'),
  ('75313', 'AT-AT', 'Star Wars', 6785, 899.99, 'B08Z4JPN57', '2026-12-01'),
  ('10294', 'Titanic', 'Icons', 9090, 749.99, 'B09BXCFBWY', '2027-06-01'),
  ('10307', 'Eiffel Tower', 'Icons', 10001, 649.99, 'B0BFSD3D2B', '2026-12-01'),
  ('10295', 'Porsche 911', 'Icons', 1458, 179.99, 'B08WNX7SBP', '2026-06-01'),
  ('42143', 'Ferrari Daytona SP3', 'Technic', 3778, 449.99, 'B09YCG6Z8W', '2026-09-01'),
  ('75341', 'Luke Skywalker''s Landspeeder', 'Star Wars', 1890, 249.99, 'B09YCG9F2S', '2026-12-01'),
  ('76178', 'Daily Bugle', 'Marvel', 3772, 349.99, 'B08WNY59HV', '2026-06-01'),
  ('10290', 'Pickup Truck', 'Icons', 1677, 179.99, 'B09BCVHB44', '2026-09-01'),
  ('21332', 'The Globe', 'Ideas', 2585, 224.99, 'B09YCG7HLZ', '2026-09-01'),
  ('10305', 'Lion Knights'' Castle', 'Icons', 4514, 399.99, 'B09YCG8Q3D', '2027-06-01'),
  ('10297', 'Boutique Hotel', 'Icons', 3066, 299.99, 'B09YCG5P8S', '2026-09-01'),
  ('21330', 'Home Alone', 'Ideas', 3955, 274.99, 'B09BCVH9M3', '2026-12-01'),
  ('43217', 'Up House', 'Disney', 598, 89.99, 'B0BFSCY4TD', '2026-09-01');
