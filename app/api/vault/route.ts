import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface VaultEntry {
  id: string
  service: string
  username: string | null
  url: string | null
  notes: string | null
  category: string
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface VaultResponse {
  entries: VaultEntry[]
  categories: string[]
}

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('account_vault')
    .select('id, service, username, url, notes, category, sort_order, is_active, created_at')
    .order('category')
    .order('sort_order')
    .order('service')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const entries = (data ?? []) as VaultEntry[]
  const categories = [...new Set(entries.map((e) => e.category))].sort()

  return NextResponse.json({ entries, categories } satisfies VaultResponse)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json() as Partial<VaultEntry>

  if (!body.service?.trim()) {
    return NextResponse.json({ error: 'service required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('account_vault')
    .insert({
      service: body.service.trim(),
      username: body.username?.trim() || null,
      url: body.url?.trim() || null,
      notes: body.notes?.trim() || null,
      category: body.category?.trim() || 'other',
      sort_order: body.sort_order ?? 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entry: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json() as Partial<VaultEntry> & { id: string }

  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.service !== undefined)    updates.service    = body.service?.trim()
  if (body.username !== undefined)   updates.username   = body.username?.trim() || null
  if (body.url !== undefined)        updates.url        = body.url?.trim() || null
  if (body.notes !== undefined)      updates.notes      = body.notes?.trim() || null
  if (body.category !== undefined)   updates.category   = body.category
  if (body.is_active !== undefined)  updates.is_active  = body.is_active

  const { error } = await supabase.from('account_vault').update(updates).eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('account_vault').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
