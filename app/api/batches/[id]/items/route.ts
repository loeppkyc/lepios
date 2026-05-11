import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const AddItemSchema = z.object({
  scan_result_id: z.string().uuid().optional(),
  amazon_listing_id: z.string().uuid().optional(),
  sku: z.string().optional(),
  asin: z.string().min(1, 'ASIN is required'),
  isbn: z.string().optional(),
  title: z.string().optional(),
  condition_code: z.string().optional(),
  list_price_cad: z.number().positive().optional(),
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: batchId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify batch ownership
  const { data: batch, error: batchError } = await supabase
    .from('fba_batches')
    .select('id')
    .eq('id', batchId)
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .single()

  if (batchError || !batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('fba_batch_items')
    .select(
      'id, sku, asin, isbn, title, condition_code, list_price_cad, status, added_at, scan_result_id, amazon_listing_id'
    )
    .eq('batch_id', batchId)
    .order('added_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 })

  return NextResponse.json(data ?? [])
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: batchId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify batch ownership
  const { data: batch, error: batchError } = await supabase
    .from('fba_batches')
    .select('id')
    .eq('id', batchId)
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .single()

  if (batchError || !batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = AddItemSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 400 }
    )
  }

  const {
    scan_result_id,
    amazon_listing_id,
    sku,
    asin,
    isbn,
    title,
    condition_code,
    list_price_cad,
  } = parsed.data

  // Status defaults to 'listed' if amazon_listing_id is provided, 'pending' otherwise
  const status = amazon_listing_id ? 'listed' : 'pending'

  const { data, error } = await supabase
    .from('fba_batch_items')
    .insert({
      batch_id: batchId,
      scan_result_id: scan_result_id ?? null,
      amazon_listing_id: amazon_listing_id ?? null,
      sku: sku ?? null,
      asin,
      isbn: isbn ?? null,
      title: title ?? null,
      condition_code: condition_code ?? null,
      list_price_cad: list_price_cad ?? null,
      status,
    })
    .select('id, sku, asin, isbn, title, condition_code, list_price_cad, status, added_at')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to add item to batch' }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
