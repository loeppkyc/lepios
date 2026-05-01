-- 0042_orb_chat_schema.sql
-- orb-A2: Conversations + messages tables for the Orb chat UI.
-- Decisions: user_id FK (per-user RLS), content JSONB (AI SDK 6 parts format),
--            archived_at soft-delete, DB trigger for updated_at + message_count.
-- Grounding doc: docs/sprint-5/grounding/orb-A2.md (resolved 2026-04-27)

-- ── conversations ─────────────────────────────────────────────────────────────

CREATE TABLE public.conversations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        TEXT,                                    -- first 50 chars of first user message
  message_count INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at  TIMESTAMPTZ                              -- NULL = active; non-NULL = soft-deleted
);

-- Fetch active conversations sorted by most recent activity
CREATE INDEX conversations_user_idx  ON public.conversations (user_id, updated_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_owner" ON public.conversations
  FOR ALL TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── messages ──────────────────────────────────────────────────────────────────

CREATE TABLE public.messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  -- AI SDK 6 UIMessage.parts[] — stored as JSONB array: [{"type":"text","text":"..."}]
  content         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  model           TEXT,                                -- NULL for user messages
  tokens_used     INT,                                 -- NULL if model doesn't report
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary access pattern: load all messages for a conversation in order
CREATE INDEX messages_conversation_idx ON public.messages (conversation_id, created_at ASC);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Messages inherit ownership through their conversation
CREATE POLICY "messages_owner" ON public.messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.user_id = auth.uid()
    )
  );

-- ── DB trigger: keep conversations.updated_at + message_count current ─────────

CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.conversations
  SET updated_at    = now(),
      message_count = message_count + 1
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_update_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_conversation_on_message();

-- ── Rollback ──────────────────────────────────────────────────────────────────
--   DROP TRIGGER IF EXISTS messages_update_conversation ON public.messages;
--   DROP FUNCTION IF EXISTS public.update_conversation_on_message();
--   DROP TABLE IF EXISTS public.messages;
--   DROP TABLE IF EXISTS public.conversations;
