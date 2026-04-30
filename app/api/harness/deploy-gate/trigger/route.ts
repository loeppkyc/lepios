import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_SHA_RE = /^[0-9a-f]{7,40}$/i

const TriggerSchema = z.object({
  task_id: z.string().regex(UUID_RE, 'task_id must be a valid UUID'),
  branch: z.string().refine((s) => s.startsWith('harness/task-'), {
    message: 'branch must start with "harness/task-"',
  }),
  commit_sha: z.string().regex(HEX_SHA_RE, 'commit_sha must be 7–40 hex chars'),
  run_id: z.string().regex(UUID_RE, 'run_id must be a valid UUID'),
  tests_passed: z.boolean(),
})

export async function POST(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = TriggerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { task_id, branch, commit_sha, run_id, tests_passed } = parsed.data
  const event_id = crypto.randomUUID()
  const received_at = new Date().toISOString()
  const status = tests_passed ? 'success' : ('error' as const)

  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      id: event_id,
      domain: 'orchestrator',
      action: 'deploy_gate_trigger',
      actor: 'deploy_gate',
      status,
      task_type: 'deploy_gate_triggered',
      output_summary: tests_passed
        ? `gate triggered for commit ${commit_sha} on ${branch}`
        : `gate triggered but tests_passed=false for commit ${commit_sha} on ${branch}`,
      meta: { task_id, branch, commit_sha, run_id, tests_passed, received_at },
      tags: ['deploy_gate', 'harness', 'chunk_a'],
    })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to write event' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, event_id })
}
