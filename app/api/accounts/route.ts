import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface AccountRow {
  id: string
  name: string
  account_type: 'asset' | 'liability'
  category: string
  balance: number
  as_of_date: string
  days_since_update: number
  freshness: 'fresh' | 'aging' | 'stale' // <30d / 30-60d / 60+d
  notes: string | null
}

export interface AccountsResponse {
  accounts: AccountRow[]
  totalCash: number
  totalInvestments: number
  totalCardsOwing: number
  totalLoans: number
  totalTaxOwing: number
  totalAssets: number
  totalLiabilities: number
  netWorth: number
  staleCount: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

const CASH_CATEGORIES = new Set(['bank', 'personal_bank', 'cash'])
const INVESTMENT_CATEGORIES = new Set(['personal_investment'])
const CARD_CATEGORIES = new Set(['credit_card'])
const LOAN_CATEGORIES = new Set(['loan'])
const TAX_CATEGORIES = new Set(['tax'])

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('balance_sheet_entries')
    .select('id, name, account_type, category, balance, as_of_date, notes, sort_order')
    .in('account_type', ['asset', 'liability'])
    .order('account_type', { ascending: false }) // asset before liability
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const accounts: AccountRow[] = (data ?? []).map((row) => {
    const asOf = row.as_of_date as string
    const daysSince = Math.floor((Date.parse(todayStr) - Date.parse(asOf)) / (1000 * 60 * 60 * 24))
    const freshness: AccountRow['freshness'] =
      daysSince < 30 ? 'fresh' : daysSince < 60 ? 'aging' : 'stale'
    return {
      id: row.id,
      name: row.name,
      account_type: row.account_type as 'asset' | 'liability',
      category: row.category,
      balance: r2(Number(row.balance)),
      as_of_date: asOf,
      days_since_update: daysSince,
      freshness,
      notes: row.notes,
    }
  })

  // Aggregations
  let totalCash = 0
  let totalInvestments = 0
  let totalCardsOwing = 0
  let totalLoans = 0
  let totalTaxOwing = 0
  let totalAssets = 0
  let totalLiabilities = 0
  let staleCount = 0

  for (const a of accounts) {
    if (a.freshness === 'stale') staleCount += 1
    if (a.account_type === 'asset') {
      totalAssets += a.balance
      if (CASH_CATEGORIES.has(a.category)) totalCash += a.balance
      else if (INVESTMENT_CATEGORIES.has(a.category)) totalInvestments += a.balance
    } else {
      totalLiabilities += a.balance
      if (CARD_CATEGORIES.has(a.category)) totalCardsOwing += a.balance
      else if (LOAN_CATEGORIES.has(a.category)) totalLoans += a.balance
      else if (TAX_CATEGORIES.has(a.category)) totalTaxOwing += a.balance
    }
  }

  return NextResponse.json({
    accounts,
    totalCash: r2(totalCash),
    totalInvestments: r2(totalInvestments),
    totalCardsOwing: r2(totalCardsOwing),
    totalLoans: r2(totalLoans),
    totalTaxOwing: r2(totalTaxOwing),
    totalAssets: r2(totalAssets),
    totalLiabilities: r2(totalLiabilities),
    netWorth: r2(totalAssets - totalLiabilities),
    staleCount,
  } satisfies AccountsResponse)
}
