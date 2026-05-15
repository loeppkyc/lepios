import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import type { ReceiptLine } from '@/lib/receipts/types'

export const revalidate = 0

// ── GET /api/receipts/lines?from=YYYY-MM-DD ──────────────────────────────────
// Returns receipt_lines rows where receipt_date >= from.
// Default: last 90 days.

export async function GET(request: Request) {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const fromParam = searchParams.get('from')

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const from = fromParam ?? ninetyDaysAgo.toISOString().slice(0, 10)

  const { supabase } = gate

  const { data, error } = await supabase
    .from('receipt_lines')
    .select('*')
    .gte('receipt_date', from)
    .order('receipt_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ receipts: (data ?? []) as ReceiptLine[] })
}
