import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// GET /api/retail/deals?status=active&limit=50
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)

  const db = createServiceClient()
  let query = db.from('deals').select('*').order('found_date', { ascending: false }).limit(limit)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deals: data })
}
