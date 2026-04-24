-- 0017_add_outbound_notifications.sql
-- Harness Telegram sandbox fix: outbound notification queue.
-- Coordinator inserts rows here instead of calling Telegram API directly
-- (sandbox blocks outbound HTTP). A Vercel cron drains the queue every minute.
-- Inbound webhook writes responses back for requires_response flows.
--
-- Status transitions:
--   pending → sent              (drain cron delivers successfully)
--   pending → failed            (attempts hits 5 with no success)
--   sent    → response_received (telegram-webhook writes back response)

CREATE TABLE public.outbound_notifications (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Destination channel. 'telegram' is the only channel in v1.
  channel              TEXT        NOT NULL,

  -- Telegram chat_id (or equivalent per-channel identifier).
  chat_id              TEXT,

  -- Full send payload: { text, parse_mode, reply_markup, ... }
  payload              JSONB       NOT NULL,

  -- Links this notification to the task_queue row or agent_events row that created it.
  correlation_id       TEXT,

  -- When true, coordinator polls this row until status = 'response_received'.
  requires_response    BOOLEAN     NOT NULL DEFAULT false,

  -- Captured from inbound webhook (thumb reaction, text reply, etc.).
  response             JSONB,
  response_received_at TIMESTAMPTZ,

  -- Lifecycle state.
  -- pending           → waiting for drain cron
  -- sent              → delivered to Telegram API
  -- failed            → attempts hit 5, giving up
  -- response_received → inbound webhook wrote a response back
  status               TEXT        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','sent','failed','response_received')),

  -- Retry tracking for the drain cron.
  attempts             INT         NOT NULL DEFAULT 0,
  last_error           TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at              TIMESTAMPTZ
);

COMMENT ON TABLE public.outbound_notifications IS
  'Outbound message queue for coordinator → Telegram (and future channels). '
  'Drain cron at /api/harness/notifications-drain flushes pending rows every minute. '
  'Inbound webhook at /api/harness/telegram-webhook writes responses back.';

-- Drain query: pending rows, oldest first, skip exhausted
CREATE INDEX outbound_notifications_drain_idx
  ON public.outbound_notifications (status, attempts, created_at ASC)
  WHERE status = 'pending';

-- Coordinator polling: look up a specific row by id efficiently
CREATE INDEX outbound_notifications_correlation_idx
  ON public.outbound_notifications (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- RLS: service role bypasses automatically.
-- Authenticated users get full access — single-user app.
ALTER TABLE public.outbound_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outbound_notifications_authenticated" ON public.outbound_notifications
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Rollback:
--   DROP TABLE IF EXISTS public.outbound_notifications;
