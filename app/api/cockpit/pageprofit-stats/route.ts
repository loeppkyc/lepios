import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const since = new Date(Date.now() - 86_400_000).toISOString()

  const [scansResult, palletsResult] = await Promise.all([
    service.from('scan_results').select('profit_cad, routing_decision').gte('created_at', since),
    service.from('pallets').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  ])

  const scans = scansResult.data ?? []
  const scans24h = scans.length
  const activePallets = palletsResult.count ?? 0
  const pendingRouting = scans.filter((r) => !r.routing_decision).length
  const profitPotentialCad =
    Math.round(
      scans
        .filter((r) => r.routing_decision === 'go' || !r.routing_decision)
        .reduce((sum, r) => sum + ((r.profit_cad as number | null) ?? 0), 0) * 100
    ) / 100

  return NextResponse.json({ scans24h, activePallets, pendingRouting, profitPotentialCad })
}
