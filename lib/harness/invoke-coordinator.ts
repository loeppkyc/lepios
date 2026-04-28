import { createServiceClient } from '@/lib/supabase/service'
import { recordAttribution } from '@/lib/attribution/writer'

export type InvokeCoordinatorResult =
  | { ok: true; session_id: string; session_url: string }
  | {
      ok: false
      error: string
      failure_type: 'missing_env' | 'network_error' | 'upstream'
      upstream_status?: number
    }

async function writeEvent(params: {
  status: 'success' | 'error'
  output_summary: string
  meta: Record<string, unknown>
}): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      id: crypto.randomUUID(),
      domain: 'orchestrator',
      action: 'invoke_coordinator',
      actor: 'harness',
      task_type: 'coordinator_invoked',
      status: params.status,
      output_summary: params.output_summary,
      meta: params.meta,
      tags: ['harness', 'invoke-coordinator', 'chunk_b'],
    })
  } catch {
    // Non-fatal — event write failure must not break the caller
  }
}

export async function fireCoordinator(params: {
  task_id: string
  run_id: string
}): Promise<InvokeCoordinatorResult> {
  const { task_id, run_id } = params
  // Trim to defend against trailing newlines in env (e.g. from Vercel CLI pull)
  const routineId = process.env.COORDINATOR_ROUTINE_ID?.trim()
  const routineToken = process.env.COORDINATOR_ROUTINE_TOKEN?.trim()

  if (!routineId || !routineToken) {
    await writeEvent({
      status: 'error',
      output_summary: 'COORDINATOR_ROUTINE_ID or COORDINATOR_ROUTINE_TOKEN not set',
      meta: { task_id, run_id, error: 'missing_env_vars' },
    })
    return {
      ok: false,
      error: 'COORDINATOR_ROUTINE_ID or COORDINATOR_ROUTINE_TOKEN not configured',
      failure_type: 'missing_env',
    }
  }

  let fireRes: Response
  try {
    // Routines API /fire accepts only { text }. Branch selection happens
    // inside the session via the guard in .claude/agents/coordinator.md.
    // See decisions_log entry 2026-04-28 "Branch naming via in-session guard".
    fireRes = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${routineId}/fire`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${routineToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'experimental-cc-routine-2026-04-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: `task_id: ${task_id}\nrun_id: ${run_id}`,
      }),
    })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'network error'
    await writeEvent({
      status: 'error',
      output_summary: `Network error calling Routines API: ${errMsg}`,
      meta: { task_id, run_id, error: errMsg },
    })
    return { ok: false, error: errMsg, failure_type: 'network_error' }
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

    return {
      ok: false,
      error: errMsg,
      failure_type: 'upstream',
      upstream_status: upstreamStatus,
    }
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

  // Attribution: coordinator fired for this task
  void recordAttribution(
    {
      actor_type: 'coordinator',
      actor_id: fireData.claude_code_session_id,
      coordinator_session_id: fireData.claude_code_session_id,
      run_id,
      source_task_id: task_id,
    },
    { type: 'task_queue', id: task_id },
    'coordinator_fired',
    { session_url: fireData.claude_code_session_url }
  )

  return {
    ok: true,
    session_id: fireData.claude_code_session_id,
    session_url: fireData.claude_code_session_url,
  }
}
