import { createServiceClient } from '@/lib/supabase/service'

/**
 * F18 surfacing: orders pending settlement match in the trailing 30 days.
 * Queries reconciled_orders_view — requires service client (financial_events
 * has no authenticated RLS). Never throws.
 */
export async function buildReconciliationMatchLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

    const [noEventResult, totalResult] = await Promise.all([
      db
        .from('reconciled_orders_view')
        .select('*', { count: 'exact', head: true })
        .eq('match_status', 'no_event')
        .gte('first_order_date', since),
      db
        .from('reconciled_orders_view')
        .select('*', { count: 'exact', head: true })
        .gte('first_order_date', since),
    ])

    const noEvent = noEventResult.count ?? 0
    const total = totalResult.count ?? 0
    if (total === 0) return 'Reconciliation (30d): no orders'

    const matched = total - noEvent
    const matchPct = Math.round((matched / total) * 100)

    if (noEvent === 0) return `Reconciliation (30d): all ${total} orders matched ✅`
    return `Reconciliation (30d): ${noEvent} pending match | ${matchPct}% matched (${matched}/${total})`
  } catch {
    return 'Reconciliation: stats unavailable'
  }
}
