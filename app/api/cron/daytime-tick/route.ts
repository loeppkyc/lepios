import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { upsertHeartbeat } from '@/lib/orchestrator/heartbeat'
import { runDaytimeTick } from '@/lib/orchestrator/daytime-tick'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized
  void upsertHeartbeat().catch(() => {})

  // Feature flag — route exists but is inert until explicitly enabled
  if (!process.env.DAYTIME_TICK_ENABLED) {
    return NextResponse.json({ ok: false, reason: 'daytime-tick-disabled', duration_ms: 0 })
  }

  try {
    const result = await Promise.race([
      runDaytimeTick(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('daytime tick exceeded 120s timeout')), 120_000)
      ),
    ])
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
