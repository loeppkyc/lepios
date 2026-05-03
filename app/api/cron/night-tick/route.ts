import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { runNightTick } from '@/lib/orchestrator/tick'
import { runSandboxGc } from '@/lib/harness/sandbox/gc'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

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

    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
