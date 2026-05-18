-- 0268_ai_coach_sessions.sql
-- AI Coach chat sessions. Each session holds a title and a JSONB array of
-- messages: { role: 'user'|'assistant', content: string, timestamp: string }.
-- The chat API (app/api/ai-coach/chat/route.ts) appends to the messages array
-- and keeps context for the Anthropic claude-haiku call.

CREATE TABLE ai_coach_sessions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT        NOT NULL DEFAULT 'New Session',
  messages   JSONB       NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owner_id   UUID        REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX acs_owner_id   ON ai_coach_sessions(owner_id);
CREATE INDEX acs_updated_at ON ai_coach_sessions(updated_at DESC);

ALTER TABLE ai_coach_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own coach sessions" ON ai_coach_sessions
  FOR ALL USING (owner_id = auth.uid());

GRANT INSERT, UPDATE, DELETE ON ai_coach_sessions TO service_role;
