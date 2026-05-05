import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

// GET /api/bookkeeping/qb-export                → JSON summary (count, total, list of unexported JEs)
// GET /api/bookkeeping/qb-export?format=csv     → CSV download (QBO Journal Entry import format)
//   ?include_exported=true                       → also include already-exported (re-export)
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD               → date range filter on je_date

export interface QbExportSummaryRow {
  id: string
  je_number: string
  je_date: string
  name: string | null
  description: string | null
  total_debit: number
  total_credit: number
  exported_to_qb_at: string | null
}

export interface QbExportSummary {
  unexportedCount: number
  unexportedTotal: number
  earliestDate: string | null
  latestDate: string | null
  jes: QbExportSummaryRow[]
}

interface JeRow {
  id: string
  je_number: string | null
  je_date: string
  name: string | null
  description: string | null
  total_debit: number
  total_credit: number
  exported_to_qb_at: string | null
}

interface JeLineRow {
  journal_entry_id: string
  line_no: number
  account_full_name: string
  description: string | null
  debit: number
  credit: number
}

function fmtQbDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return ''
  const s = typeof v === 'number' ? v.toFixed(2) : String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export async function GET(request: Request) {
  const ssr = await createClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const format = url.searchParams.get('format')
  const includeExported = url.searchParams.get('include_exported') === 'true'
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const supabase = createServiceClient()

  let query = supabase
    .from('journal_entries')
    .select(
      'id, je_number, je_date, name, description, total_debit, total_credit, exported_to_qb_at'
    )
    .eq('source', 'lepios_auto')
    .order('je_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (!includeExported) query = query.is('exported_to_qb_at', null)
  if (from) query = query.gte('je_date', from)
  if (to) query = query.lte('je_date', to)

  const { data: jes, error: jeErr } = await query
  if (jeErr) return NextResponse.json({ error: jeErr.message }, { status: 500 })

  const jeRows = (jes ?? []) as JeRow[]

  if (format !== 'csv') {
    const summary: QbExportSummary = {
      unexportedCount: jeRows.length,
      unexportedTotal:
        Math.round(jeRows.reduce((s, j) => s + Number(j.total_debit), 0) * 100) / 100,
      earliestDate: jeRows[0]?.je_date ?? null,
      latestDate: jeRows[jeRows.length - 1]?.je_date ?? null,
      jes: jeRows.map((j) => ({
        id: j.id,
        je_number: j.je_number ?? '',
        je_date: j.je_date,
        name: j.name,
        description: j.description,
        total_debit: Number(j.total_debit),
        total_credit: Number(j.total_credit),
        exported_to_qb_at: j.exported_to_qb_at,
      })),
    }
    return NextResponse.json(summary)
  }

  // CSV path: fetch lines for these JEs
  if (jeRows.length === 0) {
    return new NextResponse('*JournalNo,*Date,*Account,*Debits,*Credits,Description,Name\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="lepios-qb-export-empty.csv"',
      },
    })
  }

  const ids = jeRows.map((j) => j.id)
  const { data: lines, error: lErr } = await supabase
    .from('journal_entry_lines')
    .select('journal_entry_id, line_no, account_full_name, description, debit, credit')
    .in('journal_entry_id', ids)
    .order('journal_entry_id', { ascending: true })
    .order('line_no', { ascending: true })

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })

  const lineRows = (lines ?? []) as JeLineRow[]
  const linesByJe = new Map<string, JeLineRow[]>()
  for (const l of lineRows) {
    const arr = linesByJe.get(l.journal_entry_id) ?? []
    arr.push(l)
    linesByJe.set(l.journal_entry_id, arr)
  }

  const out: string[] = ['*JournalNo,*Date,*Account,*Debits,*Credits,Description,Name']
  for (const j of jeRows) {
    const ls = linesByJe.get(j.id) ?? []
    for (const l of ls) {
      const debit = Number(l.debit)
      const credit = Number(l.credit)
      out.push(
        [
          csvEscape(j.je_number ?? ''),
          csvEscape(fmtQbDate(j.je_date)),
          csvEscape(l.account_full_name),
          debit > 0 ? csvEscape(debit) : '',
          credit > 0 ? csvEscape(credit) : '',
          csvEscape(l.description ?? j.description ?? ''),
          csvEscape(j.name ?? ''),
        ].join(',')
      )
    }
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  return new NextResponse(out.join('\n') + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="lepios-qb-export-${ts}.csv"`,
      'X-Lepios-Je-Ids': ids.join(','),
    },
  })
}
