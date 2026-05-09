// GET/POST /api/cron/night_watchman_scan
//
// Vercel cron entry point. Schedule registration is a manual setup step
// (see Phase 4 report) — the spec wants every-30-min during sleep window
// (04:00–14:00 UTC) and every-2h otherwise. v2 ships ONE cron registration
// at every-30-min and lets the orchestrator's scopeForNow() label the run.
//
// Auth: requireCronSecret (existing F22 helper).
// Query params:
//   ?dry_run=1   → run all checks, escalate produces preview text, no Telegram send
//                  and no repair side effects.
//   ?scope=manual → label the run as 'manual' instead of cron-driven.

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { runScan, scopeForNow } from '@/lib/night_watchman'
import { summarizeScan } from '@/lib/telegram/templates'
import { upsertHeartbeat } from '@/lib/orchestrator/heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min — many checks fan out to slow APIs

async function handle(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized
  void upsertHeartbeat().catch(() => {})

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dry_run') === '1'
  const explicitScope = url.searchParams.get('scope')
  const triggerSource = explicitScope === 'manual' ? ('manual' as const) : ('cron' as const)
  const scope = explicitScope === 'manual' ? ('manual' as const) : scopeForNow()

  try {
    const report = await runScan({ scope, triggerSource, dryRun })
    return NextResponse.json({
      ok: true,
      summary: summarizeScan(report),
      report,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
