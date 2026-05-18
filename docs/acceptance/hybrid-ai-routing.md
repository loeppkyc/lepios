# Hybrid Stack Routing Rule — Acceptance Doc

**Migration:** `0271_ai_routing_harness_config.sql` (pre-claimed, branch `feat/hybrid-ai-routing`)
**F-rules:** F17, F18, F21, F24 (no new table — harness_config grants satisfied by 0165)

---

## What This Builds

A TypeScript routing layer `lib/ai/routing.ts` that formalizes which AI tasks go to Ollama vs Claude. Backed by `harness_config` overrides so Colin can change routing without a deploy. Also corrects stale `qwen2.5:32b` defaults throughout the codebase (the GPU cannot run 32B models — max is 14B, default is Phi-4 14B).

---

## Read These Files First (Check-Before-Build)

Before writing any code, read:
- `lib/ollama/client.ts` — existing `generate()`, `hydrateOllamaConfig()`, `OllamaUnreachableError`
- `lib/ollama/models.ts` — stale `OLLAMA_ANALYSIS_MODEL` default (`qwen2.5-coder:14b` → `phi4:14b`)
- `lib/twin/query.ts` — stale `getTwinConfig()` default (`qwen2.5:32b` → `phi4:14b`)
- `lib/harness/safety/llm-review.ts` — stale fallback (`qwen2.5:32b` → `phi4:14b`)
- `lib/ollama/client.ts` line with comment about `qwen2.5:32b` in analysis task

---

## Migration — `0271_ai_routing_harness_config.sql`

No new table. Seeds routing config keys into existing `harness_config` table.

```sql
-- 0271_ai_routing_harness_config.sql
-- Hybrid Stack Routing Rule: seeds ai.routing.* keys in harness_config.
-- Valid values: 'ollama' | 'claude' | '' (empty = use lib/ai/routing.ts default)
-- F24: harness_config GRANT already in migration 0165 — no additional grant needed.
-- F24-note: -- AD7-exempt (no CREATE TABLE in this migration)

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
```

---

## New File — `lib/ai/routing.ts`

```typescript
export type AITaskType =
  | 'scoring' | 'filtering' | 'embedding' | 'pre_research'
  | 'llm_safety_review' | 'twin_qa' | 'lightweight_synthesis'
  | 'ocr' | 'hard_synthesis' | 'validation' | 'structured_extraction'

export type AIProvider = 'ollama' | 'claude'

// Default routing table — the contract. Change requires acceptance doc update.
const DEFAULT_ROUTING: Record<AITaskType, AIProvider> = {
  scoring:               'ollama',
  filtering:             'ollama',
  embedding:             'ollama',
  pre_research:          'ollama',
  llm_safety_review:     'ollama',
  twin_qa:               'ollama',
  lightweight_synthesis: 'ollama',
  ocr:                   'claude',
  hard_synthesis:        'claude',
  validation:            'claude',
  structured_extraction: 'claude',
}

// Hydration cache — same TTL pattern as hydrateOllamaConfig()
let _overrides: Partial<Record<AITaskType, AIProvider>> = {}
let _hydratedAt: number | null = null
const HYDRATE_TTL_MS = 5 * 60 * 1000

export async function hydrateRoutingConfig(force = false): Promise<void>
// Read ai.routing.* from harness_config via createServiceClient()
// Swallow errors — fall back to DEFAULT_ROUTING on any failure

export function _resetRoutingCache(): void  // test-only

export function routeAICall(taskType: AITaskType): AIProvider
// Returns harness_config override if non-empty, else DEFAULT_ROUTING[taskType]
// When override is active and differs from default: log to agent_events (fire-and-forget)
// agent_events row: domain='ai', action='ai.routing_override', meta={task_type, provider, override_source:'harness_config'}
```

---

## Code Default Corrections (same PR)

Fix all stale `qwen2.5:32b` references in live code (not test fixtures/mocks):

1. `lib/ollama/models.ts` — `OLLAMA_ANALYSIS_MODEL` default → `'phi4:14b'`
2. `lib/ollama/models.ts` — `OLLAMA_TWIN_MODEL` default → `'phi4:14b'`
3. `lib/twin/query.ts` — `getTwinConfig()` fallback → `'phi4:14b'`
4. `lib/harness/safety/llm-review.ts` — fallback → `'phi4:14b'`
5. `lib/ollama/client.ts` — update comment referencing `qwen2.5:32b`

**After corrections:** `grep -r "qwen2.5:32b" lib/` must return zero matches.

## CLAUDE.md Correction

In `CLAUDE.md` §2 Stack section, replace:
> `Ollama (Qwen 2.5 32B, Phi-4 14B)`

with:
> `Ollama (default: Phi-4 14B; max supported: 14B params — GPU VRAM constraint)`

Also correct the same stale reference in `ARCHITECTURE.md` §9.

Note: `CLAUDE.md` and `ARCHITECTURE.md` are **shared seams** — commit must include `[seam-approved]` in the message.

---

## Tests — `tests/ai/routing.test.ts`

- Default routing returns correct provider for all 11 task types (no DB call)
- Override from mocked harness_config returns `'claude'` for a normally-ollama task
- Empty string in harness_config falls back to default
- Supabase error in hydration does not throw (returns default)
- Cache TTL: second call within TTL uses cache (spy on createServiceClient)

---

## Acceptance Criteria

### Migration
- [ ] `supabase/migrations/0271_ai_routing_harness_config.sql` exists
- [ ] Contains exactly 11 INSERT rows with `ON CONFLICT (key) DO NOTHING`
- [ ] Header comment includes `-- AD7-exempt` or equivalent F24 note
- [ ] `SELECT count(*) FROM harness_config WHERE key LIKE 'ai.routing.%'` = 11 on live Supabase

### lib/ai/routing.ts
- [ ] All 3 exports present: `routeAICall`, `hydrateRoutingConfig`, `_resetRoutingCache`
- [ ] `routeAICall('scoring')` → `'ollama'` (no DB needed after hydration)
- [ ] `routeAICall('hard_synthesis')` → `'claude'`
- [ ] All 11 task types return a valid AIProvider

### Code corrections
- [ ] `grep -r "qwen2.5:32b" lib/` returns 0 matches
- [ ] `CLAUDE.md` no longer contains `Qwen 2.5 32B`

### Tests
- [ ] `tests/ai/routing.test.ts` exists with ≥ 5 test cases
- [ ] `npm test` passes (no regressions)
- [ ] `tsc --noEmit` exits 0

---

## Out of Scope
- Migrating existing callers to use `routeAICall()` (incremental adoption)
- UI for routing audit (use Supabase SQL editor)
- Evaluation harness comparing Ollama vs Claude accuracy

## F17
Routing decision log (agent_events, action='ai.routing_override') = behavioral data point: which tasks Colin promotes to Claude reveals resource allocation under constraint.

## F18
- **Metric:** Ollama routing rate (% of non-OCR AI calls on Ollama)
- **Target:** ≥ 70% of non-OCR calls routed to Ollama within 30 days
- **Query:** existing `/local-ai` cockpit token-stats route already surfaces Ollama vs Claude split
