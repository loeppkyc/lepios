import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'

export const revalidate = 0

export async function GET(request: Request) {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') ?? '2026-04'

  const [year, mo] = month.split('-').map(Number)
  const start = `${month}-01`
  const lastDay = new Date(year, mo, 0).getDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`

  const { data: expenses, error } = await gate.supabase
    .from('business_expenses')
    .select('tax_amount, pretax, category, vendor, date, hubdoc')
    .gte('date', start)
    .lte('date', end)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = expenses ?? []
  const itcTotal = rows.reduce((s, e) => s + (e.tax_amount ?? 0), 0)
  const pretaxTotal = rows.reduce((s, e) => s + (e.pretax ?? 0), 0)
  const missingCount = rows.filter((e) => !e.hubdoc).length

  // Group ITCs by category
  const byCat: Record<string, { pretax: number; itc: number }> = {}
  for (const e of rows) {
    const c = byCat[e.category] ?? { pretax: 0, itc: 0 }
    c.pretax += e.pretax ?? 0
    c.itc += e.tax_amount ?? 0
    byCat[e.category] = c
  }
  const byCategory = Object.entries(byCat)
    .map(([category, v]) => ({
      category,
      pretax: Math.round(v.pretax * 100) / 100,
      itc: Math.round(v.itc * 100) / 100,
    }))
    .sort((a, b) => b.pretax - a.pretax)

  return NextResponse.json({
    month,
    expenseCount: rows.length,
    expensePretax: Math.round(pretaxTotal * 100) / 100,
    itcs: Math.round(itcTotal * 100) / 100,
    missingReceiptCount: missingCount,
    byCategory,
    note: 'ITCs = GST/HST you paid on business expenses. Claim these on your GST return to reduce what you owe CRA. Amazon collects and remits GST on your sales directly under marketplace facilitator rules.',
  })
}

export type GstSummaryResponse = {
  month: string
  expenseCount: number
  expensePretax: number
  itcs: number
  missingReceiptCount: number
  byCategory: Array<{ category: string; pretax: number; itc: number }>
  note: string
}
