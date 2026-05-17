import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const revalidate = 0

/**
 * GET /api/amazon-orders?status=Shipped&month=2026-05&page=1&limit=50
 *
 * Returns paginated Amazon orders from the `orders` table.
 *
 * Query params:
 *   status  — filter by order status (e.g. Shipped, Pending, Unshipped, Canceled)
 *   month   — YYYY-MM, defaults to current month
 *   page    — 1-indexed, defaults to 1
 *   limit   — rows per page, max 200, defaults to 50
 */

export interface AmazonOrder {
  id: string
  order_date: string
  status: string
  revenue: number
  units: number
  asin: string | null
  title: string | null
}

export interface AmazonOrdersResponse {
  orders: AmazonOrder[]
  total: number
  page: number
  limit: number
  month: string
  status_filter: string | null
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export async function GET(request: Request) {
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status') || null
  const monthParam = searchParams.get('month') || currentMonth()
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))

  // Validate month format
  if (!/^\d{4}-\d{2}$/.test(monthParam)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }

  const monthStart = monthParam + '-01'
  // End of month: first day of next month minus 1 day
  const [y, m] = monthParam.split('-').map(Number)
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`

  const supabase = createServiceClient()

  let countQuery = supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .gte('order_date', monthStart)
    .lt('order_date', nextMonth)

  let dataQuery = supabase
    .from('orders')
    .select('id, order_date, status, revenue_cad, quantity, asin, title')
    .gte('order_date', monthStart)
    .lt('order_date', nextMonth)
    .order('order_date', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (statusFilter && statusFilter !== 'All') {
    countQuery = countQuery.eq('status', statusFilter)
    dataQuery = dataQuery.eq('status', statusFilter)
  }

  const [{ count }, { data: rows, error }] = await Promise.all([countQuery, dataQuery])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const orders: AmazonOrder[] = (rows ?? []).map((r) => ({
    id: String(r.id),
    order_date: String(r.order_date),
    status: String(r.status ?? ''),
    revenue: Math.round(Number(r.revenue_cad ?? 0) * 100) / 100,
    units: Number(r.quantity ?? 0),
    asin: r.asin ? String(r.asin) : null,
    title: r.title ? String(r.title) : null,
  }))

  return NextResponse.json({
    orders,
    total: count ?? 0,
    page,
    limit,
    month: monthParam,
    status_filter: statusFilter,
  } satisfies AmazonOrdersResponse)
}
