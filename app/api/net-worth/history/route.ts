import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { NetWorthSnapshot } from '@/app/api/net-worth/route'

export const revalidate = 0

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 120

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limitParam = searchParams.get('limit')
  let limit = DEFAULT_LIMIT
  if (limitParam) {
    const parsed = parseInt(limitParam, 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      return NextResponse.json({ error: 'limit must be a positive integer' }, { status: 400 })
    }
    limit = Math.min(parsed, MAX_LIMIT)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .select(
      'id, snapshot_date, total_assets, total_liabilities, net_worth, breakdown, notes, created_at'
    )
    .order('snapshot_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return ASC for chart consumption.
  const snapshots: NetWorthSnapshot[] = (data ?? [])
    .map((s) => ({
      ...s,
      total_assets: Number(s.total_assets),
      total_liabilities: Number(s.total_liabilities),
      net_worth: Number(s.net_worth),
    }))
    .reverse()

  return NextResponse.json({ snapshots })
}
