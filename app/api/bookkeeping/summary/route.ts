import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { BusinessExpense } from '@/lib/types/expenses'

export const revalidate = 0

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const yearParam = searchParams.get('year')
  const year = yearParam ? parseInt(yearParam) : new Date().getFullYear()

  if (isNaN(year) || year < 2020 || year > 2099) {
    return NextResponse.json({ error: 'year param required (YYYY)' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('business_expenses')
    .select('*')
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const expenses = (data ?? []) as BusinessExpense[]

  // YTD totals
  let ytdPretax = 0
  let ytdTax = 0
  let ytdBusiness = 0
  for (const e of expenses) {
    ytdPretax += e.pretax
    ytdTax += e.tax_amount
    ytdBusiness += e.pretax * (e.business_use_pct / 100)
  }

  // Month breakdown (group by YYYY-MM)
  const monthMap = new Map<
    string,
    {
      count: number
      totalPretax: number
      totalTax: number
      businessPortion: number
      missingReceipts: number
    }
  >()
  for (const e of expenses) {
    const mo = e.date.slice(0, 7)
    const m = monthMap.get(mo) ?? {
      count: 0,
      totalPretax: 0,
      totalTax: 0,
      businessPortion: 0,
      missingReceipts: 0,
    }
    m.count++
    m.totalPretax += e.pretax
    m.totalTax += e.tax_amount
    m.businessPortion += e.pretax * (e.business_use_pct / 100)
    if (!e.hubdoc) m.missingReceipts++
    monthMap.set(mo, m)
  }
  const months = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      count: v.count,
      totalPretax: Math.round(v.totalPretax * 100) / 100,
      totalTax: Math.round(v.totalTax * 100) / 100,
      businessPortion: Math.round(v.businessPortion * 100) / 100,
      missingReceipts: v.missingReceipts,
    }))

  // Category breakdown (ranked by pre-tax desc)
  const catMap = new Map<
    string,
    { count: number; totalPretax: number; totalTax: number; businessPortion: number }
  >()
  for (const e of expenses) {
    const c = catMap.get(e.category) ?? {
      count: 0,
      totalPretax: 0,
      totalTax: 0,
      businessPortion: 0,
    }
    c.count++
    c.totalPretax += e.pretax
    c.totalTax += e.tax_amount
    c.businessPortion += e.pretax * (e.business_use_pct / 100)
    catMap.set(e.category, c)
  }
  const categories = Array.from(catMap.entries())
    .sort(([, a], [, b]) => b.totalPretax - a.totalPretax)
    .map(([category, v]) => ({
      category,
      count: v.count,
      totalPretax: Math.round(v.totalPretax * 100) / 100,
      totalTax: Math.round(v.totalTax * 100) / 100,
      businessPortion: Math.round(v.businessPortion * 100) / 100,
    }))

  // Expenses missing receipts (hubdoc = false), most recent first
  const missingReceiptExpenses = expenses
    .filter((e) => !e.hubdoc)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(({ id, date, vendor, category, pretax, tax_amount, payment_method, notes }) => ({
      id,
      date,
      vendor,
      category,
      pretax,
      tax_amount,
      payment_method,
      notes,
    }))

  return NextResponse.json({
    year,
    ytd: {
      count: expenses.length,
      totalPretax: Math.round(ytdPretax * 100) / 100,
      totalTax: Math.round(ytdTax * 100) / 100,
      businessPortion: Math.round(ytdBusiness * 100) / 100,
    },
    months,
    categories,
    missingReceiptExpenses,
  })
}
