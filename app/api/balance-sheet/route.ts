import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface BalanceSheetEntry {
  id: string
  name: string
  account_type: 'asset' | 'liability'
  category: string
  balance: number
  as_of_date: string
  notes: string | null
  sort_order: number
  source: 'manual' | 'auto_sync'
  currency: 'CAD' | 'USD'
  updated_at: string
}

export interface BalanceSheetResponse {
  entries: BalanceSheetEntry[]
  totalAssets: number
  totalLiabilities: number
  netEquity: number
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('balance_sheet_entries')
    .select('*')
    .order('account_type', { ascending: false }) // assets before liabilities
    .order('sort_order')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const entries = (data ?? []) as BalanceSheetEntry[]
  const totalAssets = entries
    .filter((e) => e.account_type === 'asset')
    .reduce((s, e) => s + Number(e.balance), 0)
  const totalLiabilities = entries
    .filter((e) => e.account_type === 'liability')
    .reduce((s, e) => s + Number(e.balance), 0)

  return NextResponse.json({
    entries,
    totalAssets: Math.round(totalAssets * 100) / 100,
    totalLiabilities: Math.round(totalLiabilities * 100) / 100,
    netEquity: Math.round((totalAssets - totalLiabilities) * 100) / 100,
  } satisfies BalanceSheetResponse)
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    id: string
    balance: number
    as_of_date?: string
    notes?: string
  }
  if (!body.id || body.balance === undefined) {
    return NextResponse.json({ error: 'id and balance required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('balance_sheet_entries')
    .update({
      balance: body.balance,
      as_of_date: body.as_of_date ?? new Date().toISOString().slice(0, 10),
      notes: body.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    name?: string
    account_type?: string
    category?: string
    balance?: number
    as_of_date?: string
    notes?: string | null
    sort_order?: number
  }

  // Validation
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json(
      { error: 'name is required and must be a non-empty string' },
      { status: 400 }
    )
  }
  if (body.name.length > 100) {
    return NextResponse.json({ error: 'name must be 100 characters or fewer' }, { status: 400 })
  }
  if (body.account_type !== 'asset' && body.account_type !== 'liability') {
    return NextResponse.json(
      { error: 'account_type must be "asset" or "liability"' },
      { status: 400 }
    )
  }
  if (!body.category || typeof body.category !== 'string' || body.category.trim().length === 0) {
    return NextResponse.json(
      { error: 'category is required and must be a non-empty string' },
      { status: 400 }
    )
  }
  if (body.balance === undefined || !Number.isFinite(body.balance)) {
    return NextResponse.json(
      { error: 'balance is required and must be a finite number' },
      { status: 400 }
    )
  }

  const today = new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('balance_sheet_entries')
    .insert({
      name: body.name.trim(),
      account_type: body.account_type,
      category: body.category.trim(),
      balance: body.balance,
      as_of_date: body.as_of_date ?? today,
      notes: body.notes ?? null,
      sort_order: body.sort_order ?? 999,
      source: 'manual',
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id }, { status: 201 })
}
