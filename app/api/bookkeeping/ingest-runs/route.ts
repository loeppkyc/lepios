import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'

export const revalidate = 0

export interface IngestRun {
  id: string
  run_at: string
  source: string
  rows_added: number
  rows_skipped: number
  period_start: string | null
  period_end: string | null
  notes: string | null
}

export async function GET() {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('ingest_runs')
    .select('id, run_at, source, rows_added, rows_skipped, period_start, period_end, notes')
    .order('run_at', { ascending: false })
    .limit(5)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const runs: IngestRun[] = (data ?? []).map((r) => ({
    id: r.id as string,
    run_at: r.run_at as string,
    source: r.source as string,
    rows_added: Number(r.rows_added),
    rows_skipped: Number(r.rows_skipped),
    period_start: (r.period_start as string | null) ?? null,
    period_end: (r.period_end as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  }))

  return NextResponse.json(runs)
}
