import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

const MAX_NOTES_LENGTH = 500

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const raw = body.notes
  if (raw !== null && typeof raw !== 'string') {
    return NextResponse.json({ error: 'notes must be string or null' }, { status: 400 })
  }

  // Trim whitespace; treat empty string as null clear.
  const trimmed = typeof raw === 'string' ? raw.trim() : null
  if (trimmed !== null && trimmed.length > MAX_NOTES_LENGTH) {
    return NextResponse.json(
      { error: `notes exceeds ${MAX_NOTES_LENGTH} char limit` },
      { status: 400 }
    )
  }
  const value: string | null = trimmed && trimmed.length > 0 ? trimmed : null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('amazon_settlements')
    .update({ notes: value })
    .eq('id', id)
    .select('id, notes')
    .single()

  if (error) {
    // PostgREST returns PGRST116 when .single() finds 0 rows.
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'settlement not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'settlement not found' }, { status: 404 })
  }

  return NextResponse.json({ id: data.id, notes: data.notes })
}
