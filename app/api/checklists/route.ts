import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface ChecklistItem {
  id: string
  name: string
  category: string | null
  sort_order: number
  active: boolean
  completed_this_month: boolean
  completed_at: string | null
}

export interface AddressItem {
  id: string
  place: string
  category: string | null
  url: string | null
  notes: string | null
  sort_order: number
}

export interface ChoreRow {
  id: string
  name: string
  frequency: string | null
  assigned_to: string | null
  last_done: string | null
  notes: string | null
  sort_order: number
  active: boolean
}

export interface ChecklistsResponse {
  currentMonth: string
  monthlyItems: ChecklistItem[]
  completedCount: number
  totalCount: number
  addressItems: AddressItem[]
  chores: ChoreRow[]
}

export async function GET() {
  const supabase = await createClient()
  const currentMonth = new Date().toISOString().slice(0, 7) // YYYY-MM

  const [itemsRes, completionsRes, addressRes, choresRes] = await Promise.all([
    supabase
      .from('monthly_checklist_items')
      .select('id, name, category, sort_order, active')
      .eq('active', true)
      .order('sort_order'),
    supabase
      .from('monthly_checklist_completions')
      .select('item_id, completed_at')
      .eq('month', currentMonth),
    supabase
      .from('address_change_items')
      .select('id, place, category, url, notes, sort_order')
      .order('category')
      .order('sort_order'),
    supabase
      .from('chores')
      .select('id, name, frequency, assigned_to, last_done, notes, sort_order, active')
      .order('sort_order'),
  ])

  if (itemsRes.error)       return NextResponse.json({ error: itemsRes.error.message }, { status: 500 })
  if (completionsRes.error) return NextResponse.json({ error: completionsRes.error.message }, { status: 500 })
  if (addressRes.error)     return NextResponse.json({ error: addressRes.error.message }, { status: 500 })
  if (choresRes.error)      return NextResponse.json({ error: choresRes.error.message }, { status: 500 })

  const completedMap = new Map(
    (completionsRes.data ?? []).map((c) => [c.item_id, c.completed_at as string])
  )

  const monthlyItems: ChecklistItem[] = (itemsRes.data ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    sort_order: item.sort_order,
    active: item.active,
    completed_this_month: completedMap.has(item.id),
    completed_at: completedMap.get(item.id) ?? null,
  }))

  return NextResponse.json({
    currentMonth,
    monthlyItems,
    completedCount: monthlyItems.filter((i) => i.completed_this_month).length,
    totalCount: monthlyItems.length,
    addressItems: (addressRes.data ?? []) as AddressItem[],
    chores: (choresRes.data ?? []) as ChoreRow[],
  } satisfies ChecklistsResponse)
}

// POST: toggle monthly item completion, add chore done mark
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const body = await req.json() as {
    action: 'toggle_monthly' | 'mark_chore_done' | 'add_chore' | 'add_monthly_item'
    item_id?: string
    chore_id?: string
    month?: string
    name?: string
    frequency?: string
    assigned_to?: string
    notes?: string
    category?: string
  }

  if (body.action === 'toggle_monthly') {
    const month = body.month ?? new Date().toISOString().slice(0, 7)
    if (!body.item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 })

    const { data: existing } = await supabase
      .from('monthly_checklist_completions')
      .select('id')
      .eq('item_id', body.item_id)
      .eq('month', month)
      .maybeSingle()

    if (existing) {
      await supabase.from('monthly_checklist_completions').delete().eq('id', existing.id)
      return NextResponse.json({ ok: true, completed: false })
    } else {
      await supabase.from('monthly_checklist_completions').insert({ item_id: body.item_id, month })
      return NextResponse.json({ ok: true, completed: true })
    }
  }

  if (body.action === 'mark_chore_done') {
    if (!body.chore_id) return NextResponse.json({ error: 'chore_id required' }, { status: 400 })
    const today = new Date().toISOString().split('T')[0]
    await supabase.from('chores').update({ last_done: today, updated_at: new Date().toISOString() }).eq('id', body.chore_id)
    return NextResponse.json({ ok: true, last_done: today })
  }

  if (body.action === 'add_chore') {
    if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const { data, error } = await supabase
      .from('chores')
      .insert({ name: body.name.trim(), frequency: body.frequency || null, assigned_to: body.assigned_to || null, notes: body.notes || null })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ chore: data }, { status: 201 })
  }

  if (body.action === 'add_monthly_item') {
    if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const { data, error } = await supabase
      .from('monthly_checklist_items')
      .insert({ name: body.name.trim(), category: body.category || null })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ item: data }, { status: 201 })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
