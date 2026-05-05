# Acceptance Doc — Twin Teach Slice 2 (escalation tracking + linkage)

Component: extends slice 1 (no new harness rollup component) · Date: 2026-05-05
Author: Coordinator
Branch: harness/twin-teach-slice-2 (from main, post-PR-#78)

**Slice 1 (PR #78) is merged and verified live. This slice extends it.**

---

## The gap (plain English)

Slice 1 built the door — Colin can curl `/api/twin/teach` to push a Q+A into the corpus. But two pieces are still manual:

1. **No record of what was asked.** When the twin escalates, the question vanishes. Colin has to remember it (or scroll Telegram) to teach it back.
2. **No link between the original question and the eventual answer.** If Colin teaches an answer two days after the escalation, nothing connects them.

Slice 2 fixes both: every escalation writes a row to a new `twin_escalations` table; the teach endpoint accepts an `escalation_id` and links the new knowledge row back to the escalation; morning_digest surfaces the open count so Colin sees the queue.

This is still the manual-curl version. Slice 3 (later) wires Telegram replies to fire `/api/twin/teach` automatically using the `escalation_id`.

## The gap (technical)

`lib/twin/query.ts:169-409` — `askTwin()` has 5 return paths where `escalate=true` (insufficient_context, ollama_unreachable+no_context, ollama_unreachable+claude_failed, claude returned special token, below_threshold). On every escalate-true return, we want to:

1. INSERT a row into `twin_escalations` capturing `(question, escalate_reason, source_event_id)`.
2. Return the new row id as `escalation_id` in the `TwinResponse`.

Then `app/api/twin/teach/route.ts` accepts an optional `escalation_id`. When provided + `saveKnowledge` succeeds, UPDATE the escalation row to status='answered' with the knowledge_id linkage.

`lib/orchestrator/digest.ts:311-313` — append a new line via `buildOpenEscalationsLine()` showing N open escalations in the last 24h (mirrors the smoke / self-repair / sandbox digest pattern).

---

## Scope

One migration + targeted edits to two existing files + one new digest file + tests. No new routes (the existing teach + ask routes are extended).

1. **`supabase/migrations/0125_twin_escalations.sql`** — creates `twin_escalations` table with FK to `agent_events`. RLS service-role + authenticated.
2. **`lib/twin/query.ts`** — extend `TwinResponse` with `escalation_id?: string | null`. Insert escalation row on every escalate-true path; thread the id back in the response.
3. **`app/api/twin/teach/route.ts`** — accept optional `escalation_id`; on save success, update the escalation row.
4. **`lib/harness/twin-escalations/digest.ts`** — new file; `buildOpenEscalationsLine()` queries `twin_escalations` for `status='open'` in last 24h.
5. **`lib/orchestrator/digest.ts`** — import + append after `smokeStatsLine`.
6. **Tests** — extend `tests/twin/query.test.ts` (escalate path inserts row + returns id), extend `tests/twin/teach.test.ts` (escalation_id propagates to UPDATE), new `tests/harness/twin-escalations/digest.test.ts` (mock-pattern from `tests/harness/sandbox/digest.test.ts` if present, else from `smoke-tests/digest.test.ts`).

No twin-route changes (the route already passes through the askTwin response). No telegram webhook changes. No knowledge-table changes.

---

## Deliverable 1 — `supabase/migrations/0125_twin_escalations.sql`

Builder: verify slot — `ls supabase/migrations/012*` — expect last is 0124. Use 0125.

```sql
-- Twin escalations: every askTwin escalate=true writes a row here.
-- Slice 2 of the escalation → corpus loop. Slice 1 (PR #78) is the
-- /api/twin/teach endpoint; this slice tracks the open queue and links
-- answers back to the originating question.

CREATE TABLE public.twin_escalations (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  question        TEXT         NOT NULL,
  escalate_reason TEXT         NOT NULL CHECK (
    escalate_reason IN ('insufficient_context', 'personal_escalation', 'below_threshold')
  ),
  source_event_id UUID         REFERENCES public.agent_events(id) ON DELETE SET NULL,
  status          TEXT         NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'answered', 'dismissed')
  ),
  knowledge_id    UUID         REFERENCES public.knowledge(id) ON DELETE SET NULL,
  answer          TEXT,
  answered_at     TIMESTAMPTZ
);

CREATE INDEX twin_escalations_status_idx     ON public.twin_escalations (status);
CREATE INDEX twin_escalations_created_at_idx ON public.twin_escalations (created_at DESC);

ALTER TABLE public.twin_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "twin_escalations_authenticated" ON public.twin_escalations
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Rollback:
--   DROP TABLE IF EXISTS public.twin_escalations;
```

### Grounding checks before writing

1. `ls supabase/migrations/012*` — confirm 0125 free.
2. `grep -n "REFERENCES public.agent_events" supabase/migrations/*.sql | head` — confirm FK pattern (used in 0011 + 0014).
3. `grep -n "REFERENCES public.knowledge" supabase/migrations/*.sql | head` — confirm `knowledge.id` is FK-able.
4. RLS pattern: copy from `knowledge_authenticated` policy in 0011.

---

## Deliverable 2 — `lib/twin/query.ts`

### Type extension (top of file)

```typescript
export interface TwinResponse {
  answer: string
  confidence: number
  sources: TwinSource[]
  escalate: boolean
  escalate_reason: EscalateReason
  retrieval_path: 'vector' | 'fts' | 'none'
  escalation_id: string | null // NEW: present when escalate=true and the row inserted; null otherwise
}
```

### New helper (after `claudeFallback`)

```typescript
async function recordEscalation(
  question: string,
  escalateReason: Exclude<EscalateReason, null>,
  sourceEventId: string | null
): Promise<string | null> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('twin_escalations')
      .insert({
        question: question.slice(0, 2000),
        escalate_reason: escalateReason,
        source_event_id: sourceEventId,
      })
      .select('id')
      .single()
    if (error || !data) return null
    return (data as { id: string }).id
  } catch {
    return null
  }
}
```

### askTwin changes

There are 5 return statements where `escalate=true`. Each must:

1. Capture the `agent_events` id from `logEvent` (currently `void logEvent(...)` — change to `const sourceEventId = await logEvent(...) ?? null`).
2. Call `recordEscalation(question, escalate_reason, sourceEventId)` to get `escalation_id`.
3. Include `escalation_id` in the returned object.

For non-escalate returns (the final `return { answer, confidence, ... }` when escalate=false), include `escalation_id: null`.

**Specific edits:**

- Line ~229: change `void logEvent(...)` to capture id
- Line ~248-249: add `const escalation_id = await recordEscalation(...)`; include in returned object
- Line ~264-282: same pattern for the claude_failed branch
- Line ~300-327: same for the claude special-token branch (note this one isn't strictly escalate=true at the moment of logging — only certain reasons trigger escalate; check the variable state)
- Line ~377-407: same for the final return (only call recordEscalation when escalate=true; pass null otherwise)

The cleanest refactor: extract the final logEvent + return into a helper that handles "log, record, return" so each escalate-true exit is one call. But that's a bigger change. Simpler: do it inline 5 times.

### Grounding checks before writing

1. Read `lib/twin/query.ts` end to end (already read — 410 lines).
2. Confirm `logEvent` returns `Promise<string | null>` per `lib/knowledge/client.ts:46-92`.
3. Confirm `createServiceClient` is already imported (line 10).

---

## Deliverable 3 — `app/api/twin/teach/route.ts`

### Changes

Add `escalation_id?: string` to `TeachBody`. After `saveKnowledge` succeeds and before logging success:

```typescript
if (body.escalation_id) {
  try {
    const supabase = createServiceClient()
    await supabase
      .from('twin_escalations')
      .update({
        status: 'answered',
        knowledge_id: knowledgeId,
        answer: answer,
        answered_at: new Date().toISOString(),
      })
      .eq('id', body.escalation_id)
  } catch {
    // Soft-fail: the knowledge row is saved; the linkage is best-effort.
    // Logged via the success agent_event below.
  }
}
```

Add `import { createServiceClient } from '@/lib/supabase/service'` at the top.

The success `logEvent` meta gains `escalation_id: body.escalation_id ?? null`.

### Grounding checks before writing

1. Confirm `createServiceClient` import path: `grep -n "createServiceClient" lib/supabase/service.ts | head -3`.
2. Confirm body parsing pattern matches existing teach route.

---

## Deliverable 4 — `lib/harness/twin-escalations/digest.ts`

New file. Mirror `lib/harness/smoke-tests/digest.ts` exactly.

```typescript
import { createServiceClient } from '@/lib/supabase/service'

export async function buildOpenEscalationsLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data, error } = await db
      .from('twin_escalations')
      .select('id', { count: 'exact', head: false })
      .eq('status', 'open')
      .gte('created_at', since)
      .limit(500)

    if (error) return 'Twin escalations: stats unavailable'

    const open24h = (data ?? []).length

    if (open24h === 0) return 'Twin escalations (24h): 0 open'
    return `Twin escalations (24h): ${open24h} open — teach via /api/twin/teach with escalation_id`
  } catch {
    return 'Twin escalations: stats unavailable'
  }
}
```

---

## Deliverable 5 — `lib/orchestrator/digest.ts`

Insert immediately after `smokeStatsLine` (line ~311):

```typescript
import { buildOpenEscalationsLine } from '@/lib/harness/twin-escalations/digest'

// ...later, after the smokeStatsLine block...

// ── Twin escalation queue — open count in last 24h ──────────────────────────
const twinEscalationsLine = await buildOpenEscalationsLine()
messageToSend = `${messageToSend}\n${twinEscalationsLine}`
```

### Grounding checks before writing

1. Read `lib/orchestrator/digest.ts:305-315` — confirm exact insertion point.
2. Confirm import block end and follow the existing alphabetical-ish pattern.

---

## Deliverable 6 — Tests

### `tests/twin/query.test.ts` — extend

Add 2 cases:

**AC: returns escalation_id when escalate=true and insert succeeds**

- Mock `from('twin_escalations').insert(...).select('id').single()` to return `{data:{id:'esc-1'}, error:null}`.
- Set up askTwin to escalate (e.g. force claude to return `personal_escalation`).
- Assert response `.escalation_id === 'esc-1'`.
- Assert `escalate === true`.

**AC: returns escalation_id=null when insert fails**

- Mock the same insert to return `{data:null, error: new Error('db')}`.
- Same setup.
- Assert response `.escalation_id === null`.
- Assert `escalate === true` (still).

### `tests/twin/teach.test.ts` — extend

Add 2 cases:

**AC: when escalation_id provided + save succeeds, escalation row is updated**

- Mock saveKnowledge to return `'k-1'`.
- Mock supabase update chain.
- POST `{question, answer, escalation_id: 'esc-1'}`.
- Assert update called with `{status:'answered', knowledge_id:'k-1', answer:answer, answered_at:<iso>}` and `.eq('id', 'esc-1')`.

**AC: when escalation_id absent, no update fires**

- POST without `escalation_id`.
- Assert no `from('twin_escalations')` call.

### `tests/harness/twin-escalations/digest.test.ts` — new

Mirror `tests/harness/smoke-tests/digest.test.ts` (or self-repair equivalent). 4 cases:

- 0 open → `'Twin escalations (24h): 0 open'`
- 3 open → `'Twin escalations (24h): 3 open — teach via /api/twin/teach with escalation_id'`
- DB error → `'Twin escalations: stats unavailable'`
- createServiceClient throws → `'Twin escalations: stats unavailable'`

---

## Acceptance criteria

**AC-1: Migration 0125 applies cleanly**
`mcp__claude_ai_Supabase__apply_migration` succeeds; `SELECT * FROM twin_escalations LIMIT 0` returns expected columns.

**AC-2: askTwin returns escalation_id on escalate=true**
Test in `tests/twin/query.test.ts`.

**AC-3: askTwin returns escalation_id=null on escalate=false**
Test in `tests/twin/query.test.ts`.

**AC-4: askTwin returns escalation_id=null when DB insert fails (escalate still true)**
Test in `tests/twin/query.test.ts`.

**AC-5: /api/twin/teach updates escalation row when escalation_id provided**
Test in `tests/twin/teach.test.ts`.

**AC-6: /api/twin/teach skips the update when escalation_id is omitted**
Test in `tests/twin/teach.test.ts`.

**AC-7: digest line shows correct count formats**
Test in new digest test file.

**AC-8: digest.ts imports + appends the new line**
`grep -n "buildOpenEscalationsLine\|twinEscalationsLine" lib/orchestrator/digest.ts` — assert ≥3 matches (import + assignment + append).

**AC-9: F22 — no inline auth in modified routes**
`grep -nE "(if \(.*CRON_SECRET|function isAuthorized)" app/api/twin/teach/route.ts lib/twin/query.ts` — 0 matches.

**AC-10: F20 — no inline style attributes**
N/A (no TSX changes).

**AC-11: TypeScript compiles clean**
`npx tsc --noEmit` — no new errors. Pre-existing sandbox/security errors unaffected.

**AC-12: Full suite green**
`SKIP_AI_REVIEW=1 npx vitest run` — same baseline (0 failures pre-slice; 0 failures post-slice).

**AC-13: Live smoke (post-deploy, optional)**
Coordinator validates after merge:

1. Hit `/api/twin/ask` with a question the corpus can't answer.
2. Confirm response has `escalate=true` and `escalation_id` is a UUID.
3. SELECT the row from `twin_escalations` — confirm `status='open'`.
4. Hit `/api/twin/teach` with `{question, answer, escalation_id}`.
5. Confirm response has `knowledge_id`.
6. SELECT the row again — confirm `status='answered'`, `knowledge_id` set, `answered_at` populated.
7. Re-ask the original question — confirm `escalate=false` (or higher confidence).

---

## Grounding checklist

1. Read `lib/twin/query.ts` end to end (410 lines) — confirm 5 escalate=true return paths.
2. Read `lib/knowledge/client.ts:46-92` — confirm `logEvent` returns `Promise<string | null>`.
3. `ls supabase/migrations/012*` — confirm 0125 free.
4. `grep -n "REFERENCES public.agent_events" supabase/migrations/*.sql` — confirm FK precedent.
5. Read `lib/orchestrator/digest.ts:305-315` — confirm exact insertion point.
6. Read `lib/harness/smoke-tests/digest.ts` — confirm exact pattern for new digest module.
7. Read `tests/harness/smoke-tests/digest.test.ts` (or sandbox equivalent) — confirm test pattern for digest modules.

---

## Out of scope (future slices)

- **Slice 3:** Telegram reply auto-fires `/api/twin/teach` using `escalation_id` from the outbound notification's `correlation_id`. Closes the loop end-to-end without Colin touching curl.
- **Slice 4 (optional):** dedup — same un-answered question doesn't create N rows. Add `dedup_key` column + unique index where `status='open'`.
- **Cockpit UI:** a `/twin/escalations` page listing open escalations with inline answer field. Not in this slice; current curl + digest count is enough for Colin to act.

This slice does not change the Telegram webhook, the outbound notifications drain, or any existing route except `app/api/twin/teach/route.ts` (extension only).

---

## Rollup impact

No harness component bumped (no rollup row exists for `twin_escalation_loop`). Slice 4 (optional) introduces one if Colin wants tracker visibility.

The compounding effect kicks in on ship: every escalation is captured, the answer queue is visible in morning_digest, and answers link back to their originating question for audit.
