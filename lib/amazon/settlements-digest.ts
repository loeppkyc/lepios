import { createServiceClient } from '@/lib/supabase/service'

/**
 * F18 surfacing: one Telegram digest line for Amazon settlements sync.
 * Shows settlement groups synced in last 24h and total net payout.
 * Never throws — returns a fallback string on any error.
 */
export async function buildAmazonSettlementsSyncLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data } = await db
      .from('agent_events')
      .select('meta, occurred_at')
      .eq('action', 'amazon_settlements_sync_completed')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single()

    if (!data?.meta) return 'Amazon settlements: no run in last 24h'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = data.meta as Record<string, any>
    const fetched: number = meta.fetched ?? 0
    const inserted: number = meta.inserted ?? 0
    const skipped: number = meta.skipped ?? 0
    const errors: number = meta.errors ?? 0
    const grossTotal: number | null = meta.gross_total ?? null
    const netTotal: number | null = meta.net_total ?? null

    const amountStr = netTotal !== null ? ` | net $${netTotal.toFixed(2)} CAD` : ''
    const grossStr =
      grossTotal !== null && grossTotal !== netTotal ? ` gross $${grossTotal.toFixed(2)}` : ''
    const errStr = errors > 0 ? `, ${errors} err` : ''
    const skipStr = skipped > 0 ? `, ${skipped} non-CAD skipped` : ''

    return `Amazon settlements (24h): ${fetched} groups, ${inserted} synced${errStr}${skipStr}${grossStr}${amountStr}`
  } catch {
    return 'Amazon settlements: stats unavailable'
  }
}
