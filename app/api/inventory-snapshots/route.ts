import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface InventorySnapshot {
  id: string
  snapshot_date: string
  value_at_cost: number
  source: string
  notes: string | null
  created_at: string
  updated_at: string
}

const MAX_NOTES_LENGTH = 500

function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('inventory_snapshots')
    .select('id, snapshot_date, value_at_cost, source, notes, created_at, updated_at')
    .order('snapshot_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const snapshots: InventorySnapshot[] = (data ?? []).map((s) => ({
    ...s,
    value_at_cost: Number(s.value_at_cost),
  }))

  return NextResponse.json({ snapshots })
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!isYmd(body.snapshot_date)) {
    return NextResponse.json({ error: 'snapshot_date required (YYYY-MM-DD)' }, { status: 400 })
  }
  const value = Number(body.value_at_cost)
  if (!Number.isFinite(value)) {
    return NextResponse.json({ error: 'value_at_cost must be a finite number' }, { status: 400 })
  }
  const rawNotes = body.notes
  if (rawNotes !== undefined && rawNotes !== null && typeof rawNotes !== 'string') {
    return NextResponse.json({ error: 'notes must be string or null' }, { status: 400 })
  }
  const trimmedNotes = typeof rawNotes === 'string' ? rawNotes.trim() : null
  if (trimmedNotes && trimmedNotes.length > MAX_NOTES_LENGTH) {
    return NextResponse.json(
      { error: `notes exceeds ${MAX_NOTES_LENGTH} char limit` },
      { status: 400 }
    )
  }
  const notes: string | null = trimmedNotes && trimmedNotes.length > 0 ? trimmedNotes : null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('inventory_snapshots')
    .insert({
      snapshot_date: body.snapshot_date as string,
      value_at_cost: value,
      source: 'manual',
      notes,
    })
    .select('id, snapshot_date, value_at_cost, source, notes, created_at, updated_at')
    .single()

  if (error) {
    // Postgres unique violation
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'snapshot already exists for that date — use PATCH to update' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ snapshot: data })
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (body.value_at_cost !== undefined) {
    const v = Number(body.value_at_cost)
    if (!Number.isFinite(v)) {
      return NextResponse.json({ error: 'value_at_cost must be a finite number' }, { status: 400 })
    }
    updates.value_at_cost = v
  }
  if (body.snapshot_date !== undefined) {
    if (!isYmd(body.snapshot_date)) {
      return NextResponse.json({ error: 'snapshot_date must be YYYY-MM-DD' }, { status: 400 })
    }
    updates.snapshot_date = body.snapshot_date
  }
  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') {
      return NextResponse.json({ error: 'notes must be string or null' }, { status: 400 })
    }
    const trimmed = typeof body.notes === 'string' ? body.notes.trim() : null
    if (trimmed && trimmed.length > MAX_NOTES_LENGTH) {
      return NextResponse.json(
        { error: `notes exceeds ${MAX_NOTES_LENGTH} char limit` },
        { status: 400 }
      )
    }
    updates.notes = trimmed && trimmed.length > 0 ? trimmed : null
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('inventory_snapshots')
    .update(updates)
    .eq('id', body.id)
    .select('id, snapshot_date, value_at_cost, source, notes, created_at, updated_at')
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'snapshot not found' }, { status: 404 })
    }
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'another snapshot already exists for that date' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ snapshot: data })
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('inventory_snapshots').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
