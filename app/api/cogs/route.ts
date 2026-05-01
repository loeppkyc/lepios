import { createServiceClient } from '@/lib/supabase/service'
import { CogsEntryInsertSchema, CogsQuerySchema } from '@/lib/cogs/validation'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ── GET /api/cogs ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authClient = await createClient()
  const {
    data: { user },
  } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)

  const parsed = CogsQuerySchema.safeParse({
    asin: searchParams.get('asin') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    vendor: searchParams.get('vendor') ?? undefined,
    source: searchParams.get('source') ?? undefined,
    pricing_model: searchParams.get('pricing_model') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { asin, from, to, vendor, source, pricing_model, limit } = parsed.data
  const supabase = createServiceClient()

  // Fetch raw entries
  let entriesQuery = supabase
    .from('cogs_entries')
    .select(
      'id, asin, pricing_model, unit_cost_cad, quantity, total_cost_cad, purchased_at, vendor, notes, source, created_at, created_by'
    )
    .order('purchased_at', { ascending: false })
    .limit(limit)

  if (asin) entriesQuery = entriesQuery.eq('asin', asin.toUpperCase())
  if (from) entriesQuery = entriesQuery.gte('purchased_at', from)
  if (to) entriesQuery = entriesQuery.lte('purchased_at', to)
  if (vendor) entriesQuery = entriesQuery.ilike('vendor', `%${vendor}%`)
  if (source) entriesQuery = entriesQuery.eq('source', source)
  if (pricing_model) entriesQuery = entriesQuery.eq('pricing_model', pricing_model)

  const { data: entries, error: entriesError } = await entriesQuery
  if (entriesError) return NextResponse.json({ error: entriesError.message }, { status: 500 })

  // Fetch aggregated view for the same ASIN filter (or all if no filter)
  let summaryQuery = supabase.from('cogs_per_asin_view').select('*').order('asin')

  if (asin) summaryQuery = summaryQuery.eq('asin', asin.toUpperCase())

  const { data: summary, error: summaryError } = await summaryQuery
  if (summaryError) return NextResponse.json({ error: summaryError.message }, { status: 500 })

  return NextResponse.json({
    entries: entries ?? [],
    summary: summary ?? [],
    count: entries?.length ?? 0,
  })
}

// ── POST /api/cogs ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const authClient = await createClient()
  const {
    data: { user },
  } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CogsEntryInsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { asin, pricing_model, unit_cost_cad, quantity, purchased_at, vendor, notes, source } =
    parsed.data

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('cogs_entries')
    .insert({
      asin: asin.toUpperCase(),
      pricing_model,
      unit_cost_cad: unit_cost_cad ?? null,
      quantity,
      purchased_at,
      vendor: vendor ?? null,
      notes: notes ?? null,
      source,
      created_by: user.email ?? 'user',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // F18: log entry for autonomous querying
  await supabase.from('agent_events').insert({
    domain: 'finance',
    action: 'cogs_entry_created',
    actor: 'user',
    status: 'success',
    meta: { asin, pricing_model, unit_cost_cad, quantity, purchased_at, source },
  })

  return NextResponse.json({ entry: data }, { status: 201 })
}
