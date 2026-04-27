import { createServiceClient } from '@/lib/supabase/service'

/**
 * F18: Count utility_bill_saved events in the last 24h.
 * Returns "Utility bills saved (24h): N" — always present in digest.
 * Never throws.
 */
export async function buildUtilityBillSavedLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data } = await db
      .from('agent_events')
      .select('id')
      .eq('action', 'utility_bill_saved')
      .gte('occurred_at', since)
      .limit(20)

    const count = data?.length ?? 0
    return `Utility bills saved (24h): ${count}`
  } catch {
    return 'Utility bills saved (24h): unavailable'
  }
}
