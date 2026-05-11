import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('fba_batches')
    .select('id, name, status, source, created_at, updated_at')
    .eq('id', id)
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .single()

  if (error || !data) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  return NextResponse.json(data)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership before delete
  const { data: existing, error: fetchError } = await supabase
    .from('fba_batches')
    .select('id')
    .eq('id', id)
    .eq('person_handle', 'colin') // SPRINT5-GATE
    .single()

  if (fetchError || !existing)
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const { error } = await supabase.from('fba_batches').delete().eq('id', id)

  if (error) return NextResponse.json({ error: 'Failed to delete batch' }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
