import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAccounts } from '@/lib/quickbooks/client'

export const dynamic = 'force-dynamic'

export interface BalanceRow {
  id: string
  name: string
  account_type: string
  category: string
  lepios_balance: number
  lepios_as_of: string
  freshness: 'fresh' | 'aging' | 'stale'
  qbo_balance: number | null
  variance: number | null
  qbo_account_id: string | null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('balance_sheet_entries')
    .select('id, name, account_type, category, balance, as_of_date, sort_order, qbo_account_id')
    .in('account_type', ['asset', 'liability'])
    .order('account_type', { ascending: false })
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch QBO accounts — build a map by QBO id
  let qboMap: Record<string, number> = {}
  try {
    const qboAccounts = await fetchAccounts()
    for (const a of qboAccounts) {
      // QBO returns credit card balances as negative (owed); store absolute value
      const balance = a.type === 'credit_card' ? Math.abs(a.balance) : a.balance
      qboMap[a.id] = balance
    }
  } catch {
    // QBO unavailable — show LepiOS numbers only
  }

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const rows: BalanceRow[] = (data ?? []).map((row) => {
    const asOf = row.as_of_date as string
    const daysSince = Math.floor((Date.parse(todayStr) - Date.parse(asOf)) / 86400000)
    const freshness = daysSince < 30 ? 'fresh' : daysSince < 60 ? 'aging' : 'stale'
    const lepios_balance = Number(row.balance)
    const qbo_balance = row.qbo_account_id ? (qboMap[row.qbo_account_id] ?? null) : null
    const variance = qbo_balance !== null ? lepios_balance - qbo_balance : null

    return {
      id: row.id,
      name: row.name,
      account_type: row.account_type,
      category: row.category,
      lepios_balance,
      lepios_as_of: asOf,
      freshness,
      qbo_balance,
      variance,
      qbo_account_id: row.qbo_account_id,
    }
  })

  return NextResponse.json({ rows })
}
