import { createServiceClient } from '@/lib/supabase/service'

export async function buildNetWorthDigestLine(): Promise<string> {
  try {
    const supabase = createServiceClient()

    // Latest 2 snapshots for net worth + delta
    const { data: snaps } = await supabase
      .from('net_worth_snapshots')
      .select('net_worth, snapshot_date, total_assets, total_liabilities')
      .order('snapshot_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(2)

    if (!snaps || snaps.length === 0) return '💼 Net Worth: no snapshot yet'

    const latest = snaps[0]
    const prior = snaps[1] ?? null
    const nw = Number(latest.net_worth)
    const delta = prior ? nw - Number(prior.net_worth) : null

    const fmt = (n: number) =>
      n < 0
        ? `-$${Math.abs(Math.round(n / 1000))}k`
        : `$${Math.round(n / 1000)}k`

    const deltaStr =
      delta !== null ? ` (${delta >= 0 ? '+' : ''}${fmt(delta)} vs prior)` : ''

    const ageDays = Math.floor(
      (Date.now() - new Date(latest.snapshot_date).getTime()) / 86_400_000
    )
    const staleStr = ageDays > 1 ? ` ⚠️ ${ageDays}d old` : ''

    return `💼 Net Worth: ${fmt(nw)}${deltaStr}${staleStr}`
  } catch {
    return '💼 Net Worth: unavailable'
  }
}
