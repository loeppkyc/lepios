import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface DebtRow {
  id: string
  name: string
  category: string
  balance: number
  as_of_date: string
  // Estimated assuming a stable monthly payment derived from QB journal entries.
  monthlyPaymentEstimate: number | null
  monthsToPayoff: number | null
  payoffDateEstimate: string | null
}

export interface DebtPayoffResponse {
  debts: DebtRow[]
  totalDebt: number
  totalMonthlyPayment: number
  // Optional total payoff date if every debt is paid at current rates
  longestPayoffMonths: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Pull active liabilities (exclude tax obligations — those aren't typical "debt payoff")
  const { data: liabRows, error: liabErr } = await supabase
    .from('balance_sheet_entries')
    .select('id, name, category, balance, as_of_date')
    .eq('account_type', 'liability')
    .gt('balance', 0)
    .not('category', 'eq', 'tax')
    .order('balance', { ascending: false })

  if (liabErr) return NextResponse.json({ error: liabErr.message }, { status: 500 })

  // For each debt name, look at journal_entry_lines to find recent monthly payment patterns.
  // A monthly payment is when the liability account is DEBITED (paid down).
  const { data: jeData, error: jeErr } = await supabase
    .from('journal_entry_lines')
    .select('account_full_name, debit, journal_entry_id, journal_entries!inner(je_date)')
    .gt('debit', 0)
    .gte('journal_entries.je_date', '2026-01-01')

  // Tolerate join failure — fall back to no payment estimates
  const jePayments: { account: string; debit: number; date: string }[] = []
  if (!jeErr && Array.isArray(jeData)) {
    for (const row of jeData as unknown as Array<{
      account_full_name: string
      debit: string | number
      journal_entries: { je_date: string }
    }>) {
      jePayments.push({
        account: row.account_full_name,
        debit: Number(row.debit),
        date: row.journal_entries.je_date,
      })
    }
  }

  const debts: DebtRow[] = (liabRows ?? []).map((row) => {
    const balance = Number(row.balance)
    // Find payments on this debt by name match (case-insensitive contains)
    const lowerName = row.name.toLowerCase()
    const matchingPayments = jePayments.filter((p) =>
      p.account.toLowerCase().includes(lowerName.replace(/\s*\(.*\)/g, '').trim())
    )
    let monthlyPaymentEstimate: number | null = null
    if (matchingPayments.length >= 2) {
      // Average of last 3 months of payments (rough)
      const recent = matchingPayments.slice(-3)
      const avg = recent.reduce((s, p) => s + p.debit, 0) / recent.length
      monthlyPaymentEstimate = r2(avg)
    }
    const monthsToPayoff =
      monthlyPaymentEstimate && monthlyPaymentEstimate > 0
        ? Math.ceil(balance / monthlyPaymentEstimate)
        : null
    let payoffDateEstimate: string | null = null
    if (monthsToPayoff != null) {
      const d = new Date()
      d.setUTCMonth(d.getUTCMonth() + monthsToPayoff)
      payoffDateEstimate = d.toISOString().slice(0, 10)
    }
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      balance: r2(balance),
      as_of_date: row.as_of_date,
      monthlyPaymentEstimate,
      monthsToPayoff,
      payoffDateEstimate,
    }
  })

  const totalDebt = r2(debts.reduce((s, d) => s + d.balance, 0))
  const totalMonthlyPayment = r2(debts.reduce((s, d) => s + (d.monthlyPaymentEstimate ?? 0), 0))
  const longestPayoffMonths =
    debts.filter((d) => d.monthsToPayoff != null).length > 0
      ? Math.max(...debts.map((d) => d.monthsToPayoff ?? 0))
      : null

  return NextResponse.json({
    debts,
    totalDebt,
    totalMonthlyPayment,
    longestPayoffMonths,
  } satisfies DebtPayoffResponse)
}
