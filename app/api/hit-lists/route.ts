import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CreateListSchema } from '@/lib/hit-lists/schemas'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('hit_lists')
    .select('id, name, created_at, hit_list_items(count)')
    .eq('person_handle', 'colin')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to fetch lists' }, { status: 500 })

  const lists = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    item_count: (row.hit_list_items as unknown as { count: number }[])[0]?.count ?? 0,
  }))

  return NextResponse.json(lists)
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

  const parsed = CreateListSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('hit_lists')
    .insert({
      // SPRINT5-GATE: replace with profiles FK + RLS (ARCHITECTURE.md §7.3, MN-3)
      person_handle: 'colin',
      name: parsed.data.name,
    })
    .select('id, name, created_at')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create list' }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
