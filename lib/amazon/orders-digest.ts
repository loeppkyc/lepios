import { createServiceClient } from '@/lib/supabase/service'

/**
 * F18 surfacing: one Telegram digest line for Amazon orders sync.
 * Shows orders synced in last 24h vs. calibrated baseline.
 * Never throws — returns a fallback string on any error.
 */
export async function buildAmazonOrdersSyncLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data } = await db
      .from('agent_events')
      .select('meta, occurred_at')
      .eq('action', 'amazon_orders_sync_completed')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single()

    if (!data?.meta) return 'Amazon sync: no run in last 24h'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = data.meta as Record<string, any>
    const fetched: number = meta.fetched ?? 0
    const inserted: number = meta.inserted ?? 0
    const errors: number = meta.errors ?? 0
    const baseline: number | null = meta.baseline_orders_per_day ?? null

    const baselineStr =
      baseline !== null ? ` (baseline ~${baseline}/day)` : ' (baseline: not yet calibrated)'
    const errStr = errors > 0 ? `, ${errors} err` : ''

    return `Amazon sync (24h): ${fetched} fetched, ${inserted} rows${errStr}${baselineStr}`
  } catch {
    return 'Amazon sync: stats unavailable'
  }
}
