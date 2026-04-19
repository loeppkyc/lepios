-- Schema is speculative-for-Ollama. Designed for structured RAG ingestion but
-- the exact fields the retrieval layer needs are not verified. If the future
-- Ollama consumption shape differs, migrate rather than work around this schema.
-- Do not treat this schema as stable until the Ollama layer is built and tested.

CREATE TABLE public.agent_events (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    domain         TEXT        NOT NULL,
    action         TEXT        NOT NULL,
    actor          TEXT        NOT NULL DEFAULT 'system',
    status         TEXT        DEFAULT 'success'
                               CHECK (status IN ('success', 'error', 'warning')),
    input_summary  TEXT,
    output_summary TEXT,
    error_message  TEXT,
    duration_ms    INTEGER,
    session_id     TEXT,
    tags           JSONB,
    meta           JSONB
);

CREATE INDEX ON public.agent_events (occurred_at);
CREATE INDEX ON public.agent_events (domain, action);
CREATE INDEX ON public.agent_events (status);

ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_events_authenticated" ON public.agent_events
    FOR ALL
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
