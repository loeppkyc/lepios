-- 0271_ai_routing_harness_config.sql
-- Hybrid Stack Routing Rule: seeds ai.routing.* keys in harness_config.
-- Valid values: 'ollama' | 'claude' | '' (empty = use lib/ai/routing.ts default)
-- F24: harness_config GRANT already satisfied by migration 0165 — AD7-exempt
-- AD7-exempt

INSERT INTO public.harness_config (key, value, is_secret, description) VALUES
  ('ai.routing.scoring',               '', false, 'Provider for scoring tasks. Empty=default (ollama).'),
  ('ai.routing.filtering',             '', false, 'Provider for filtering tasks. Empty=default (ollama).'),
  ('ai.routing.embedding',             '', false, 'Provider for embedding tasks. Empty=default (ollama).'),
  ('ai.routing.pre_research',          '', false, 'Provider for daytime-tick pre-research. Empty=default (ollama).'),
  ('ai.routing.llm_safety_review',     '', false, 'Provider for safety agent LLM diff review. Empty=default (ollama).'),
  ('ai.routing.twin_qa',               '', false, 'Provider for twin Q&A first pass. Empty=default (ollama).'),
  ('ai.routing.lightweight_synthesis', '', false, 'Provider for short summaries/bullets. Empty=default (ollama).'),
  ('ai.routing.ocr',                   '', false, 'Provider for receipt OCR (vision). Empty=default (claude).'),
  ('ai.routing.hard_synthesis',        '', false, 'Provider for multi-source synthesis. Empty=default (claude).'),
  ('ai.routing.validation',            '', false, 'Provider for validation/done-state drafting. Empty=default (claude).'),
  ('ai.routing.structured_extraction', '', false, 'Provider for JSON extraction from unstructured text. Empty=default (claude).')
ON CONFLICT (key) DO NOTHING;
