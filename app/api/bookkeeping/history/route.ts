import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { BusinessExpense } from '@/lib/types/expenses'

export const revalidate = 0

export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('business_expenses')
    .select('date, category, pretax, tax_amount, business_use_pct')
    .gte('date', '2020-01-01')
    .order('date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const expenses = (data ?? []) as Pick<
    BusinessExpense,
    'date' | 'category' | 'pretax' | 'tax_amount' | 'business_use_pct'
  >[]

  // Group by year
  type YearData = {
    year: number
    count: number
    totalPretax: number
    totalTax: number
    businessPortion: number
    categories: Map<string, number>
  }

  const yearMap = new Map<number, YearData>()

  for (const e of expenses) {
    const year = parseInt(e.date.slice(0, 4))
    if (!yearMap.has(year)) {
      yearMap.set(year, {
        year,
        count: 0,
        totalPretax: 0,
        totalTax: 0,
        businessPortion: 0,
        categories: new Map(),
      })
    }
    const yd = yearMap.get(year)!
    yd.count++
    yd.totalPretax += e.pretax
    yd.totalTax += e.tax_amount
    yd.businessPortion += e.pretax * (e.business_use_pct / 100)
    yd.categories.set(e.category, (yd.categories.get(e.category) ?? 0) + e.pretax)
  }

  const years = Array.from(yearMap.values())
    .sort((a, b) => a.year - b.year)
    .map((yd) => ({
      year: yd.year,
      count: yd.count,
      totalPretax: Math.round(yd.totalPretax * 100) / 100,
      totalTax: Math.round(yd.totalTax * 100) / 100,
      businessPortion: Math.round(yd.businessPortion * 100) / 100,
      topCategories: Array.from(yd.categories.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([category, total]) => ({
          category,
          total: Math.round(total * 100) / 100,
        })),
    }))

  return NextResponse.json({ years })
}
