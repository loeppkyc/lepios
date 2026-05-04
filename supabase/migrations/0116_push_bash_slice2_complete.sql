-- push_bash_automation Slice 2: inline keyboard + callback handler

-- 1. Add telegram_message_id column (nullable — populated after successful send)
ALTER TABLE public.push_bash_decisions
  ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT;

-- 2. Grant UPDATE so webhook can resolve pending rows
GRANT UPDATE ON public.push_bash_decisions TO service_role;

-- 3. Bump completion
UPDATE public.harness_components
SET
  completion_pct = 100,
  notes = 'Slice 2 shipped: inline keyboard on confirm tier, callback handler in telegram webhook (approve → runInSandbox, deny → mark denied). push_bash_automation complete.',
  updated_at = now()
WHERE id = 'harness:push_bash_automation';
