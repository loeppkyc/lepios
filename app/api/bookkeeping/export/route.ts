import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { BusinessExpense } from '@/lib/types/expenses'

export const revalidate = 0

function fmtNum(n: number): string {
  return n.toFixed(2)
}

function csvRow(cells: (string | number | boolean)[]): string {
  return cells
    .map((c) => {
      const s = String(c)
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    })
    .join(',')
}

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

  const lines: string[] = []

  // ── Section 1: Full ledger ────────────────────────────────────────────────────
  lines.push(`Business Expenses ${year} — Full Ledger`)
  lines.push(
    csvRow([
      'Date',
      'Vendor',
      'Category',
      'Pre-Tax ($)',
      'GST/Tax ($)',
      'Total ($)',
      'Payment Method',
      'Hubdoc',
      'Business %',
      'Business Portion ($)',
      'Notes',
    ])
  )
  for (const e of expenses) {
    const total = e.pretax + e.tax_amount
    const biz = e.pretax * (e.business_use_pct / 100)
    lines.push(
      csvRow([
        e.date,
        e.vendor,
        e.category,
        fmtNum(e.pretax),
        fmtNum(e.tax_amount),
        fmtNum(total),
        e.payment_method,
        e.hubdoc ? 'Y' : 'N',
        e.business_use_pct,
        fmtNum(biz),
        e.notes,
      ])
    )
  }

  lines.push('')
  lines.push('')

  // ── Section 2: Category summary ───────────────────────────────────────────────
  lines.push(`Category Summary`)
  lines.push(
    csvRow([
      'Category',
      '# Expenses',
      'Pre-Tax ($)',
      'GST/Tax ($)',
      'Total ($)',
      'Business Portion ($)',
    ])
  )

  const catMap = new Map<string, { count: number; pretax: number; tax: number; biz: number }>()
  for (const e of expenses) {
    const c = catMap.get(e.category) ?? { count: 0, pretax: 0, tax: 0, biz: 0 }
    c.count++
    c.pretax += e.pretax
    c.tax += e.tax_amount
    c.biz += e.pretax * (e.business_use_pct / 100)
    catMap.set(e.category, c)
  }
  const sortedCats = Array.from(catMap.entries()).sort(([, a], [, b]) => b.pretax - a.pretax)
  for (const [cat, v] of sortedCats) {
    lines.push(
      csvRow([
        cat,
        v.count,
        fmtNum(v.pretax),
        fmtNum(v.tax),
        fmtNum(v.pretax + v.tax),
        fmtNum(v.biz),
      ])
    )
  }

  lines.push('')

  // Totals row
  const totalPretax = expenses.reduce((acc, e) => acc + e.pretax, 0)
  const totalTax = expenses.reduce((acc, e) => acc + e.tax_amount, 0)
  const totalBiz = expenses.reduce((acc, e) => acc + e.pretax * (e.business_use_pct / 100), 0)
  lines.push(
    csvRow([
      'TOTAL',
      expenses.length,
      fmtNum(totalPretax),
      fmtNum(totalTax),
      fmtNum(totalPretax + totalTax),
      fmtNum(totalBiz),
    ])
  )

  lines.push('')
  lines.push('')

  // ── Section 3: GST summary ────────────────────────────────────────────────────
  lines.push('GST / Input Tax Credits Summary')
  lines.push(csvRow(['Item', 'Amount ($)', 'Notes']))
  lines.push(
    csvRow(['GST Paid on Business Expenses (ITCs)', fmtNum(totalTax), 'Claimable against CRA'])
  )
  lines.push(
    csvRow(['Amazon GST Collected', 'N/A', 'Amazon collects & remits as marketplace facilitator'])
  )
  lines.push(csvRow(['Net GST Position', fmtNum(totalTax), 'ITCs claimable (refund expected)']))

  const csv = lines.join('\r\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="business-expenses-${year}.csv"`,
    },
  })
}
