/**
 * Ollama model name constants — single source of truth.
 *
 * Import from here. Never hardcode model strings at call sites.
 * When a fine-tuned model arrives, update ONE env var and all routes pick it up.
 *
 * Zero side effects: no API calls, no Supabase, pure constants.
 *
 * Note: values are read from process.env at access time (via getters) so that
 * env overrides set after module import (e.g., in tests) are honoured.
 */

export const OLLAMA_MODELS = {
  get GENERAL() {
    return process.env.OLLAMA_GENERAL_MODEL ?? 'qwen2.5:7b'
  },
  get ANALYSIS() {
    return process.env.OLLAMA_ANALYSIS_MODEL ?? 'qwen2.5:32b'
  },
  get CODE() {
    return process.env.OLLAMA_CODE_MODEL ?? 'qwen2.5-coder:7b'
  },
  get EMBED() {
    return process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text'
  },
  get TWIN() {
    return process.env.OLLAMA_TWIN_MODEL ?? 'qwen2.5:32b'
  },
} as const

export type OllamaTaskType = 'general' | 'analysis' | 'code' | 'embed' | 'twin'
