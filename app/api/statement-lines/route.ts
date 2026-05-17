import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const revalidate = 0

export interface StatementImport {
  id: string
  source_file: string
  source_account: string
  total_rows: number
  status: string
  imported_at: string
}

export interface StatementLine {
  id: string
  source_account: string
  txn_date: string
  description: string
  vendor_extracted: string | null
  amount_signed: number
  is_debit: boolean
  status: string
}

export interface StatementLinesResponse {
  imports: StatementImport[]
  lines: StatementLine[]
  debit_count: number
  credit_count: number
  receipt_count: number
  invoice_count: number
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') ?? '2026-04'
  const [year, mon] = month.split('-').map(Number)
  const periodStart = `${year}-${String(mon).padStart(2, '0')}-01`
  const periodEnd = new Date(year, mon, 0).toISOString().slice(0, 10)

  const db = createServiceClient()

  const [importsRes, linesRes, receiptsRes, invoicesRes] = await Promise.all([
    db
      .from('bank_imports')
      .select('id, source_file, source_account, total_rows, status, imported_at')
      .order('imported_at', { ascending: false })
      .limit(30),

    db
      .from('pending_transactions')
      .select(
        'id, source_account, txn_date, description, vendor_extracted, amount_signed, is_debit, status'
      )
      .gte('txn_date', periodStart)
      .lte('txn_date', periodEnd)
      .order('txn_date', { ascending: false }),

    db
      .from('gmail_receipt_classifications')
      .select('id', { count: 'exact', head: true })
      .gte('classified_at', `${periodStart}T00:00:00Z`)
      .lte('classified_at', `${periodEnd}T23:59:59Z`),

    db
      .from('gmail_invoice_classifications')
      .select('id', { count: 'exact', head: true })
      .gte('classified_at', `${periodStart}T00:00:00Z`)
      .lte('classified_at', `${periodEnd}T23:59:59Z`),
  ])

  const lines = (linesRes.data ?? []) as StatementLine[]
  const debit_count = lines.filter((l) => l.is_debit).length
  const credit_count = lines.filter((l) => !l.is_debit).length

  return NextResponse.json({
    imports: (importsRes.data ?? []) as StatementImport[],
    lines,
    debit_count,
    credit_count,
    receipt_count: receiptsRes.count ?? 0,
    invoice_count: invoicesRes.count ?? 0,
  } satisfies StatementLinesResponse)
}
