import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AddItemsSchema } from '@/lib/hit-lists/schemas'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: list } = await supabase
    .from('hit_lists')
    .select('id')
    .eq('id', id)
    .eq('person_handle', 'colin')
    .single()

  if (!list) return NextResponse.json({ error: 'List not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('hit_list_items')
    .select('id, isbn, status, added_at')
    .eq('hit_list_id', id)
    .order('added_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 })

  return NextResponse.json(data ?? [])
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = AddItemsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 400 }
    )
  }

  const { id } = await params

  const { data: list, error: listError } = await supabase
    .from('hit_lists')
    .select('id')
    .eq('id', id)
    .eq('person_handle', 'colin')
    .single()

  if (listError || !list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }

  const isbns = parsed.data.isbns.map((s) => s.trim()).filter(Boolean)

  if (isbns.length === 0) {
    return NextResponse.json({ added: 0, skipped: 0 })
  }

  const rows = isbns.map((isbn) => ({
    hit_list_id: id,
    isbn,
    status: 'pending' as const,
  }))

  const { data: inserted, error } = await supabase
    .from('hit_list_items')
    .upsert(rows, { onConflict: 'hit_list_id,isbn', ignoreDuplicates: true })
    .select('id')

  if (error) return NextResponse.json({ error: 'Failed to add ISBNs' }, { status: 500 })

  const added = inserted?.length ?? 0
  const skipped = isbns.length - added

  return NextResponse.json({ added, skipped })
}
