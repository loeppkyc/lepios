-- Langfuse observability — self-hosted in Supabase Postgres (langfuse schema).
-- See docs/research/oss-scout.md Pattern #7 + docs/standing/observability.md.
-- Mirrors Langfuse SDK semantics: traces contain observations (spans, generations, events).
-- Schema + wrapper only. Actual instrumentation wired in a follow-on task.

CREATE SCHEMA IF NOT EXISTS langfuse;

-- ── traces ─────────────────────────────────────────────────────────────────────
-- One row per top-level operation (e.g. a Twin ask, a chat turn, a nightly batch run).

CREATE TABLE langfuse.traces (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  user_id     TEXT        NOT NULL DEFAULT 'system',
  metadata    JSONB,
  start_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX traces_user_start_idx ON langfuse.traces (user_id, start_time DESC);

ALTER TABLE langfuse.traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "traces_authenticated" ON langfuse.traces
  FOR ALL TO authenticated
  USING  (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── observations ───────────────────────────────────────────────────────────────
-- Child records of a trace. type='generation' for LLM calls, 'span' for logical
-- blocks, 'event' for discrete point-in-time signals.

CREATE TABLE langfuse.observations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id          UUID        NOT NULL REFERENCES langfuse.traces(id) ON DELETE CASCADE,
  type              TEXT        NOT NULL CHECK (type IN ('span', 'generation', 'event')),
  name              TEXT        NOT NULL,
  model             TEXT,
  input             JSONB,
  output            JSONB,
  prompt_tokens     INT,
  completion_tokens INT,
  latency_ms        INT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ
);

CREATE INDEX observations_trace_idx ON langfuse.observations (trace_id, started_at ASC);

ALTER TABLE langfuse.observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "observations_authenticated" ON langfuse.observations
  FOR ALL TO authenticated
  USING (
    trace_id IN (SELECT id FROM langfuse.traces WHERE auth.uid() IS NOT NULL)
  )
  WITH CHECK (
    trace_id IN (SELECT id FROM langfuse.traces WHERE auth.uid() IS NOT NULL)
  );
