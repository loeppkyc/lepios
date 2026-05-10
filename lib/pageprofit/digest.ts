import { createServiceClient } from '@/lib/supabase/service'

/** F18: PageProfit scan activity in the last 24h — tier + routing breakdown. */
export async function buildPageProfitScanLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data, error } = await db
      .from('scan_results')
      .select('tier, routing_decision')
      .gte('created_at', since)

    if (error || !data) return 'PageProfit: stats unavailable'

    const total = data.length
    if (total === 0) return 'PageProfit: 0 scans (24h)'

    const coll = data.filter((r) => r.tier === 'COLLECTIBLE').length
    const hd = data.filter((r) => r.tier === 'HIGH_DEMAND').length
    const std = data.filter((r) => r.tier === 'STANDARD').length
    const go = data.filter((r) => r.routing_decision === 'go').length
    const bbv = data.filter((r) => r.routing_decision === 'bbv').length
    const donate = data.filter((r) => r.routing_decision === 'donate').length
    const pending = data.filter((r) => !r.routing_decision).length

    const tierPart = [
      coll > 0 ? `COLL ${coll}` : '',
      hd > 0 ? `HD ${hd}` : '',
      std > 0 ? `STD ${std}` : '',
    ]
      .filter(Boolean)
      .join(' ')

    const routePart = [
      go > 0 ? `GO ${go}` : '',
      bbv > 0 ? `BBV ${bbv}` : '',
      donate > 0 ? `DON ${donate}` : '',
      pending > 0 ? `? ${pending}` : '',
    ]
      .filter(Boolean)
      .join(' · ')

    return `📚 PageProfit: ${total} scan${total !== 1 ? 's' : ''} (24h)${tierPart ? ` · ${tierPart}` : ''}${routePart ? ` | ${routePart}` : ''}`
  } catch {
    return 'PageProfit: stats unavailable'
  }
}
