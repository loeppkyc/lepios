-- chat_ui Slice 6: tool invocation visibility + maxSteps

UPDATE public.harness_components
SET
  completion_pct = 100,
  notes = 'Slice 6 shipped: maxSteps=5 in streamText (enables dryRun loop), ToolCallCard renders tool-invocation parts inline in chat thread. chat_ui complete.',
  updated_at = now()
WHERE id = 'harness:chat_ui';
