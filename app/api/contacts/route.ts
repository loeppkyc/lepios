import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface ContactRow {
  id: string
  name: string
  company: string | null
  type: string
  email: string | null
  phone: string | null
  address: string | null
  notes: string | null
  category: string | null
  sort_order: number
  created_at: string
}

export interface ContactsResponse {
  contacts: ContactRow[]
}

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, company, type, email, phone, address, notes, category, sort_order, created_at')
    .order('sort_order')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ contacts: (data ?? []) as ContactRow[] } satisfies ContactsResponse)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json() as Partial<ContactRow>

  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      name: body.name.trim(),
      company: body.company?.trim() || null,
      type: body.type ?? 'personal',
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
      address: body.address?.trim() || null,
      notes: body.notes?.trim() || null,
      category: body.category?.trim() || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ contact: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json() as Partial<ContactRow> & { id: string }

  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined)    updates.name    = body.name?.trim()
  if (body.company !== undefined) updates.company = body.company?.trim() || null
  if (body.type !== undefined)    updates.type    = body.type
  if (body.email !== undefined)   updates.email   = body.email?.trim() || null
  if (body.phone !== undefined)   updates.phone   = body.phone?.trim() || null
  if (body.address !== undefined) updates.address = body.address?.trim() || null
  if (body.notes !== undefined)   updates.notes   = body.notes?.trim() || null

  const { error } = await supabase.from('contacts').update(updates).eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('contacts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
