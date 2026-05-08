/**
 * POST /api/failures/promote
 *
 * "Promote to harness test" action — generates a regression test stub from a
 * logged failure. The stub lives at:
 *   tests/regression/<failure_number_or_hash>.test.ts
 *
 * The body includes the failure_id, failure_number, and pattern_signature.
 * The endpoint returns { ok, test_path, content_preview } so the cockpit
 * page can show "✓ tests/regression/F-N7.test.ts" as success feedback.
 *
 * Implementation note: rather than write to disk (Vercel filesystem is
 * read-only), this endpoint stores the generated test content in
 * `agent_events` (action='failures_log.promote_to_test') with the path it
 * WOULD live at. Coordinator picks it up from there to commit later.
 *
 * Spec: docs/leverage-targets.md#t-006--failures-log-revised-2026-05-08
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const PostBody = z.object({
  failure_id: z.string().uuid(),
  failure_number: z.string().nullish(),
  pattern_signature: z.record(z.string(), z.unknown()),
})

function buildTestStub(input: {
  failure_number: string | null
  failure_id: string
  pattern_signature: Record<string, unknown>
  title: string
  what_happened: string
  lesson: string | null
}): { test_path: string; content: string } {
  const idPart = input.failure_number ?? input.failure_id.slice(0, 8)
  const slug = idPart.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const test_path = `tests/regression/${slug}.test.ts`

  const sig = JSON.stringify(input.pattern_signature, null, 2)

  const content = `/**
 * Regression test for ${idPart} — ${input.title}
 *
 * Auto-generated from failures_log row ${input.failure_id}.
 * Do not delete unless the underlying failure is confirmed unrecurring.
 *
 * What happened: ${input.what_happened.replace(/\\n/g, ' ').slice(0, 200)}
 * Lesson: ${input.lesson ?? '(none recorded)'}
 *
 * Pattern signature:
 * ${sig
   .split('\\n')
   .map((l) => ' * ' + l)
   .join('\\n')}
 */

import { describe, it, expect } from 'vitest'

describe('regression: ${idPart}', () => {
  it.todo('reproduce the failure path then assert it stays fixed')

  // TODO(coordinator): replace it.todo with a real assertion that would
  // fail if the original bug recurred. Pattern signature above gives the
  // shape — touch the same files, trigger the same error_class, etc.
  it('placeholder — pattern signature captured', () => {
    expect(${JSON.stringify(input.pattern_signature)}).toBeDefined()
  })
})
`
  return { test_path, content }
}

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) return gate.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = PostBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const db = createServiceClient()
  const { data: row, error } = await db
    .from('failures_log')
    .select('failure_number, title, what_happened, lesson, pattern_signature')
    .eq('id', parsed.data.failure_id)
    .single()

  if (error || !row) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'failure not found' },
      { status: 404 }
    )
  }

  const r = row as {
    failure_number: string | null
    title: string
    what_happened: string
    lesson: string | null
    pattern_signature: Record<string, unknown>
  }
  const stub = buildTestStub({
    failure_id: parsed.data.failure_id,
    failure_number: r.failure_number,
    pattern_signature: r.pattern_signature,
    title: r.title,
    what_happened: r.what_happened,
    lesson: r.lesson,
  })

  // Vercel filesystem is read-only — store the generated stub in
  // agent_events for coordinator to commit on next session.
  await db.from('agent_events').insert({
    domain: 'failures_log',
    action: 'failures_log.promote_to_test',
    actor: 'cockpit_user',
    status: 'success',
    meta: {
      failure_id: parsed.data.failure_id,
      failure_number: r.failure_number,
      test_path: stub.test_path,
      content: stub.content,
    },
    occurred_at: new Date().toISOString(),
  })

  return NextResponse.json({
    ok: true,
    test_path: stub.test_path,
    content_preview: stub.content.slice(0, 500),
  })
}
