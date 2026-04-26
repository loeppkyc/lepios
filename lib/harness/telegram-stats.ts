import { createServiceClient } from '@/lib/supabase/service'

/**
 * F18: Query agent_events for drain_run events in last 24h.
 * Returns "Drain runs (24h): N, messages: M" — always present in digest.
 * Never throws.
 */
export async function buildDrainStatsLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data } = await db
      .from('agent_events')
      .select('meta')
      .eq('action', 'drain_run')
      .gte('occurred_at', since)
      .limit(50)

    const runs = data?.length ?? 0
    const messages = (data ?? []).reduce((sum, r) => {
      const drained = (r as { meta?: { drained?: number } }).meta?.drained ?? 0
      return sum + drained
    }, 0)

    return `Drain runs (24h): ${runs}, messages: ${messages}`
  } catch {
    return 'Drain runs (24h): unavailable'
  }
}

/**
 * F18: Query agent_events for purpose_review.timeout events in last 24h.
 * Returns null when count = 0 (omit from digest when healthy).
 * Returns "⚠️ Review timeouts swept (24h): N" when N > 0.
 * Never throws.
 */
export async function buildReviewTimeoutLine(): Promise<string | null> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data } = await db
      .from('agent_events')
      .select('id')
      .eq('action', 'purpose_review.timeout')
      .gte('occurred_at', since)
      .limit(20)

    const count = data?.length ?? 0
    if (count === 0) return null

    return `⚠️ Review timeouts swept (24h): ${count}`
  } catch {
    return null
  }
}
