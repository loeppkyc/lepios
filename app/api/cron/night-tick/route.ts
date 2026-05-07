import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { runNightTick } from '@/lib/orchestrator/tick'
import { runSandboxGc } from '@/lib/harness/sandbox/gc'
import { runScan, scopeForNow } from '@/lib/night_watchman'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // night_watchman scan can take ~30-60s with all checks live

const NIGHT_WATCHMAN_TIMEOUT_MS = 120_000

export async function GET(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  try {
    const result = await Promise.race([
      runNightTick(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('night tick exceeded 60s timeout')), 60_000)
      ),
    ])

    // Sandbox orphan GC — non-fatal; runs after main tick
    try {
      const gcResult = await runSandboxGc()
      if (gcResult.swept > 0 || gcResult.errors > 0) {
        const db = createServiceClient()
        await db.from('agent_events').insert({
          domain: 'sandbox',
          action: 'sandbox.gc',
          actor: 'night_tick',
          status: gcResult.errors > 0 ? 'warning' : 'success',
          meta: { swept: gcResult.swept, errors: gcResult.errors },
          occurred_at: new Date().toISOString(),
        })
      }
    } catch {
      // Non-fatal — GC failure does not fail the tick
    }

    // night_watchman scan — non-fatal; co-located here after PR #112 deleted its
    // standalone cron (Vercel Hobby 18-cron limit). The scanner records its own
    // run row + check results to night_watchman_runs / night_watchman_check_results.
    let nightWatchmanReport: Awaited<ReturnType<typeof runScan>> | null = null
    let nightWatchmanError: string | null = null
    try {
      nightWatchmanReport = await Promise.race([
        runScan({ scope: scopeForNow(), triggerSource: 'cron' }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(new Error(`night_watchman runScan exceeded ${NIGHT_WATCHMAN_TIMEOUT_MS}ms`)),
            NIGHT_WATCHMAN_TIMEOUT_MS
          )
        ),
      ])
    } catch (err) {
      nightWatchmanError = err instanceof Error ? err.message : String(err)
      try {
        const db = createServiceClient()
        await db.from('agent_events').insert({
          domain: 'night_watchman',
          action: 'night_watchman.scan_failed',
          actor: 'night_tick',
          status: 'error',
          error_message: nightWatchmanError.slice(0, 500),
          occurred_at: new Date().toISOString(),
        })
      } catch {
        // Best-effort log only
      }
    }

    return NextResponse.json({
      ...result,
      night_watchman: nightWatchmanReport
        ? {
            run_id: nightWatchmanReport.runId,
            scope: nightWatchmanReport.scope,
            total_checks: nightWatchmanReport.totalChecks,
            total_repairs: nightWatchmanReport.totalRepairs,
            total_escalations: nightWatchmanReport.totalEscalations,
            halted: nightWatchmanReport.halted,
          }
        : { error: nightWatchmanError },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
