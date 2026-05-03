import { createServiceClient } from '@/lib/supabase/service'

// F18: Arms legs dispatch — morning_digest summary line.
// Queries agent_events for last 24h where domain='arms_legs' and action LIKE 'arms_legs.dispatch.%'.
// Benchmark: p95 dispatch overhead < 50ms.
// Never throws — returns 'Arms legs dispatch: stats unavailable' on any error.

interface DispatchEventRow {
  action: string
  duration_ms: number | null
}

function computePercentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.floor(sorted.length * p)
  return sorted[Math.min(idx, sorted.length - 1)]
}

export async function buildArmsLegsDispatchLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data, error } = await db
      .from('agent_events')
      .select('action, duration_ms')
      .eq('domain', 'arms_legs')
      .like('action', 'arms_legs.dispatch.%')
      .gte('occurred_at', since)

    if (error) return 'Arms legs dispatch: stats unavailable'

    const rows = (data ?? []) as DispatchEventRow[]
    const total = rows.length

    if (total === 0) return 'Arms legs dispatch: no calls in last 24h'

    const ok = rows.filter((r) => r.action === 'arms_legs.dispatch.ok').length
    const denied = rows.filter((r) => r.action === 'arms_legs.dispatch.denied').length
    const errors = rows.filter((r) => r.action === 'arms_legs.dispatch.error').length
    const timeouts = rows.filter((r) => r.action === 'arms_legs.dispatch.timeout').length

    const successRate = total > 0 ? Math.round((ok / total) * 100) : 0

    // Latency percentiles from ok rows only
    const okLatencies = rows
      .filter((r) => r.action === 'arms_legs.dispatch.ok' && r.duration_ms != null)
      .map((r) => r.duration_ms as number)
      .sort((a, b) => a - b)

    const p95 = computePercentile(okLatencies, 0.95)

    const breachFlag = p95 !== null && p95 > 50 ? ' ⚠️ p95 >50ms benchmark' : ''

    const parts: string[] = [
      `Arms legs: ${ok}/${total} ok (${successRate}%)`,
      `${denied} denied`,
      p95 !== null ? `p95 ${p95}ms${breachFlag}` : 'p95 n/a',
    ]

    // Include errors/timeouts only when non-zero to keep the line terse
    if (errors > 0 || timeouts > 0) {
      parts.push(`${errors} err ${timeouts} timeout`)
    }

    return parts.join(' | ')
  } catch {
    return 'Arms legs dispatch: stats unavailable'
  }
}
