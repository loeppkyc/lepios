-- 0214_systems_ideas_memory_stats.sql
-- Brain dump ideas feed + Windows RAM telemetry + Systems page config seeds

-- ── Ideas / Brain Dump table ──────────────────────────────────────────────────
CREATE TABLE ideas (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL,
  description text,
  status      text        NOT NULL DEFAULT 'idea',
  source      text        NOT NULL DEFAULT 'claude',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ideas_status_check CHECK (status IN ('idea', 'active', 'shipped', 'parked')),
  CONSTRAINT ideas_source_check CHECK (source IN ('claude', 'colin'))
);

GRANT INSERT, UPDATE, DELETE ON ideas TO service_role;

-- ── System RAM telemetry table ─────────────────────────────────────────────────
-- Pushed by scripts/memory-guard.ps1 on Colin's machine every 2 minutes.
CREATE TABLE memory_stats (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  ram_pct        numeric(5,2) NOT NULL,
  ram_used_gb    numeric(8,2),
  ram_total_gb   numeric(8,2),
  top_process    text,
  top_process_mb numeric(8,2),
  recorded_at    timestamptz  NOT NULL DEFAULT now()
);

-- Append-only telemetry — insert from PowerShell, read from Systems page
GRANT INSERT ON memory_stats TO service_role;

-- ── Seed harness_config with Systems page scores ──────────────────────────────
INSERT INTO harness_config (key, value, description)
VALUES
  ('gpu_day_score',       '98.2', 'GPU Day readiness % — updated after each GPU prep session'),
  ('orb_day_score',       '90.3', 'Orb Day readiness % — updated after each Orb prep session'),
  ('business_review_pct', '72',   'Business Review completeness % — statement coverage estimate')
ON CONFLICT (key) DO UPDATE
  SET value       = EXCLUDED.value,
      description = EXCLUDED.description;

-- ── Seed initial brain dump ideas ─────────────────────────────────────────────
INSERT INTO ideas (title, description, status, source)
VALUES
  (
    'Systems Page with Pressure Gauges + Brain Dump Feed',
    'New /systems page with circular SVG pressure gauges (Harness %, GPU Day %, Orb Day %, Business Review %, System RAM %) + Brain Dump feed section. Ideas table in Supabase, quick-add from page, Claude adds entries during conversations.',
    'active',
    'claude'
  ),
  (
    'Computer Memory Guardrails',
    'Windows RAM monitor: PowerShell script checks RAM every 2 min, sends Telegram warning at 80% and critical at 90%. Exhaust valve: auto-pause Ollama at threshold. Pushes stats to Supabase memory_stats table for Systems page RAM gauge.',
    'active',
    'claude'
  );
