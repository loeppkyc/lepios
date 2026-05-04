import { createServiceClient } from '@/lib/supabase/service'

// F18: Smoke test framework observability — morning_digest summary line.
// Queries production_smoke_complete events for last 24h: total deploys, passed, failed.
// Never throws — returns 'Smoke: stats unavailable' on any error.

interface SmokeCompleteRow {
  status: string
}

export async function buildDeploySmokeStatsLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data, error } = await db
      .from('agent_events')
      .select('status')
      .eq('action', 'production_smoke_complete')
      .gte('occurred_at', since)
      .limit(500)

    if (error) return 'Smoke: stats unavailable'

    const rows = (data ?? []) as SmokeCompleteRow[]
    const total = rows.length

    if (total === 0) return 'Smoke: no deploys in last 24h'

    const passed = rows.filter((r) => r.status === 'success').length
    const failed = total - passed

    if (failed === 0) {
      return `Deploys (24h): ${total} | smoke: ${passed}/${total} ✓`
    }

    return `Deploys (24h): ${total} | smoke: ${passed}/${total} — ${failed} FAILED`
  } catch {
    return 'Smoke: stats unavailable'
  }
}
