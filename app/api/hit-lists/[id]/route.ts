import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { error } = await supabase.from('hit_lists').delete().eq('id', id)

  if (error) return NextResponse.json({ error: 'Failed to delete list' }, { status: 500 })

  return NextResponse.json({ deleted: true })
}
