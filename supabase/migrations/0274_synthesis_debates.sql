-- 0274_synthesis_debates.sql
--
-- Synthesis Engine: stores Reddit/HN debates ingested via n8n.
-- n8n workflows upsert rows; /api/synthesis/run claims and synthesizes them.
-- RLS: authenticated SELECT only. Writes via service_role (n8n + cron).
-- F24: GRANT block required.

CREATE TYPE synthesis_source AS ENUM ('reddit', 'hn');
CREATE TYPE synthesis_status_enum AS ENUM ('pending', 'processing', 'done', 'failed');

CREATE TABLE public.synthesis_debates (
  id                UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  source            synthesis_source      NOT NULL,
  external_id       TEXT                  NOT NULL,
  url               TEXT                  NOT NULL,
  title             TEXT                  NOT NULL,
  body_snippet      TEXT,
  controversy_score FLOAT                 NOT NULL DEFAULT 0,
  domain            TEXT                  NOT NULL DEFAULT 'climate',
  synthesis_status  synthesis_status_enum NOT NULL DEFAULT 'pending',
  synthesis_text    TEXT,
  side_a_summary    TEXT,
  side_b_summary    TEXT,
  resolution_text   TEXT,
  synthesized_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX synthesis_debates_source_external_id ON synthesis_debates (source, external_id);
CREATE INDEX synthesis_debates_status_score ON synthesis_debates (synthesis_status, controversy_score DESC) WHERE synthesis_status = 'pending';
CREATE INDEX synthesis_debates_domain ON synthesis_debates (domain);
CREATE INDEX synthesis_debates_synthesized_at ON synthesis_debates (synthesized_at DESC) WHERE synthesis_status = 'done';

ALTER TABLE synthesis_debates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_synthesis_debates" ON synthesis_debates
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- F24
GRANT INSERT, UPDATE, DELETE ON synthesis_debates TO service_role;
