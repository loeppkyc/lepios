import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { requireCronSecret } from '@/lib/auth/cron-secret'

export const revalidate = 0

export interface ExternalBenchmark {
  id: string
  benchmark_name: string
  vs_system: string
  parity_score: number
  notes: string | null
  measured_at: string
}

export async function GET() {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) return gate.response

  const supabase = gate.supabase

  const { data, error } = await supabase
    .from('external_benchmarks')
    .select('id, benchmark_name, vs_system, parity_score, notes, measured_at')
    .order('measured_at', { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const benchmarks: ExternalBenchmark[] = (data ?? []).map((row) => ({
    id: row.id as string,
    benchmark_name: row.benchmark_name as string,
    vs_system: row.vs_system as string,
    parity_score: Number(row.parity_score),
    notes: (row.notes as string | null) ?? null,
    measured_at: row.measured_at as string,
  }))

  return NextResponse.json({ benchmarks, fetchedAt: new Date().toISOString() })
}

export async function POST(request: Request) {
  // F22: requireCronSecret must be called first
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: {
    benchmark_name?: unknown
    vs_system?: unknown
    parity_score?: unknown
    notes?: unknown
    measured_at?: unknown
  }

  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate required fields
  if (
    !body.benchmark_name ||
    typeof body.benchmark_name !== 'string' ||
    !body.benchmark_name.trim()
  ) {
    return NextResponse.json({ error: 'benchmark_name is required' }, { status: 400 })
  }
  if (!body.vs_system || typeof body.vs_system !== 'string' || !body.vs_system.trim()) {
    return NextResponse.json({ error: 'vs_system is required' }, { status: 400 })
  }
  if (body.parity_score === undefined || body.parity_score === null) {
    return NextResponse.json({ error: 'parity_score is required' }, { status: 400 })
  }

  const parity_score = Number(body.parity_score)
  if (isNaN(parity_score) || parity_score < 0 || parity_score > 100) {
    return NextResponse.json(
      { error: 'parity_score must be a number between 0 and 100' },
      { status: 400 }
    )
  }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()

  const insertRow: {
    benchmark_name: string
    vs_system: string
    parity_score: number
    notes?: string
    measured_at?: string
  } = {
    benchmark_name: body.benchmark_name.trim(),
    vs_system: (body.vs_system as string).trim(),
    parity_score,
  }

  if (body.notes && typeof body.notes === 'string') {
    insertRow.notes = body.notes
  }
  if (body.measured_at && typeof body.measured_at === 'string') {
    insertRow.measured_at = body.measured_at
  }

  const { data, error } = await supabase
    .from('external_benchmarks')
    .insert(insertRow)
    .select('id, benchmark_name, vs_system, parity_score, notes, measured_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const benchmark: ExternalBenchmark = {
    id: data.id as string,
    benchmark_name: data.benchmark_name as string,
    vs_system: data.vs_system as string,
    parity_score: Number(data.parity_score),
    notes: (data.notes as string | null) ?? null,
    measured_at: data.measured_at as string,
  }

  return NextResponse.json(benchmark, { status: 201 })
}
