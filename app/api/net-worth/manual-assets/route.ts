import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface ManualAsset {
  id: string
  label: string
  asset_class: string
  value_cad: number
  notes: string | null
  updated_at: string
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('manual_assets')
    .select('id, label, asset_class, value_cad, notes, updated_at')
    .order('asset_class', { ascending: true })
    .order('label', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const assets: ManualAsset[] = (data ?? []).map((r) => ({
    ...r,
    value_cad: Number(r.value_cad),
  }))

  return NextResponse.json({ assets })
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = (body as Record<string, unknown> | null) ?? {}
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return NextResponse.json({ error: 'Missing required field: id' }, { status: 400 })

  const valueCad = typeof raw.value_cad === 'number' ? raw.value_cad : Number(raw.value_cad)
  if (!Number.isFinite(valueCad)) {
    return NextResponse.json({ error: 'value_cad must be a finite number' }, { status: 400 })
  }

  const notes =
    typeof raw.notes === 'string' ? (raw.notes.trim() || null) : raw.notes === null ? null : undefined

  const patch: Record<string, unknown> = {
    value_cad: Math.round(valueCad * 100) / 100,
    updated_at: new Date().toISOString(),
  }
  if (notes !== undefined) patch.notes = notes

  const { data, error } = await supabase
    .from('manual_assets')
    .update(patch)
    .eq('id', id)
    .select('id, label, asset_class, value_cad, notes, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ asset: { ...data, value_cad: Number(data.value_cad) } })
}
