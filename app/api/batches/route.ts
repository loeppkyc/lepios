import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const CreateBatchSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(80, 'Name must be 80 characters or fewer')
    .transform((s) => s.trim()),
  source: z.string().max(80).optional(),
})

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('fba_batches')
    .select('id, name, status, source, created_at, fba_batch_items(count)')
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .eq('status', 'open')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to fetch batches' }, { status: 500 })

  type BatchRow = (typeof data)[number] & {
    fba_batch_items: { count: number }[]
  }

  const batches = (data ?? []).map((row) => {
    const r = row as BatchRow
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      source: r.source,
      created_at: r.created_at,
      item_count: r.fba_batch_items[0]?.count ?? 0,
    }
  })

  return NextResponse.json(batches)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = CreateBatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('fba_batches')
    .insert({
      person_handle: 'colin', // SPRINT5-GATE
      name: parsed.data.name,
      source: parsed.data.source ?? null,
    })
    .select('id, name, status, source, created_at')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create batch' }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
