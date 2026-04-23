import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const InvokeSchema = z.object({
  task_id: z.string().regex(UUID_RE, 'task_id must be a valid UUID'),
  run_id: z.string().min(1, 'run_id must be non-empty'),
})

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // dev: no secret configured
  return request.headers.get('authorization') === `Bearer ${secret}`
}

type EventStatus = 'success' | 'error' | 'warning'

async function writeEvent(params: {
  status: EventStatus
  output_summary: string
  meta: Record<string, unknown>
}): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      id: crypto.randomUUID(),
      domain: 'orchestrator',
      action: 'invoke_coordinator',
      actor: 'invoke-coordinator-route',
      task_type: 'coordinator_invoked',
      status: params.status,
      output_summary: params.output_summary,
      meta: params.meta,
      tags: ['harness', 'invoke-coordinator', 'chunk_b'],
    })
  } catch {
    // Event write failures are non-fatal
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const routineId = process.env.COORDINATOR_ROUTINE_ID
  const routineToken = process.env.COORDINATOR_ROUTINE_TOKEN

  if (!routineId || !routineToken) {
    await writeEvent({
      status: 'error',
      output_summary: 'COORDINATOR_ROUTINE_ID or COORDINATOR_ROUTINE_TOKEN not set',
      meta: { error: 'missing_env_vars' },
    })
    return NextResponse.json(
      { ok: false, error: 'COORDINATOR_ROUTINE_ID or COORDINATOR_ROUTINE_TOKEN not configured' },
      { status: 500 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = InvokeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { task_id, run_id } = parsed.data

  let fireRes: Response
  try {
    fireRes = await fetch(
      `https://api.anthropic.com/v1/claude_code/routines/${routineId}/fire`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${routineToken}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'experimental-cc-routine-2026-04-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: `task_id: ${task_id}\nrun_id: ${run_id}` }),
      }
    )
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'network error'
    await writeEvent({
      status: 'error',
      output_summary: `Network error calling Routines API: ${errMsg}`,
      meta: { task_id, run_id, error: errMsg },
    })
    return NextResponse.json({ ok: false, error: errMsg }, { status: 503 })
  }

  if (!fireRes.ok) {
    const upstreamStatus = fireRes.status
    const retryAfter = fireRes.headers.get('retry-after')

    let upstreamError: unknown
    try {
      upstreamError = await fireRes.json()
    } catch {
      upstreamError = await fireRes.text()
    }

    const errMsg =
      typeof upstreamError === 'object' &&
      upstreamError !== null &&
      'error' in upstreamError &&
      typeof (upstreamError as { error: { message?: string } }).error?.message === 'string'
        ? (upstreamError as { error: { message: string } }).error.message
        : String(upstreamError)

    await writeEvent({
      status: 'error',
      output_summary: `Routines API returned ${upstreamStatus}: ${errMsg}`,
      meta: {
        task_id,
        run_id,
        upstream_status: upstreamStatus,
        upstream_error: upstreamError,
        ...(retryAfter !== null ? { retry_after: retryAfter } : {}),
      },
    })

    const responseStatus = upstreamStatus === 429 ? 429 : 503
    return NextResponse.json(
      { ok: false, error: errMsg, upstream_status: upstreamStatus },
      { status: responseStatus }
    )
  }

  const fireData = (await fireRes.json()) as {
    claude_code_session_id: string
    claude_code_session_url: string
  }

  await writeEvent({
    status: 'success',
    output_summary: `Coordinator invoked for task ${task_id.slice(0, 8)}, session ${fireData.claude_code_session_id}`,
    meta: {
      task_id,
      run_id,
      session_id: fireData.claude_code_session_id,
      session_url: fireData.claude_code_session_url,
      routine_id: routineId,
    },
  })

  return NextResponse.json({
    ok: true,
    session_id: fireData.claude_code_session_id,
    session_url: fireData.claude_code_session_url,
  })
}
