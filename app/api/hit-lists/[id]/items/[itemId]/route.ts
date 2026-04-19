import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, itemId } = await params

  // Verify the item exists in this list, and the list belongs to colin
  const { data: item } = await supabase
    .from('hit_list_items')
    .select('id, hit_lists!inner(person_handle)')
    .eq('id', itemId)
    .eq('hit_list_id', id)
    .eq('hit_lists.person_handle', 'colin')
    .single()

  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const { error } = await supabase.from('hit_list_items').delete().eq('id', itemId)

  if (error) return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })

  return NextResponse.json({ deleted: true })
}
