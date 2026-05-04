-- 0115_telegram_thumbs_complete.sql
-- Telegram Thumbs feedback feature — Component #2
-- Bumps harness:telegram_outbound 50 → 100%
--
-- Code shipped in this chunk:
--   lib/harness/telegram-buttons.ts    — sendMessageWithButtons + parseCallbackData
--   app/api/telegram/webhook/route.ts  — callback_query handler: auth, feedback write, edit
--   lib/harness/pickup-runner.ts       — agent_events inserted before Telegram send
--   tests/harness/telegram-thumbs.test.ts — ACs 1–12
--
-- task_feedback table already exists from migration 0014_add_quality_scoring.sql.
-- No new tables or columns added.
--
-- Verify post-apply:
--   SELECT id, completion_pct, notes FROM harness_components
--   WHERE id = 'harness:telegram_outbound';
--   -- expects: completion_pct = 100

UPDATE public.harness_components
SET completion_pct = 100,
    notes          = 'Thumbs buttons shipped: sendMessageWithButtons, webhook callback handler (app/api/telegram/webhook), pickup-runner order reversed (agent_events first), tests/harness/telegram-thumbs.test.ts ACs 1-12.',
    updated_at     = NOW()
WHERE id = 'harness:telegram_outbound';
