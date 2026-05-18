-- 0272_competitive_intel.sql
--
-- Competitive Intelligence Engine — schema.
-- Daily arXiv / Papers With Code / OpenReview scanner that scores papers by
-- keyword relevance and injects sprint tasks for high-scoring items.
-- See docs/acceptance/competitive-intel.md

CREATE TABLE public.competitive_intel (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  source           TEXT    NOT NULL CHECK (source IN ('arxiv', 'paperswithcode', 'openreview')),
  url              TEXT    NOT NULL,
  title            TEXT    NOT NULL,
  abstract_snippet TEXT,
  relevance_score  FLOAT   NOT NULL DEFAULT 0.0 CHECK (relevance_score >= 0.0 AND relevance_score <= 1.0),
  flagged          BOOLEAN NOT NULL DEFAULT false,
  fed_to_sprint    BOOLEAN NOT NULL DEFAULT false,
  scraped_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes            TEXT,
  UNIQUE (source, url)
);

CREATE INDEX competitive_intel_flagged_idx ON public.competitive_intel (flagged, scraped_at DESC) WHERE flagged = true;
CREATE INDEX competitive_intel_unfed_idx   ON public.competitive_intel (fed_to_sprint, flagged, scraped_at DESC) WHERE flagged = true AND fed_to_sprint = false;
CREATE INDEX competitive_intel_source_idx  ON public.competitive_intel (source, scraped_at DESC);

ALTER TABLE public.competitive_intel ENABLE ROW LEVEL SECURITY;
CREATE POLICY "competitive_intel_authenticated" ON public.competitive_intel
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- F24
GRANT INSERT, UPDATE, DELETE ON public.competitive_intel TO service_role;

-- Config seeds
INSERT INTO public.harness_config (key, value, is_secret) VALUES
  ('COMPETITIVE_INTEL_RELEVANCE_THRESHOLD', '0.50', false),
  ('COMPETITIVE_INTEL_ENABLED', 'true', false)
ON CONFLICT (key) DO NOTHING;
