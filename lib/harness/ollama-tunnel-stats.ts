import { createServiceClient } from '@/lib/supabase/service'

/**
 * Build one Telegram message line summarising Ollama tunnel smoke health.
 * Returns a P1 warning line if any smoke_test_failed event (actor=ollama-health)
 * exists in the last 24h. Never throws.
 * F18 benchmark: tunnel reachable + nomic-embed-text responds in <5s.
 */
export async function buildOllamaTunnelHealthLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString()

    const [failedResult, passedResult] = await Promise.all([
      db
        .from('agent_events')
        .select('occurred_at, meta')
        .eq('action', 'smoke_test_failed')
        .eq('actor', 'ollama-health')
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
        .limit(1),
      db
        .from('agent_events')
        .select('occurred_at, meta')
        .eq('action', 'smoke_test_passed')
        .eq('actor', 'ollama-health')
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
        .limit(1),
    ])

    const latestFail = failedResult.data?.[0] as
      | { occurred_at: string; meta: Record<string, unknown> }
      | undefined
    const latestPass = passedResult.data?.[0] as
      | { occurred_at: string; meta: Record<string, unknown> }
      | undefined

    if (!latestFail && !latestPass) return 'Ollama tunnel: no smoke data (last 24h)'

    if (latestFail) {
      const failedAt = new Date(latestFail.occurred_at).toISOString().slice(11, 16)
      const detail = latestFail.meta?.detail as string | undefined
      return `⚠️ P1: Ollama tunnel smoke FAILED at ${failedAt}UTC — ${detail ?? 'unreachable'}`
    }

    const latency = latestPass!.meta?.latency_ms as number | undefined
    return `Ollama tunnel: smoke passed${latency !== undefined ? ` (${latency}ms)` : ''}`
  } catch {
    return 'Ollama tunnel: smoke unavailable'
  }
}
