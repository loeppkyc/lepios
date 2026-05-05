# Acceptance Doc — Twin Teach Slice 1 (escalation → corpus loop)

Component: new (no harness rollup component yet — slice 2 may add one) · Date: 2026-05-05
Author: Coordinator
Branch: harness/twin-teach-slice-1 (create from main)

**All prerequisites met. Builder may start immediately.**

---

## The gap

Twin escalates to Colin (`escalate_reason: personal_escalation | insufficient_context | below_threshold` — see `lib/twin/query.ts:16,332-374`). Colin answers the question (in chat, in Telegram, in person). The answer goes nowhere. Next time the same or a similar question hits the twin, it escalates again.

The compounding loop is broken: every Colin answer is consumed once and discarded. The knowledge store already supports the round trip — `saveKnowledge` auto-embeds via Ollama, dedupes via `content_hash`, and the twin retrieves over the same table via `match_knowledge` RPC + FTS fallback (`lib/twin/query.ts:84-117`). What's missing is the write path from "Colin answered an escalation" to a row in `knowledge`.

This slice is the minimum viable closure: a single endpoint that captures `{question, answer}` and writes it to the corpus. Future slices automate the capture (Slice 2: track escalations + correlation; Slice 3: Telegram reply auto-ingest).

---

## Scope

One new route + one new test file. No migration, no schema change, no twin code change.

1. **`app/api/twin/teach/route.ts`** — new POST endpoint. Auth via `requireCronSecret`. Validates body, calls `saveKnowledge`, returns `{ knowledge_id }`.
2. **`tests/twin/teach.test.ts`** — new test file. 6 acceptance tests. Mocks `saveKnowledge` and the auth helper.

That's it. No twin route changes, no telegram webhook changes, no schema changes.

---

## Deliverable 1 — `app/api/twin/teach/route.ts`

New file. Follow the pattern of any existing `requireCronSecret`-gated POST route (e.g. `app/api/cron/cleanup-orphan-convs/route.ts`).

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { saveKnowledge } from '@/lib/knowledge/client'
import { logEvent } from '@/lib/knowledge/client'

export const dynamic = 'force-dynamic'

interface TeachBody {
  question?: string
  answer?: string
  source_event_id?: string
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<{ knowledge_id: string } | { error: string }>> {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: TeachBody
  try {
    body = (await request.json()) as TeachBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const question = (body.question ?? '').trim()
  const answer = (body.answer ?? '').trim()

  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 })
  }
  if (!answer) {
    return NextResponse.json({ error: 'answer is required' }, { status: 400 })
  }

  // Truncate title to a reasonable preview length; saveKnowledge truncates at 300.
  const title = question.length > 100 ? `${question.slice(0, 97)}...` : question

  const knowledgeId = await saveKnowledge('principle', 'twin', title, {
    problem: question,
    solution: answer,
    context: 'Captured from twin escalation; taught by Colin via /api/twin/teach',
    entity: 'twin-teach',
    confidence: 0.85,
    sourceEvents: body.source_event_id ? [body.source_event_id] : undefined,
  })

  if (!knowledgeId) {
    void logEvent('twin', 'twin.teach', {
      actor: 'colin',
      status: 'error',
      inputSummary: question.slice(0, 200),
      outputSummary: 'saveKnowledge returned null',
    })
    return NextResponse.json({ error: 'failed to save knowledge' }, { status: 500 })
  }

  void logEvent('twin', 'twin.teach', {
    actor: 'colin',
    status: 'success',
    inputSummary: question.slice(0, 200),
    outputSummary: `taught: ${title}`,
    meta: { knowledge_id: knowledgeId, source_event_id: body.source_event_id ?? null },
  })

  return NextResponse.json({ knowledge_id: knowledgeId }, { status: 200 })
}
```

### Grounding checks before writing

1. Confirm `requireCronSecret` signature: `grep -n "export function requireCronSecret" lib/auth/cron-secret.ts` — should return `NextResponse | null`.
2. Confirm `saveKnowledge` signature: `grep -n "export async function saveKnowledge" lib/knowledge/client.ts` — should accept `(category, domain, title, opts)` and return `Promise<string | null>`.
3. Confirm `'principle'` is a valid `KnowledgeCategory`: `grep -n "principle" lib/knowledge/types.ts` — should appear in the type union.
4. Confirm twin's `SEARCHABLE_CATEGORIES` includes `'principle'`: `grep -n "SEARCHABLE_CATEGORIES" lib/twin/query.ts` — should be in the array. (If not, the taught knowledge won't be retrievable — slice fails its purpose.)
5. Confirm `logEvent` signature: `grep -n "export async function logEvent" lib/knowledge/client.ts` — accepts `(domain, action, opts)`.

---

## Deliverable 2 — `tests/twin/teach.test.ts`

New file. Mock `requireCronSecret`, `saveKnowledge`, `logEvent`. No real DB, no real network.

### Test list (all must pass)

**AC-1: 200 with knowledge_id on valid request**

- Mock `requireCronSecret` to return `null` (authorized).
- Mock `saveKnowledge` to return `'abc-123-uuid'`.
- POST `{ question: 'How does Colin handle X?', answer: 'He does Y because Z.' }`.
- Assert response status `=== 200`.
- Assert response body `=== { knowledge_id: 'abc-123-uuid' }`.
- Assert `saveKnowledge` called with `('principle', 'twin', 'How does Colin handle X?', { problem, solution, context, entity: 'twin-teach', confidence: 0.85, sourceEvents: undefined })`.

**AC-2: 401 when auth fails**

- Mock `requireCronSecret` to return `NextResponse.json({error:'Unauthorized'}, {status:401})`.
- POST `{ question: 'q', answer: 'a' }`.
- Assert response status `=== 401`.
- Assert `saveKnowledge` NOT called.

**AC-3: 400 on missing question**

- Mock `requireCronSecret` to return `null`.
- POST `{ answer: 'a' }`.
- Assert response status `=== 400`.
- Assert response body `.error === 'question is required'`.
- Assert `saveKnowledge` NOT called.

**AC-4: 400 on missing answer**

- Mock `requireCronSecret` to return `null`.
- POST `{ question: 'q' }`.
- Assert response status `=== 400`.
- Assert response body `.error === 'answer is required'`.

**AC-5: 400 on invalid JSON**

- Mock `requireCronSecret` to return `null`.
- POST raw body `'not json'` with `Content-Type: application/json`.
- Assert response status `=== 400`.
- Assert response body `.error === 'invalid JSON body'`.

**AC-6: 500 when saveKnowledge returns null**

- Mock `requireCronSecret` to return `null`.
- Mock `saveKnowledge` to return `null` (DB error path).
- POST `{ question: 'q', answer: 'a' }`.
- Assert response status `=== 500`.
- Assert response body `.error === 'failed to save knowledge'`.

**AC-7: source_event_id propagates to saveKnowledge.sourceEvents**

- Mock `requireCronSecret` to return `null`.
- Mock `saveKnowledge` to return `'id'`.
- POST `{ question: 'q', answer: 'a', source_event_id: 'event-uuid-123' }`.
- Assert `saveKnowledge` called with `sourceEvents: ['event-uuid-123']`.

**AC-8: title truncation when question >100 chars**

- POST a 200-char question.
- Assert `saveKnowledge` called with title of length 100 ending in `'...'`.

**AC-9: All prior tests pass**
`SKIP_AI_REVIEW=1 npm test` — same baseline as before this slice (currently 0 failing). Nothing new fails.

---

## Acceptance criteria

**AC-1 through AC-8:** see test list. Each test is a pass/fail.

**AC-9: F22 compliance — uses `requireCronSecret` helper**
`grep -n "requireCronSecret\|isAuthorized\|CRON_SECRET" app/api/twin/teach/route.ts`

- Must contain `requireCronSecret`.
- Must NOT contain inline `if (CRON_SECRET)` or `function isAuthorized`. ESLint will flag this; reviewer agent will block.

**AC-10: F20 compliance — no inline style attributes**
`grep -n "style={" app/api/twin/teach/route.ts` — assert 0 matches. (No TSX in this file; trivially passes.)

**AC-11: TypeScript compiles clean**
`npx tsc --noEmit` — exits 0.

**AC-12: Manual smoke (post-deploy, optional)**
Builder is NOT required to run this — it's a Colin-side verification. Listed here so the loop closure is provable.

```bash
# Replace $CRON_SECRET with actual value.
curl -X POST https://lepios-one.vercel.app/api/twin/teach \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"question":"What is Colin'\''s preferred slice size?","answer":"Tight scope, single window, ship in one go. See task-protocol.md."}'
# Expected: 200 with {"knowledge_id":"<uuid>"}

# Verify retrievability:
curl -X POST https://lepios-one.vercel.app/api/twin/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"What slice size does Colin prefer?"}'
# Expected: answer references tight scope / single window; escalate=false.
```

---

## Grounding checklist

1. Read `lib/auth/cron-secret.ts` (full file, 36 lines) — confirm `requireCronSecret` signature.
2. Read `lib/knowledge/client.ts:123-200` — confirm `saveKnowledge` signature + return type.
3. Read `lib/knowledge/types.ts:3-12` — confirm `'principle'` is in `KnowledgeCategory` union.
4. Read `lib/twin/query.ts:53-60` — confirm `'principle'` is in `SEARCHABLE_CATEGORIES`.
5. Confirm migration slot 0125 free (no migration in this slice, but verify path is clean for slice 2): `ls supabase/migrations/012*` — last is `0124_oura_daily.sql`.
6. No existing `app/api/twin/teach/route.ts`.
7. No existing `tests/twin/teach.test.ts`.

---

## Out of scope (future slices)

- **Slice 2 (next):** `twin_escalations` tracking table — every twin escalation writes a row with `{question, escalate_reason, source_event_id, status, knowledge_id, answered_at}`. `askTwin` returns `escalation_id` in response. Surfaces "open escalations" count in morning_digest.
- **Slice 3:** Telegram correlation — when twin escalates and notifies Colin via `outbound_notifications`, Colin's text reply (matched by `correlation_id` or `reply_to_message_id`) auto-fires `/api/twin/teach`. Closes the loop without Colin running curl.
- **Slice 4 (optional):** harness component `twin_escalation_loop` added to rollup, with weight + completion %.

This slice does not change `askTwin`, the twin route, the telegram webhook, the outbound notifications drain, or any migration. All of that is deliberately deferred.

---

## Rollup impact

No rollup component bumped in this slice. Slice 4 (optional) introduces one if Colin wants tracker visibility.

The compounding effect kicks in immediately on ship: every Colin answer fed to `/api/twin/teach` becomes a retrievable corpus chunk. Slice 2+ just remove the manual curl step.
