/**
 * POST /api/harness/self-repair-tick
 *
 * Daily cron entry point for the self_repair pipeline.
 * Schedule: 0 3 * * * (3 AM UTC daily — see vercel.json)
 *
 * AD2: NEVER auto-merge. This route only opens PRs.
 * AD3: All fix execution happens inside runInSandbox().
 * AD4: Only watchlisted action types are processed.
 *
 * Flow:
 * 1. Auth gate (requireCronSecret)
 * 2. Check SELF_REPAIR_ENABLED flag from harness_config
 * 3. Check daily cap (SELF_REPAIR_DAILY_CAP from harness_config)
 * 4. detectNextFailure()
 * 5. gatherContext()
 * 6. draftFix()
 * 7. verifyDraft()
 * 8. openPR() (if verify passed) or escalate (if failed)
 * 9. Update self_repair_runs status throughout
 *
 * F22: uses requireCronSecret from lib/auth/cron-secret.ts
 */

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { detectNextFailure, releaseDetectorLock } from '@/lib/harness/self-repair/detector'
import { gatherContext } from '@/lib/harness/self-repair/context'
import { draftFix } from '@/lib/harness/self-repair/drafter'
import { verifyDraft } from '@/lib/harness/self-repair/verifier'
import { openPR } from '@/lib/harness/self-repair/pr-opener'
import { telegram } from '@/lib/harness/arms-legs'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min max execution time

// Reads a harness_config key, returns null if missing or error
async function readHarnessConfig(
  db: ReturnType<typeof createServiceClient>,
  key: string
): Promise<string | null> {
  try {
    const { data } = await db.from('harness_config').select('value').eq('key', key).maybeSingle()
    return (data as { value: string } | null)?.value ?? null
  } catch {
    return null
  }
}

// Check if daily cap is exceeded
async function checkDailyCap(
  db: ReturnType<typeof createServiceClient>,
  cap: number
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await db
      .from('self_repair_runs')
      .select('id', { count: 'exact', head: true })
      .gte('detected_at', since)
      .neq('status', 'cap_exceeded')

    return (count ?? 0) >= cap
  } catch {
    return false // Non-fatal — allow run on DB error
  }
}

// Update status of a self_repair_runs row
async function updateRunStatus(
  db: ReturnType<typeof createServiceClient>,
  runId: string,
  updates: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .from('self_repair_runs')
      .update({ ...updates, status_at: new Date().toISOString() })
      .eq('id', runId)
  } catch {
    // Non-fatal
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  // F22: cron secret auth
  const authError = requireCronSecret(request)
  if (authError) return authError

  const db = createServiceClient()
  const started = new Date().toISOString()

  // 1. Check feature flag
  const enabledStr = await readHarnessConfig(db, 'SELF_REPAIR_ENABLED')
  if (enabledStr !== 'true') {
    return NextResponse.json({
      ok: false,
      reason: 'SELF_REPAIR_ENABLED is not true',
      started,
    })
  }

  // 2. Check daily cap
  const capStr = await readHarnessConfig(db, 'SELF_REPAIR_DAILY_CAP')
  const dailyCap = parseInt(capStr ?? '3', 10)

  const capExceeded = await checkDailyCap(db, dailyCap)
  if (capExceeded) {
    // Log cap exceeded event
    try {
      await db.from('agent_events').insert({
        domain: 'self_repair',
        action: 'self_repair.cap_exceeded',
        actor: 'self_repair',
        status: 'warning',
        meta: { daily_cap: dailyCap, started },
      })
    } catch {
      // Non-fatal
    }

    // Telegram notify Colin
    await telegram(
      `Self-repair daily cap (${dailyCap}) reached. No further attempts until tomorrow.`,
      { bot: 'builder', agentId: 'self_repair' }
    ).catch(() => {})

    return NextResponse.json({
      ok: true,
      reason: 'daily_cap_exceeded',
      cap: dailyCap,
      started,
    })
  }

  // 3. Detect next failure
  const failure = await detectNextFailure()
  if (!failure) {
    return NextResponse.json({
      ok: true,
      reason: 'no_failure_detected',
      started,
    })
  }

  // Create initial self_repair_runs row
  let runId: string | null = null
  try {
    const { data: runRow, error: runInsertError } = await db
      .from('self_repair_runs')
      .insert({
        trigger_event_id: failure.eventId,
        action_type: failure.actionType,
        status: 'running',
      })
      .select('id')
      .single()

    if (runInsertError || !runRow) {
      throw new Error(runInsertError?.message ?? 'insert failed')
    }
    runId = (runRow as { id: string }).id
  } catch (err) {
    await releaseDetectorLock(failure.actionType)
    return NextResponse.json(
      { ok: false, reason: 'failed to create self_repair_runs row', error: String(err) },
      { status: 500 }
    )
  }

  try {
    // 4. Gather context
    const ctx = await gatherContext(failure)
    await updateRunStatus(db, runId, { status: 'context_gathered' })

    // 5. Draft fix
    const draft = await draftFix(ctx)
    if (!draft || !draft.unifiedDiff.trim()) {
      await updateRunStatus(db, runId, {
        status: 'draft_failed',
        failure_reason: draft ? 'empty diff returned' : 'LLM call failed',
      })

      await telegram(
        `Self-repair draft failed for ${failure.actionType} (run ${runId.slice(0, 8)}). Check self_repair_runs.`,
        { bot: 'builder', agentId: 'self_repair' }
      ).catch(() => {})

      await releaseDetectorLock(failure.actionType)
      return NextResponse.json({
        ok: true,
        run_id: runId,
        status: 'draft_failed',
        action_type: failure.actionType,
        started,
      })
    }

    await updateRunStatus(db, runId, {
      status: 'drafted',
      drafter_prompt_tokens: draft.promptTokens,
      drafter_completion_tokens: draft.completionTokens,
      drafter_summary: draft.summary,
      drafter_rationale: draft.rationale,
    })

    // 6. Verify in sandbox
    await updateRunStatus(db, runId, { status: 'verifying' })
    const verifyResult = await verifyDraft(draft, ctx)

    // Update with sandbox results
    await updateRunStatus(db, runId, {
      sandbox_run_id: verifyResult.sandboxRunId || null,
      verify_exit_code: verifyResult.exitCode,
      verify_duration_ms: verifyResult.durationMs,
      warnings: verifyResult.warnings,
    })

    if (!verifyResult.passed) {
      const timedOut = verifyResult.exitCode === null && verifyResult.durationMs >= 170_000
      const failStatus = timedOut ? 'verify_timeout' : 'verify_failed'

      await updateRunStatus(db, runId, {
        status: failStatus,
        failure_reason: verifyResult.stderr.slice(0, 500) || 'tests did not pass',
      })

      await telegram(
        `Self-repair verify ${failStatus} for ${failure.actionType} (run ${runId.slice(0, 8)}).\nExit code: ${verifyResult.exitCode ?? 'null (timeout)'}`,
        { bot: 'builder', agentId: 'self_repair' }
      ).catch(() => {})

      await releaseDetectorLock(failure.actionType)
      return NextResponse.json({
        ok: true,
        run_id: runId,
        status: failStatus,
        action_type: failure.actionType,
        started,
      })
    }

    await updateRunStatus(db, runId, { status: 'verify_passed' })

    // 7. Open PR — AD2: never auto-merge
    try {
      const prResult = await openPR(draft, verifyResult, ctx, runId)

      await updateRunStatus(db, runId, {
        status: 'pr_opened',
        pr_number: prResult.prNumber,
        pr_url: prResult.prUrl,
        branch_name: prResult.branchName,
      })

      await releaseDetectorLock(failure.actionType)
      return NextResponse.json({
        ok: true,
        run_id: runId,
        status: 'pr_opened',
        pr_url: prResult.prUrl,
        pr_number: prResult.prNumber,
        action_type: failure.actionType,
        started,
      })
    } catch (prErr) {
      const msg = prErr instanceof Error ? prErr.message : String(prErr)
      await updateRunStatus(db, runId, {
        status: 'pr_open_failed',
        failure_reason: msg.slice(0, 500),
      })

      await telegram(
        `Self-repair PR open failed for ${failure.actionType} (run ${runId.slice(0, 8)}): ${msg.slice(0, 200)}`,
        { bot: 'builder', agentId: 'self_repair' }
      ).catch(() => {})

      await releaseDetectorLock(failure.actionType)
      return NextResponse.json({
        ok: false,
        run_id: runId,
        status: 'pr_open_failed',
        action_type: failure.actionType,
        error: msg,
        started,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (runId) {
      await updateRunStatus(db, runId, {
        status: 'escalated',
        failure_reason: msg.slice(0, 500),
      })
    }
    await releaseDetectorLock(failure.actionType)
    return NextResponse.json({ ok: false, run_id: runId, error: msg, started }, { status: 500 })
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return POST(request)
}
